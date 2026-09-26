// Live terminals relayed to the hub. Each channel streams one pane as ANSI
// frames. The "cli" transport runs this machine's own
// `herdr terminal session observe|control` (always the matching Herdr version)
// and speaks its NDJSON over stdio.
import {
	RUNNER_MAX_MESSAGE_BYTES,
	type RunnerMessage,
	type ServerMessage,
	type TerminalFrame
} from '@hunthub/shared/runner-protocol';
import { DEFAULT_SESSION } from './client';

type Open = Extract<ServerMessage, { type: 'term.open' }>;
type Send = (message: RunnerMessage) => boolean | void;

/** Upper bound on open terminals per runner. */
const MAX_TERMINALS = 32;
/** Pane ids like w1:p2, terminal ids like term_abc, or agent names. */
const TARGET = /^[A-Za-z0-9:_.-]{1,64}$/;

interface Channel {
	write(line: object): void;
	close(): void;
}

export class TerminalManager {
	private channels = new Map<string, Channel>();

	constructor(
		private readonly send: Send,
		private readonly sessionExists: (name: string) => boolean,
		private readonly log: (msg: string) => void
	) {}

	open(msg: Open) {
		const fail = (reason: string) => this.send({ type: 'term.closed', channel: msg.channel, reason });
		if (this.channels.has(msg.channel)) return fail('Channel already open.');
		if (this.channels.size >= MAX_TERMINALS) return fail('Too many open terminals on this machine.');
		if (!this.sessionExists(msg.session)) return fail(`No Herdr session named ${msg.session}.`);
		if (!TARGET.test(msg.target)) return fail('Invalid pane.');
		if (msg.transport === 'native') return fail('The native transport is not available yet.');
		this.channels.set(msg.channel, this.openCli(msg));
	}

	input(channel: string, bytes: string) {
		this.channels.get(channel)?.write({ type: 'terminal.input', bytes });
	}

	resize(channel: string, cols: number, rows: number) {
		this.channels.get(channel)?.write({ type: 'terminal.resize', cols, rows });
	}

	scroll(channel: string, direction: 'up' | 'down', lines: number) {
		this.channels.get(channel)?.write({ type: 'terminal.scroll', direction, lines, source: 'wheel' });
	}

	close(channel: string) {
		this.channels.get(channel)?.close();
	}

	closeAll() {
		for (const c of this.channels.values()) c.close();
	}

	private openCli(msg: Open): Channel {
		const args = ['herdr'];
		if (msg.session !== DEFAULT_SESSION) args.push('--session', msg.session);
		args.push('terminal', 'session', msg.mode, msg.target, '--cols', String(msg.cols), '--rows', String(msg.rows));
		if (msg.mode === 'control' && msg.takeover) args.push('--takeover');

		const proc = Bun.spawn(args, {
			stdin: msg.mode === 'control' ? 'pipe' : 'ignore',
			stdout: 'pipe',
			stderr: 'pipe'
		});
		let closedReason: string | null = null;

		const channel: Channel = {
			write: (line) => {
				if (msg.mode !== 'control' || !proc.stdin || typeof proc.stdin === 'number') return;
				proc.stdin.write(JSON.stringify(line) + '\n');
				proc.stdin.flush();
			},
			close: () => {
				closedReason ??= 'Closed.';
				if (msg.mode === 'control' && proc.stdin && typeof proc.stdin !== 'number') {
					// Hand control back cleanly before exiting.
					try {
						proc.stdin.write(JSON.stringify({ type: 'terminal.release' }) + '\n');
						proc.stdin.end();
					} catch {
						// Already gone.
					}
				}
				setTimeout(() => proc.kill(), 300);
			}
		};

		void (async () => {
			const decoder = new TextDecoder();
			let buffer = '';
			for await (const chunk of proc.stdout) {
				buffer += decoder.decode(chunk, { stream: true });
				let index: number;
				while ((index = buffer.indexOf('\n')) >= 0) {
					const line = buffer.slice(0, index).trim();
					buffer = buffer.slice(index + 1);
					if (!line) continue;
					let parsed: { type?: string; reason?: string } & Partial<TerminalFrame>;
					try {
						parsed = JSON.parse(line);
					} catch {
						continue;
					}
					if (parsed.type === 'terminal.frame' && typeof parsed.bytes === 'string') {
						if (parsed.bytes.length > RUNNER_MAX_MESSAGE_BYTES - 1024) {
							closedReason ??= 'The terminal is too large to stream; make it smaller.';
							channel.close();
							continue;
						}
						this.send({
							type: 'term.frame',
							channel: msg.channel,
							frame: { seq: parsed.seq ?? 0, full: !!parsed.full, width: parsed.width ?? msg.cols, height: parsed.height ?? msg.rows, bytes: parsed.bytes }
						});
					} else if (parsed.type === 'terminal.closed') {
						closedReason ??= parsed.reason ? `Terminal closed: ${parsed.reason}` : 'Terminal closed.';
					}
				}
			}
			const stderr = (await new Response(proc.stderr).text()).trim();
			await proc.exited;
			this.channels.delete(msg.channel);
			this.send({ type: 'term.closed', channel: msg.channel, reason: closedReason ?? (stderr.split('\n').at(-1) || 'Terminal ended.') });
		})().catch((err) => this.log(`terminal ${msg.channel} failed: ${err}`));

		return channel;
	}
}
