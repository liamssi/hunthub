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

/** Slow full re-check, in case an event was missed. */
const RECONCILE_MS = 30_000;
/** Events often come in bursts (e.g. creating a workspace); coalesce refreshes. */
const REFRESH_DEBOUNCE_MS = 100;
const RETRY_MS = 3000;
const DISCOVER_MS = 5000;

/** Fields that change with terminal output or focus; ignored when deciding whether to report. */
const VOLATILE = new Set(['revision', 'scroll', 'terminal_title', 'terminal_title_stripped', 'focused', 'layouts']);

export function meaningfulJson(snapshot: unknown): string {
	return JSON.stringify(snapshot, (key, value) => (VOLATILE.has(key) ? undefined : value));
}

/** Panes that currently host an agent, from a snapshot. */
export function agentPaneIds(snapshot: unknown): string[] {
	const agents = (snapshot as { agents?: { pane_id?: unknown }[] } | null)?.agents;
	if (!Array.isArray(agents)) return [];
	const ids = agents.map((a) => a?.pane_id).filter((id): id is string => typeof id === 'string' && id.length > 0);
	return [...new Set(ids)].sort();
}

type Send = (message: RunnerMessage) => void;

/**
 * Watches one Herdr session. Herdr only reports agent status changes through
 * per-pane `pane.agent_status_changed` subscriptions, so besides the lifecycle
 * subscription this keeps a second one covering exactly the panes that host an
 * agent, rebuilt whenever that set changes (same approach as Roamgate).
 */
class SessionWatcher {
	private stopped = false;
	private closeLifecycle: (() => void) | null = null;
	private closeStatus: (() => void) | null = null;
	private statusPanes: string[] = [];
	/** Bumped whenever the status subscription is replaced; stale callbacks are ignored. */
	private statusGeneration = 0;
	private reconcile: ReturnType<typeof setInterval> | null = null;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
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
		this.closeLifecycle?.();
		this.closeLifecycle = null;
		this.closeStatusSubscription();
		if (this.reconcile) clearInterval(this.reconcile);
		this.reconcile = null;
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
	}

	private closeStatusSubscription() {
		this.statusGeneration++;
		this.closeStatus?.();
		this.closeStatus = null;
		this.statusPanes = [];
	}

	private report(state: HerdrSessionReport['state'], snapshot: unknown | null, meaningful = '') {
		if (state === this.state && meaningful === this.lastSent) return;
		this.state = state;
		this.lastSent = meaningful;
		this.send({ type: 'herdr.session', session: { name: this.name, state, snapshot } });
	}

	private scheduleRefresh() {
		if (this.refreshTimer || this.stopped) return;
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			void this.refresh();
		}, REFRESH_DEBOUNCE_MS);
	}

	private async refresh() {
		let snapshot: unknown;
		try {
			snapshot = (await request<{ snapshot: unknown }>(socketPathFor(this.name), 'session.snapshot')).snapshot;
		} catch {
			return this.lost();
		}
		this.report('running', snapshot, meaningfulJson(snapshot));
		await this.syncStatusSubscription(agentPaneIds(snapshot));
	}

	/** Keeps the per-pane status subscription covering exactly the agent panes. */
	private async syncStatusSubscription(panes: string[]) {
		if (this.stopped) return;
		if (panes.length === this.statusPanes.length && panes.every((p, i) => p === this.statusPanes[i])) return;
		this.closeStatusSubscription();
		if (panes.length === 0) return;
		const generation = this.statusGeneration;
		this.statusPanes = panes;
		try {
			const close = await subscribe(
				socketPathFor(this.name),
				panes.map((pane_id) => ({ type: 'pane.agent_status_changed', pane_id })),
				{
					// A change may have happened between the snapshot and this subscription.
					onReady: () => generation === this.statusGeneration && this.scheduleRefresh(),
					onEvent: () => generation === this.statusGeneration && this.scheduleRefresh(),
					// Herdr may end it (e.g. a pane closed); rebuild from a fresh snapshot.
					onEnd: () => {
						if (generation !== this.statusGeneration) return;
						this.closeStatus = null;
						this.statusPanes = [];
						this.scheduleRefresh();
					}
				}
			);
			if (generation === this.statusGeneration) this.closeStatus = close;
			else close();
		} catch {
			if (generation === this.statusGeneration) this.statusPanes = [];
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
			this.closeLifecycle = await subscribe(socketPathFor(this.name), LIFECYCLE_EVENTS, {
				onReady: () => void this.refresh(),
				onEvent: () => this.scheduleRefresh(),
				onEnd: () => this.lost()
			});
			this.reconcile = setInterval(() => void this.refresh(), RECONCILE_MS);
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
