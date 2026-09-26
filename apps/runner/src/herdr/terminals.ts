// Live terminals relayed to the hub. Each channel streams one pane as ANSI
// frames, through one of two transports (selectable, to compare them):
// - "cli" runs this machine's own `herdr terminal session observe|control`
//   (always the matching Herdr version) and speaks its NDJSON over stdio.
// - "native" speaks Herdr's endpoint protocol on herdr-client.sock through
//   Roamgate's client (src/vendor/roamgate): it focuses the pane in its own
//   shell connection, crops the pane out of the tab surface and re-encodes it
//   as ANSI. Watching still focuses the pane within its tab.
// The "session" view instead runs Herdr's own client (`herdr --session <name>`)
// in a PTY and streams its output: the whole session, exactly as if it were
// opened in a terminal on the machine.
import { dirname, join } from 'node:path';
import {
	RUNNER_MAX_MESSAGE_BYTES,
	type RunnerMessage,
	type ServerMessage,
	type TerminalFrame
} from '@hunthub/shared/runner-protocol';
import { EndpointTerminalSession } from '../vendor/roamgate/endpoint-terminal-session';
import { DEFAULT_SESSION, socketPathFor } from './client';

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
		private readonly log: (msg: string) => void,
		private readonly sessionRunning: (name: string) => boolean = sessionExists
	) {}

	open(msg: Open) {
		const fail = (reason: string) => this.send({ type: 'term.closed', channel: msg.channel, reason });
		if (this.channels.has(msg.channel)) return fail('Channel already open.');
		if (this.channels.size >= MAX_TERMINALS) return fail('Too many open terminals on this machine.');
		if (!this.sessionExists(msg.session)) return fail(`No Herdr session named ${msg.session}.`);
		if (msg.view === 'session') {
			// Herdr's client would start a stopped session itself, outside the runner's lifecycle management.
			if (!this.sessionRunning(msg.session)) return fail(`Session ${msg.session} is stopped. Start it first.`);
			this.channels.set(msg.channel, this.openSession(msg));
			return;
		}
		if (!TARGET.test(msg.target)) return fail('Invalid pane.');
		this.channels.set(msg.channel, msg.transport === 'native' ? this.openNative(msg) : this.openCli(msg));
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

	private openSession(msg: Open): Channel {
		const args = ['herdr'];
		if (msg.session !== DEFAULT_SESSION) args.push('--session', msg.session);
		// Drop Herdr's per-pane variables in case the runner itself runs inside a Herdr pane.
		const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('HERDR_')));
		let seq = 0;
		let ended = false;
		let pending: Uint8Array[] = [];
		let size = { cols: msg.cols, rows: msg.rows };
		let flushTimer: ReturnType<typeof setTimeout> | null = null;

		// Output is batched per ~16 ms (one browser frame) to keep the message count down.
		const flush = () => {
			flushTimer = null;
			if (ended || pending.length === 0) return;
			const bytes = Buffer.concat(pending).toString('base64');
			pending = [];
			this.send({ type: 'term.frame', channel: msg.channel, frame: { seq: ++seq, full: false, width: size.cols, height: size.rows, bytes } });
		};

		const proc = Bun.spawn(args, {
			env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
			terminal: {
				cols: msg.cols,
				rows: msg.rows,
				data: (_terminal, data) => {
					if (ended) return;
					pending.push(new Uint8Array(data));
					flushTimer ??= setTimeout(flush, 16);
				}
			}
		});

		void proc.exited.then((code) => {
			flush();
			if (ended) return;
			ended = true;
			this.channels.delete(msg.channel);
			this.send({ type: 'term.closed', channel: msg.channel, reason: code === 0 ? 'Herdr closed.' : `Herdr exited (${code}).` });
		});

		return {
			write: (line) => {
				const m = line as { type: string; bytes?: string; cols?: number; rows?: number };
				if (ended || !proc.terminal) return;
				if (m.type === 'terminal.input' && msg.mode === 'control' && m.bytes) proc.terminal.write(Buffer.from(m.bytes, 'base64'));
				else if (m.type === 'terminal.resize' && m.cols && m.rows) {
					size = { cols: m.cols, rows: m.rows };
					proc.terminal.resize(m.cols, m.rows);
				}
			},
			close: () => {
				if (ended) return;
				ended = true;
				if (flushTimer) clearTimeout(flushTimer);
				this.channels.delete(msg.channel);
				this.send({ type: 'term.closed', channel: msg.channel, reason: 'Closed.' });
				// Only this client goes away; the session keeps running.
				proc.kill('SIGTERM');
				setTimeout(() => proc.kill('SIGKILL'), 2000);
			}
		};
	}

	private openNative(msg: Open): Channel {
		const socket = join(dirname(socketPathFor(msg.session)), 'herdr-client.sock');
		// Our targets are pane ids already; the endpoint session resolves them to themselves.
		const session = new EndpointTerminalSession(socket, msg.target, async (id) => id);
		let ended = false;
		const end = (reason: string) => {
			if (ended) return;
			ended = true;
			session.close();
			this.channels.delete(msg.channel);
			this.send({ type: 'term.closed', channel: msg.channel, reason });
		};

		session.on('terminal', (f: { seq: number; width: number; height: number; bytes: Buffer }) => {
			if (ended) return;
			const bytes = f.bytes.toString('base64');
			if (bytes.length > RUNNER_MAX_MESSAGE_BYTES - 1024) return end('The terminal is too large to stream; make it smaller.');
			this.send({ type: 'term.frame', channel: msg.channel, frame: { seq: f.seq, full: true, width: f.width, height: f.height, bytes } });
		});
		session.on('error', (e: Error) => end(`Terminal error: ${e.message}`));
		session.on('close', () => end('Terminal ended.'));
		// Frames can arrive before the connection settles; hold input until then.
		let pending: object[] | null = [];
		session
			.connect(msg.cols, msg.rows)
			.then(() => {
				const queued = pending ?? [];
				pending = null;
				for (const line of queued) write(line);
			})
			.catch((e: Error) => end(`Couldn't open the pane: ${e.message}`));

		const write = (line: object) => {
			if (ended) return;
			if (pending) {
				if (pending.length < 1000) pending.push(line);
				return;
			}
			const m = line as { type: string; bytes?: string; cols?: number; rows?: number; direction?: 'up' | 'down'; lines?: number };
			try {
				if (m.type === 'terminal.input' && msg.mode === 'control' && m.bytes) session.input(Buffer.from(m.bytes, 'base64'));
				else if (m.type === 'terminal.resize' && m.cols && m.rows) session.resize(m.cols, m.rows);
				else if (m.type === 'terminal.scroll' && m.direction && m.lines) session.scroll(m.direction, m.lines, null, null, 'page-key');
			} catch (e) {
				this.log(`terminal ${msg.channel}: ${e instanceof Error ? e.message : e}`);
			}
		};

		return { write, close: () => end('Closed.') };
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
