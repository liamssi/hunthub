// Machine data shared by the API responses, the browser live channel and the UI.
import type { ConsolePolicy } from './console';
import type { HostInfo, StatsSample } from './runner-protocol';

export type MachineStatus = 'active' | 'disabled';

/** Whether the runner is currently connected; derived by the API, not stored. */
export type MachineConnection = 'online' | 'offline';

export type Machine = {
	id: string;
	name: string;
	tags: string[];
	status: MachineStatus;
	connection: MachineConnection;
	host: HostInfo | null;
	runnerVersion: string | null;
	publicIp: string | null;
	lastSeenAt: string | null;
	createdAt: string;
	/** Latest live sample while online. */
	stats: StatsSample | null;
	/** Agents in Herdr right now; null when unknown (offline or no Herdr reporting). */
	agents: number | null;
	/** What the console may do on this machine (set by an admin). */
	consolePolicy: ConsolePolicy;
};

// Herdr sessions and agents, as the hub interprets the runner's reports.

export type AgentStatus = 'working' | 'blocked' | 'done' | 'idle' | 'unknown';

export type AgentView = {
	machineId: string;
	machineName: string;
	session: string;
	workspaceId: string;
	workspaceLabel: string;
	paneId: string;
	/** What to call it: its Herdr name if it has one, else its kind (e.g. "claude"). */
	name: string;
	/** Herdr's agent kind (claude, codex, …), when known. */
	kind: string | null;
	/** Its name in Herdr, which identifies it (agents started outside may have none). */
	herdrName: string | null;
	status: AgentStatus;
	cwd: string | null;
	/** Started or adopted through HuntHub, or started elsewhere (by hand, Hermes, …). */
	origin: 'hunthub' | 'external';
	/** Who started or adopted it through HuntHub. */
	run: AgentRunInfo | null;
};

export type AgentRunInfo = { id: string; adopted: boolean; by: string | null; at: string };

export type PaneView = {
	id: string;
	cwd: string | null;
	/** The agent running in this pane, if Herdr recognises one. */
	agent: { name: string; status: AgentStatus } | null;
};

/** Where a pane sits in its tab, as fractions (0-1) of the tab area. */
export type PaneRect = { paneId: string; x: number; y: number; width: number; height: number };

/**
 * One divider of a tab's split tree. `path` addresses it for Herdr's
 * `layout.set_split_ratio` (false = first child, true = second, from the root);
 * the rect (fractions of the tab area) is the region the split divides.
 */
export type SplitView = {
	path: boolean[];
	direction: 'right' | 'down';
	ratio: number;
	x: number;
	y: number;
	width: number;
	height: number;
};

export type TabView = {
	id: string;
	label: string;
	panes: PaneView[];
	/** The tab's split layout as Herdr last reported it; null if unknown. */
	layout: { zoomed: boolean; focusedPaneId: string | null; panes: PaneRect[]; splits: SplitView[] } | null;
};

export type WorkspaceView = {
	id: string;
	label: string;
	/** Set when the workspace is a git checkout Herdr tracks (the main repo or a linked worktree). */
	worktree: { repoName: string; repoRoot: string; checkoutPath: string; linked: boolean } | null;
	status: AgentStatus;
	paneCount: number;
	tabs: TabView[];
	agents: AgentView[];
};

export type SessionView = {
	name: string;
	state: 'running' | 'stopped';
	workspaces: WorkspaceView[];
};

export type MachineHerdrView = {
	/** Runner reports Herdr; false for runners that predate M2. */
	supported: boolean;
	sessions: SessionView[];
};

export type StatsRange = '1h' | '24h' | '7d' | '30d' | '1y';

export type StatsPoint = {
	t: string;
	cpuAvg: number;
	cpuMax: number;
	memAvg: number;
	memMax: number;
	memTotal: number;
	rxBps: number;
	txBps: number;
	agents: number | null;
};

export type StatsSeries = {
	range: StatsRange;
	tier: 'minute' | 'hour';
	points: StatsPoint[];
};

export type MachineRetentionSettings = {
	/** Days to keep 1-minute stats. */
	minuteRetentionDays: number;
	/** Days to keep 1-hour stats; null keeps them forever. */
	hourRetentionDays: number | null;
};

export type MachineConnectionSettings = {
	/** How often runners send a heartbeat. */
	heartbeatIntervalMs: number;
	/** A machine is offline after this long without any message. */
	offlineAfterMs: number;
	/** How often runners send a stats sample. */
	statsIntervalMs: number;
};

export type JoinTokenCreated = {
	tokenId: string;
	token: string;
	installCommand: string;
	expiresAt: string;
};

// Browser live channel (/api/live)
export type LiveTopic = 'machines' | 'agents' | `machine:${string}`;

export type LiveClientMessage =
	| { type: 'subscribe'; topic: LiveTopic }
	| { type: 'unsubscribe'; topic: LiveTopic };

export type LiveServerMessage =
	| { type: 'machine.updated'; machine: Machine }
	| { type: 'machine.removed'; machineId: string }
	| { type: 'machine.connection'; machineId: string; connection: MachineConnection; lastSeenAt: string | null }
	| { type: 'machine.stats'; machineId: string; sample: StatsSample }
	| { type: 'enroll.completed'; tokenId: string; machineId: string }
	| { type: 'machine.herdr'; machineId: string; herdr: MachineHerdrView }
	| { type: 'error'; message: string };

/** A session (paneId null) or terminal a user pinned to their sidebar. */
export type Pin = { id: number; machineId: string; session: string; paneId: string | null; label: string; createdAt: string };
