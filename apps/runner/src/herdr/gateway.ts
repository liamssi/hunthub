// The runner's Herdr gateway: watches every Herdr session on this machine and
// forwards snapshots to the hub, and executes allowlisted Herdr calls the hub
// sends. It doesn't interpret Herdr data; the hub does. Herdr on this machine
// is the source of truth: sessions created, changed or deleted directly here
// are picked up by the folder watch, periodic discovery and subscriptions.
import { type FSWatcher, watch } from 'node:fs';
import { join } from 'node:path';
import type { HerdrSessionReport, RunnerMessage } from '@hunthub/shared/runner-protocol';
import { discoverSessions, HerdrError, herdrDir, request, socketPathFor, subscribe } from './client';
import {
	CONSOLE_METHODS,
	CREATE_METHODS,
	MUTATING_METHODS,
	FS_LIST,
	FS_READ,
	AGENT_KINDS_INSTALLED,
	AGENT_LAUNCH,
	AGENT_STOP,
	FS_ROOTS,
	PANE_HISTORY,
	policyAllows,
	SESSION_DELETE,
	SESSION_START,
	SESSION_STOP,
	validateSessionName
} from '@hunthub/shared/console';
import { consolePolicy } from '../policy';
import { installedKinds, parseLaunch, promptWhenReady, startAgent, stopAgent } from './agents';
import { FsError, listFolder, readFile, rootsFromSnapshot } from './files';
import { PaneHistory } from './history';
import { deleteSession, startSession, stopSession } from './sessions';

export { SESSION_DELETE, SESSION_START, SESSION_STOP } from '@hunthub/shared/console';

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
const VOLATILE = new Set(['revision', 'scroll', 'terminal_title', 'terminal_title_stripped', 'focused']);

type LayoutLike = { tab_id?: unknown; zoomed?: unknown; splits?: { direction?: unknown; ratio?: unknown }[] };

/**
 * Layout rects change whenever any client resizes; only the split structure
 * (directions and ratios, rounded) and zoom count as a change.
 */
function layoutShape(layouts: unknown): unknown {
	if (!Array.isArray(layouts)) return layouts;
	return layouts.map((l: LayoutLike) => ({
		tab: l?.tab_id,
		zoomed: l?.zoomed,
		splits: Array.isArray(l?.splits)
			? l.splits.map((s) => [s?.direction, typeof s?.ratio === 'number' ? Math.round(s.ratio * 50) / 50 : s?.ratio])
			: []
	}));
}

export function meaningfulJson(snapshot: unknown): string {
	return JSON.stringify(snapshot, (key, value) => {
		if (key === 'layouts') return layoutShape(value);
		return VOLATILE.has(key) ? undefined : value;
	});
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
	/** The latest snapshot (for the file explorer's allowed folders). */
	snapshot: unknown = null;

	get running(): boolean {
		return this.state === 'running';
	}

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
		this.snapshot = snapshot;
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
	private discoverSoon: ReturnType<typeof setTimeout> | null = null;
	private folderWatches: FSWatcher[] = [];
	/** Mutations run one at a time per session, in order. */
	private queues = new Map<string, Promise<unknown>>();
	/** Pane transcripts beyond Herdr's last 1000 lines (fed by terminal activity). */
	readonly history = new PaneHistory();

	constructor(
		private readonly send: Send,
		private readonly log: (msg: string) => void
	) {}

	start() {
		this.discover();
		this.discoverTimer = setInterval(() => this.discover(), DISCOVER_MS);
		this.watchFolders();
	}

	stop() {
		this.history.stop();
		if (this.discoverTimer) clearInterval(this.discoverTimer);
		if (this.discoverSoon) clearTimeout(this.discoverSoon);
		for (const w of this.folderWatches) w.close();
		this.folderWatches = [];
		for (const w of this.watchers.values()) w.stop();
		this.watchers.clear();
	}

	/** Sessions appearing or disappearing on disk trigger discovery right away. */
	private watchFolders() {
		for (const dir of [herdrDir(), join(herdrDir(), 'sessions')]) {
			try {
				const w = watch(dir, () => this.scheduleDiscover());
				w.on('error', () => {});
				this.folderWatches.push(w);
			} catch {
				// The folder may not exist yet; periodic discovery still covers it.
			}
		}
	}

	private scheduleDiscover() {
		if (this.discoverSoon) return;
		this.discoverSoon = setTimeout(() => {
			this.discoverSoon = null;
			this.discover();
		}, 200);
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

	/** Whether a session exists on disk (checked before touching its sockets). */
	hasSession(name: string): boolean {
		return this.watchers.has(name);
	}

	isRunning(name: string): boolean {
		return this.watchers.get(name)?.running ?? false;
	}

	/** Runs an allowlisted call for the hub and replies with the result. */
	async call(id: string, session: string, method: string, params: Record<string, unknown>) {
		const reply = (ok: boolean, body: { result?: unknown; error?: { code: string; message: string } }) =>
			this.send({ type: 'herdr.result', id, ok, ...body });

		if (!CONSOLE_METHODS.has(method) || !policyAllows(consolePolicy(), method)) {
			return reply(false, { error: { code: 'not_allowed', message: `${method} is not allowed on this machine` } });
		}
		// The session name becomes part of a socket path. Starting may name a new
		// session; everything else must target one that exists on disk.
		const invalid = validateSessionName(session);
		if (invalid) return reply(false, { error: { code: 'invalid_name', message: invalid } });
		if (method !== SESSION_START && !this.watchers.has(session)) {
			return reply(false, { error: { code: 'unknown_session', message: `No Herdr session named ${session}` } });
		}

		const run = () => this.execute(session, method, params);
		try {
			// A launch queues only while it changes the session (see launch()).
			const queued = MUTATING_METHODS.has(method) && method !== AGENT_LAUNCH;
			const result = queued ? await this.enqueue(session, run) : await run();
			reply(true, { result });
		} catch (err) {
			const error =
				err instanceof HerdrError || err instanceof FsError
					? { code: err.code, message: err.message }
					: { code: 'unavailable', message: err instanceof Error ? err.message : String(err) };
			reply(false, { error });
		}
	}

	private enqueue<T>(session: string, task: () => Promise<T>): Promise<T> {
		const previous = this.queues.get(session) ?? Promise.resolve();
		const next = previous.catch(() => {}).then(task);
		this.queues.set(session, next);
		const cleanup = () => {
			if (this.queues.get(session) === next) this.queues.delete(session);
		};
		// The caller handles the result; this only clears the queue entry.
		next.then(cleanup, cleanup);
		return next;
	}

	/**
	 * Starts an agent. Creating its pane and starting it are queued with the
	 * session's other changes; waiting for it to be ready for a first prompt
	 * (up to minutes) is not, so it doesn't hold them up.
	 */
	private async launch(session: string, params: Record<string, unknown>) {
		const p = parseLaunch(params);
		const { paneId } = await this.enqueue(session, () => startAgent(session, p));
		if (!p.prompt) return { pane_id: paneId, name: p.name, prompted: false };
		try {
			await promptWhenReady(session, p.name, p.prompt);
			return { pane_id: paneId, name: p.name, prompted: true };
		} catch (err) {
			// The agent started; only the prompt didn't go through.
			return { pane_id: paneId, name: p.name, prompted: false, prompt_error: err instanceof Error ? err.message : String(err) };
		}
	}

	private async execute(session: string, method: string, params: Record<string, unknown>): Promise<unknown> {
		switch (method) {
			case FS_ROOTS:
				return { roots: rootsFromSnapshot(this.watchers.get(session)?.snapshot) };
			case FS_LIST:
				return listFolder(rootsFromSnapshot(this.watchers.get(session)?.snapshot), params);
			case FS_READ:
				return readFile(rootsFromSnapshot(this.watchers.get(session)?.snapshot), params);
			case PANE_HISTORY: {
				const paneId = params.pane_id;
				if (typeof paneId !== 'string' || !/^[A-Za-z0-9:_.-]{1,64}$/.test(paneId)) {
					throw new HerdrError('invalid_params', 'Invalid pane.');
				}
				const tail = params.tail;
				if (tail !== undefined && (typeof tail !== 'number' || !Number.isInteger(tail) || tail < 1)) {
					throw new HerdrError('invalid_params', 'Invalid tail.');
				}
				return this.history.get(session, paneId, tail);
			}
			case AGENT_LAUNCH:
				return this.launch(session, params);
			case AGENT_STOP:
				return stopAgent(session, params);
			case AGENT_KINDS_INSTALLED:
				return installedKinds();
			case SESSION_START: {
				const result = await startSession(session);
				this.discover();
				return result;
			}
			case SESSION_STOP:
				await stopSession(session);
				return { stopped: true };
			case SESSION_DELETE:
				await deleteSession(session);
				this.discover();
				return { deleted: true };
			default: {
				const finalParams = CREATE_METHODS.has(method) ? { ...params, focus: false } : params;
				return request(socketPathFor(session), method, finalParams);
			}
		}
	}
}
