// Machine data shared by the API responses, the browser live channel and the UI.
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
	/** Herdr's agent name (e.g. "claude", or a custom label). */
	name: string;
	status: AgentStatus;
	cwd: string | null;
	/** Started outside HuntHub (all agents are, until M3). */
	origin: 'external';
};

export type PaneView = {
	id: string;
	cwd: string | null;
	/** The agent running in this pane, if Herdr recognises one. */
	agent: { name: string; status: AgentStatus } | null;
};

export type TabView = {
	id: string;
	label: string;
	panes: PaneView[];
};

export type WorkspaceView = {
	id: string;
	label: string;
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
