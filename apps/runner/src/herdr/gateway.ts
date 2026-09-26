// The runner's Herdr gateway: watches every Herdr session on this machine and
// forwards snapshots to the hub, and executes allowlisted Herdr calls the hub
// sends. It doesn't interpret Herdr data; the hub does.
import type { HerdrSessionReport, RunnerMessage } from '@hunthub/shared/runner-protocol';
import { discoverSessions, HerdrError, request, socketPathFor, subscribe } from './client';

/** Herdr methods the hub may call. M2 is read-only. */
export const ALLOWED_METHODS = new Set([
	'ping',
	'session.snapshot',
	'workspace.list',
	'tab.list',
	'pane.list',
	'pane.get',
	'pane.read',
	'agent.list',
	'agent.get',
	'agent.read',
	'agent.explain'
]);

// Structure changes arrive as events; agent state changes don't, so snapshots
// are also checked on a short timer.
const LIFECYCLE_EVENTS = [
	'workspace.created',
	'workspace.updated',
	'workspace.renamed',
	'workspace.moved',
	'workspace.reordered',
	'workspace.closed',
	'worktree.created',
	'worktree.opened',
	'worktree.removed',
	'tab.created',
	'tab.renamed',
	'tab.moved',
	'tab.closed',
	'pane.created',
	'pane.closed',
	'pane.moved',
	'pane.exited',
	'pane.agent_detected',
	'layout.updated'
];

const POLL_MS = 1000;
const RETRY_MS = 3000;
const DISCOVER_MS = 5000;

/** Fields that change with terminal output or focus; ignored when deciding whether to report. */
const VOLATILE = new Set(['revision', 'scroll', 'terminal_title', 'terminal_title_stripped', 'focused', 'layouts']);

export function meaningfulJson(snapshot: unknown): string {
	return JSON.stringify(snapshot, (key, value) => (VOLATILE.has(key) ? undefined : value));
}

type Send = (message: RunnerMessage) => void;

class SessionWatcher {
	private stopped = false;
	private unsubscribe: (() => void) | null = null;
	private poll: ReturnType<typeof setInterval> | null = null;
	private retry: ReturnType<typeof setTimeout> | null = null;
	private lastSent = '';
	private state: HerdrSessionReport['state'] | null = null;

	constructor(
		readonly name: string,
		private readonly send: Send,
		private readonly log: (msg: string) => void
	) {}

	start() {
		void this.connect();
	}

	stop() {
		this.stopped = true;
		this.teardown();
		if (this.retry) clearTimeout(this.retry);
	}

	private teardown() {
		this.unsubscribe?.();
		this.unsubscribe = null;
		if (this.poll) clearInterval(this.poll);
		this.poll = null;
	}

	private report(state: HerdrSessionReport['state'], snapshot: unknown | null, meaningful = '') {
		if (state === this.state && meaningful === this.lastSent) return;
		this.state = state;
		this.lastSent = meaningful;
		this.send({ type: 'herdr.session', session: { name: this.name, state, snapshot } });
	}

	private async refresh() {
		try {
			const result = await request<{ snapshot: unknown }>(socketPathFor(this.name), 'session.snapshot');
			this.report('running', result.snapshot, meaningfulJson(result.snapshot));
		} catch {
			this.lost();
		}
	}

	private lost() {
		if (this.stopped) return;
		this.teardown();
		this.report('stopped', null);
		if (!this.retry) {
			this.retry = setTimeout(() => {
				this.retry = null;
				void this.connect();
			}, RETRY_MS);
		}
	}

	private async connect() {
		if (this.stopped) return;
		try {
			await request(socketPathFor(this.name), 'ping', {}, 2000);
			// Subscribe first, then snapshot, so no change falls in between.
			this.unsubscribe = await subscribe(socketPathFor(this.name), LIFECYCLE_EVENTS, {
				onReady: () => void this.refresh(),
				onEvent: () => void this.refresh(),
				onEnd: () => this.lost()
			});
			this.poll = setInterval(() => void this.refresh(), POLL_MS);
		} catch {
			this.lost();
		}
	}
}

export class HerdrGateway {
	private watchers = new Map<string, SessionWatcher>();
	private discoverTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly send: Send,
		private readonly log: (msg: string) => void
	) {}

	start() {
		this.discover();
		this.discoverTimer = setInterval(() => this.discover(), DISCOVER_MS);
	}

	stop() {
		if (this.discoverTimer) clearInterval(this.discoverTimer);
		for (const w of this.watchers.values()) w.stop();
		this.watchers.clear();
	}

	private discover() {
		const found = new Set(discoverSessions());
		for (const name of found) {
			if (this.watchers.has(name)) continue;
			const watcher = new SessionWatcher(name, this.send, this.log);
			this.watchers.set(name, watcher);
			watcher.start();
		}
		for (const [name, watcher] of this.watchers) {
			if (found.has(name)) continue;
			watcher.stop();
			this.watchers.delete(name);
			this.send({ type: 'herdr.session.removed', name });
		}
	}

	/** Runs an allowlisted Herdr call for the hub and replies with the result. */
	async call(id: string, session: string, method: string, params: Record<string, unknown>) {
		if (!ALLOWED_METHODS.has(method)) {
			this.send({ type: 'herdr.result', id, ok: false, error: { code: 'not_allowed', message: `${method} is not allowed on this machine` } });
			return;
		}
		// Only sessions found on disk; the name becomes part of a socket path.
		if (!this.watchers.has(session)) {
			this.send({ type: 'herdr.result', id, ok: false, error: { code: 'unknown_session', message: `No Herdr session named ${session}` } });
			return;
		}
		try {
			const result = await request(socketPathFor(session), method, params);
			this.send({ type: 'herdr.result', id, ok: true, result });
		} catch (err) {
			const error =
				err instanceof HerdrError
					? { code: err.code, message: err.message }
					: { code: 'unavailable', message: err instanceof Error ? err.message : String(err) };
			this.send({ type: 'herdr.result', id, ok: false, error });
		}
	}
}
