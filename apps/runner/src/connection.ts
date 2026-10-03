// Keeps one outbound WebSocket to HuntHub open: hello, heartbeats and stats,
// reconnecting with backoff. Stops for good if the hub revokes or disables
// the machine, or the protocol is incompatible.
import {
	RUNNER_CLOSE,
	RUNNER_PROTOCOL_VERSION,
	type RunnerMessage,
	serverMessageSchema
} from '@hunthub/shared/runner-protocol';
import { policyAllows, TERMINAL_CONTROL } from '@hunthub/shared/console';
import { encodeFrame } from '@hunthub/shared/frames';
import { markRevoked, saveCredential } from './config';
import { setHubPolicy } from './policy';
import { HerdrGateway } from './herdr/gateway';
import { TerminalManager } from './herdr/terminals';
import { collectHostInfo } from './host';
import { StatsCollector } from './stats';
import { runnerVersion } from './version';

export function wsUrl(hubUrl: string): string {
	const url = new URL('/api/runner/ws', hubUrl);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	return url.toString();
}

/** Exponential backoff with jitter: 1s, 2s, 4s ... capped at 60s. */
export function backoffMs(attempt: number): number {
	const base = Math.min(60_000, 1000 * 2 ** attempt);
	return Math.round(base / 2 + Math.random() * (base / 2));
}

type Options = {
	hubUrl: string;
	credential: string;
	log: (msg: string) => void;
};

/** Close codes after which retrying cannot help. */
/** Unsent data on the hub link beyond this means it's backed up: terminal frames wait. */
const CONGESTED_BYTES = 512 * 1024;

const FATAL_CLOSES = new Map<number, string>([
	[RUNNER_CLOSE.revoked, 'This machine was removed from HuntHub.'],
	[RUNNER_CLOSE.incompatible, 'This runner version is not supported by the hub. Update the runner.']
]);

/**
 * When the WebSocket upgrade is refused, the reason is only visible over plain
 * HTTP: ask the same endpoint and read the JSON error.
 */
async function rejectionReason(hubUrl: string, credential: string): Promise<string | null> {
	try {
		const res = await fetch(new URL('/api/runner/ws', hubUrl), { headers: { authorization: `Bearer ${credential}` } });
		if (res.status !== 401 && res.status !== 403) return null;
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		return body.error ?? null;
	} catch {
		return null;
	}
}

export function runConnection({ hubUrl, log, ...opts }: Options): Promise<void> {
	let credential = opts.credential;
	let attempt = 0;
	let stopped = false;
	let hostJson = '';
	const collector = new StatsCollector();

	return new Promise((resolve) => {
		const stop = (reason: string) => {
			stopped = true;
			log(reason);
			resolve();
		};

		const connect = () => {
			if (stopped) return;
			const ws = new WebSocket(wsUrl(hubUrl), { headers: { authorization: `Bearer ${credential}` } });
			const timers: ReturnType<typeof setInterval>[] = [];
			let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
			let statsTimer: ReturnType<typeof setInterval> | undefined;
			let opened = false;
			let gateway: HerdrGateway | null = null;
			let terminals: TerminalManager | null = null;
			const send = (msg: RunnerMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

			/** (Re)starts the heartbeat and stats timers with the hub's current intervals. */
			const applyTimings = (heartbeatIntervalMs: number, statsIntervalMs: number) => {
				clearInterval(heartbeatTimer);
				clearInterval(statsTimer);
				heartbeatTimer = setInterval(() => send({ type: 'heartbeat', ts: Date.now() }), heartbeatIntervalMs);
				statsTimer = setInterval(() => {
					try {
						send({ type: 'stats', sample: collector.sample() });
					} catch (err) {
						log(`stats failed: ${err instanceof Error ? err.message : err}`);
					}
				}, statsIntervalMs);
			};

			ws.onopen = () => {
				opened = true;
				const host = collectHostInfo();
				hostJson = JSON.stringify(host);
				send({
					type: 'hello',
					protocol: RUNNER_PROTOCOL_VERSION,
					runnerVersion,
					capabilities: ['stats', 'herdr', 'terminal:cli', 'terminal:native', 'terminal:session'],
					host
				});
			};

			ws.onmessage = (event) => {
				let data: unknown;
				try {
					data = JSON.parse(String(event.data));
				} catch {
					return log('ignoring malformed message from hub');
				}
				const parsed = serverMessageSchema.safeParse(data);
				if (!parsed.success) return log('ignoring unknown message from hub');
				const msg = parsed.data;
				switch (msg.type) {
					case 'welcome': {
						attempt = 0;
						log(`connected to ${hubUrl} as machine ${msg.machineId} (console access: ${setHubPolicy(msg.policy)})`);
						collector.sample(); // prime rate counters
						applyTimings(msg.heartbeatIntervalMs, msg.statsIntervalMs);
						gateway?.stop();
						gateway = new HerdrGateway(send, log);
						gateway.start();
						const g = gateway;
						terminals?.closeAll();
						// Frames go as binary messages when the hub takes them (no base64, no JSON).
						const binary = msg.binaryFrames;
						terminals = new TerminalManager(
							send,
							(name) => g.hasSession(name),
							log,
							(name) => g.isRunning(name),
							(session, paneId) => g.history.noteActivity(session, paneId),
							{
								sendFrame: binary
									? (channel, header, bytes) => {
										if (ws.readyState === WebSocket.OPEN) ws.send(encodeFrame(header, bytes, channel));
									}
									: undefined,
								congested: () => ws.bufferedAmount > CONGESTED_BYTES
							}
						);
						// Host details rarely change; check once a minute.
						timers.push(
							setInterval(() => {
								const host = collectHostInfo();
								const json = JSON.stringify(host);
								if (json !== hostJson) {
									hostJson = json;
									send({ type: 'host.changed', host });
								}
							}, 60_000)
						);
						break;
					}
					case 'policy': {
						const policy = setHubPolicy(msg.policy);
						log(`console access is now ${policy}`);
						if (!policyAllows(policy, TERMINAL_CONTROL)) terminals?.closeControlling();
						break;
					}
					case 'credential.rotate':
						saveCredential(msg.credential);
						credential = msg.credential;
						send({ type: 'credential.rotated' });
						log('credential rotated');
						break;
					case 'term.open':
						terminals?.open(msg);
						break;
					case 'term.input':
						terminals?.input(msg.channel, msg.bytes);
						break;
					case 'term.resize':
						terminals?.resize(msg.channel, msg.cols, msg.rows);
						break;
					case 'term.scroll':
						terminals?.scroll(msg.channel, msg.direction, msg.lines, msg.column, msg.row);
						break;
					case 'term.pause':
						terminals?.pause(msg.channel, msg.reason, msg.paused);
						break;
					case 'term.rate':
						terminals?.rate(msg.channel, msg.fps);
						break;
					case 'term.close':
						terminals?.close(msg.channel);
						break;
					case 'herdr.call':
						void gateway?.call(msg.id, msg.session, msg.method, msg.params);
						break;
					case 'settings':
						applyTimings(msg.heartbeatIntervalMs, msg.statsIntervalMs);
						log(`timings updated: heartbeat ${msg.heartbeatIntervalMs}ms, stats ${msg.statsIntervalMs}ms`);
						break;
					case 'error':
						log(`hub: ${msg.message}`);
						break;
				}
			};

			ws.onclose = async (event) => {
				for (const t of timers) clearInterval(t);
				clearInterval(heartbeatTimer);
				clearInterval(statsTimer);
				gateway?.stop();
				gateway = null;
				terminals?.closeAll();
				terminals = null;
				if (!opened && (await rejectionReason(hubUrl, credential)) === 'revoked') {
					const reason = 'This machine is not known to the hub (removed or credential revoked).';
					markRevoked(reason);
					return stop(reason);
				}
				const fatal = FATAL_CLOSES.get(event.code);
				if (fatal) {
					if (event.code === RUNNER_CLOSE.revoked) markRevoked(fatal);
					return stop(fatal);
				}
				// Disabled machines, auth failures during upgrade and network errors: keep retrying slowly.
				const delay = backoffMs(attempt++);
				log(`disconnected (${event.code}${event.reason ? `: ${event.reason}` : ''}); retrying in ${Math.round(delay / 1000)}s`);
				setTimeout(connect, delay);
			};

			ws.onerror = () => {
				// onclose follows with the details.
			};
		};

		connect();
	});
}
