// Minimal client for Herdr's local socket API (newline-delimited JSON).
// Herdr answers one request per connection and then closes it; long-lived
// calls (events.subscribe) keep their connection open and stream lines.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class HerdrError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

/** Herdr keeps sockets and state under ~/.config/herdr. */
export function herdrDir(): string {
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'herdr');
}

export const DEFAULT_SESSION = 'default';

export function socketPathFor(session: string): string {
	return session === DEFAULT_SESSION
		? join(herdrDir(), 'herdr.sock')
		: join(herdrDir(), 'sessions', session, 'herdr.sock');
}

/** Sessions that have a socket file (their server may or may not be running). */
export function discoverSessions(): string[] {
	const sessions: string[] = [];
	if (existsSync(socketPathFor(DEFAULT_SESSION))) sessions.push(DEFAULT_SESSION);
	const dir = join(herdrDir(), 'sessions');
	if (existsSync(dir)) {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory() && entry.name !== DEFAULT_SESSION && existsSync(socketPathFor(entry.name))) {
				sessions.push(entry.name);
			}
		}
	}
	return sessions;
}

type LineHandlers = {
	onLine: (line: string) => void;
	onClose: (error?: Error) => void;
};

/** Opens a socket connection, sends one request line, and reports each response line. */
async function openLines(socketPath: string, request: string, handlers: LineHandlers) {
	let buffer = '';
	let closed = false;
	const close = (error?: Error) => {
		if (closed) return;
		closed = true;
		handlers.onClose(error);
	};
	const socket = await Bun.connect({
		unix: socketPath,
		socket: {
			open(s) {
				s.write(request + '\n');
			},
			data(_s, chunk) {
				buffer += chunk.toString();
				let index: number;
				while ((index = buffer.indexOf('\n')) >= 0) {
					const line = buffer.slice(0, index).trim();
					buffer = buffer.slice(index + 1);
					if (line) handlers.onLine(line);
				}
			},
			close() {
				close();
			},
			error(_s, error) {
				close(error);
			},
			connectError(_s, error) {
				close(error);
			}
		}
	});
	return { end: () => socket.end() };
}

let requestCounter = 0;
const nextId = () => `hunthub:${Date.now()}:${++requestCounter}`;

/** One request/response call. Throws HerdrError on an API error. */
export function request<T = unknown>(
	socketPath: string,
	method: string,
	params: Record<string, unknown> = {},
	timeoutMs = 5000
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};
		const timer = setTimeout(
			() => finish(() => reject(new HerdrError('timeout', `herdr ${method} timed out`))),
			timeoutMs
		);
		openLines(socketPath, JSON.stringify({ id: nextId(), method, params }), {
			onLine(line) {
				let message: { result?: T; error?: { code: string; message: string } };
				try {
					message = JSON.parse(line);
				} catch {
					return finish(() => reject(new HerdrError('bad_response', 'unparseable herdr response')));
				}
				finish(() =>
					message.error
						? reject(new HerdrError(message.error.code, message.error.message))
						: resolve(message.result as T)
				);
			},
			onClose(error) {
				finish(() => reject(error ?? new HerdrError('closed', `herdr closed the connection during ${method}`)));
			}
		}).catch((error) => finish(() => reject(error)));
	});
}

export type HerdrEvent = { event: string; data: unknown };

/**
 * Subscribes to events. `onReady` fires once Herdr acknowledges; `onEnd` fires
 * when the stream ends for any reason. Returns a function that unsubscribes.
 */
export async function subscribe(
	socketPath: string,
	types: string[],
	handlers: { onReady: () => void; onEvent: (event: HerdrEvent) => void; onEnd: (error?: Error) => void }
): Promise<() => void> {
	let ready = false;
	const conn = await openLines(
		socketPath,
		JSON.stringify({ id: nextId(), method: 'events.subscribe', params: { subscriptions: types.map((type) => ({ type })) } }),
		{
			onLine(line) {
				let message: { result?: { type?: string }; error?: { message: string }; event?: string; data?: unknown };
				try {
					message = JSON.parse(line);
				} catch {
					return;
				}
				if (!ready) {
					if (message.error) return conn?.end();
					ready = true;
					handlers.onReady();
					return;
				}
				if (message.event) handlers.onEvent({ event: message.event, data: message.data });
			},
			onClose: handlers.onEnd
		}
	);
	return () => conn.end();
}
