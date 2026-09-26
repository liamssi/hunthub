// Herdr console actions, shared by the hub (routes, audit) and the runner
// (enforcement). Keeping one list prevents the two from drifting apart.

/** Herdr methods that only read. */
export const READ_METHODS = [
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
	'agent.explain',
	'worktree.list'
] as const;

/** Herdr methods that change a session's layout. */
export const MANAGE_METHODS = [
	'workspace.create',
	'workspace.rename',
	'workspace.close',
	'tab.create',
	'tab.rename',
	'tab.close',
	'pane.split',
	'pane.rename',
	'pane.close',
	'pane.zoom',
	'layout.set_split_ratio',
	'worktree.create',
	'worktree.open',
	'worktree.remove'
] as const;

/** Session lifecycle, carried out by the runner itself (not Herdr socket calls). */
export const SESSION_START = 'hunthub.session.start';
export const SESSION_STOP = 'hunthub.session.stop';
export const SESSION_DELETE = 'hunthub.session.delete';
export const LIFECYCLE_METHODS = [SESSION_START, SESSION_STOP, SESSION_DELETE] as const;

/**
 * Read-only file browsing, done by the runner itself within the session's
 * project folders (see the runner's herdr/files.ts).
 */
export const FS_ROOTS = 'hunthub.fs.roots';
export const FS_LIST = 'hunthub.fs.list';
export const FS_READ = 'hunthub.fs.read';
/** A pane's history as HuntHub has seen it (the runner keeps a transcript beyond Herdr's last 1000 lines). */
export const PANE_HISTORY = 'hunthub.pane.history';
export const FILE_METHODS = [FS_ROOTS, FS_LIST, FS_READ, PANE_HISTORY] as const;

/** Herdr methods that start, talk to or name agents (and type into panes). */
export const AGENT_METHODS = ['agent.start', 'agent.prompt', 'agent.send_keys', 'agent.rename', 'pane.send_input', 'pane.send_keys'] as const;

/**
 * Agent actions carried out by the runner (see its herdr/agents.ts): launching
 * one in a new tab or split (optionally with a first prompt once it's ready),
 * stopping one, and which agent programs are installed on the machine.
 */
export const AGENT_LAUNCH = 'hunthub.agent.launch';
export const AGENT_STOP = 'hunthub.agent.stop';
export const AGENT_KINDS_INSTALLED = 'hunthub.agent.kinds';
export const RUNNER_AGENT_METHODS = [AGENT_LAUNCH, AGENT_STOP, AGENT_KINDS_INSTALLED] as const;

export type ConsoleMethod =
	| (typeof READ_METHODS)[number]
	| (typeof MANAGE_METHODS)[number]
	| (typeof LIFECYCLE_METHODS)[number]
	| (typeof FILE_METHODS)[number]
	| (typeof AGENT_METHODS)[number]
	| (typeof RUNNER_AGENT_METHODS)[number];

/** Everything the console may do. For now every user may do everything; tiers come later. */
export const CONSOLE_METHODS: ReadonlySet<string> = new Set([
	...READ_METHODS,
	...MANAGE_METHODS,
	...LIFECYCLE_METHODS,
	...FILE_METHODS,
	...AGENT_METHODS,
	...RUNNER_AGENT_METHODS
]);

/** Methods that change something; these are serialized per session and audited. */
export const MUTATING_METHODS: ReadonlySet<string> = new Set([
	...MANAGE_METHODS,
	...LIFECYCLE_METHODS,
	...AGENT_METHODS,
	AGENT_LAUNCH,
	AGENT_STOP
]);

/**
 * Agents HuntHub offers to start, as Herdr knows them (`kind` is Herdr's label,
 * `exe` the program Herdr types into the pane's shell).
 */
export const AGENT_KINDS = [
	{ kind: 'claude', label: 'Claude Code', exe: 'claude' },
	{ kind: 'codex', label: 'Codex', exe: 'codex' },
	{ kind: 'gemini', label: 'Gemini CLI', exe: 'gemini' },
	{ kind: 'opencode', label: 'opencode', exe: 'opencode' },
	{ kind: 'cursor', label: 'Cursor Agent', exe: 'cursor-agent' },
	{ kind: 'copilot', label: 'GitHub Copilot', exe: 'copilot' },
	{ kind: 'amp', label: 'Amp', exe: 'amp' },
	{ kind: 'droid', label: 'Droid', exe: 'droid' },
	{ kind: 'qwen', label: 'Qwen Code', exe: 'qwen' },
	{ kind: 'kimi', label: 'Kimi', exe: 'kimi' },
	{ kind: 'grok', label: 'Grok', exe: 'grok' },
	{ kind: 'kiro', label: 'Kiro', exe: 'kiro-cli' },
	{ kind: 'cline', label: 'Cline', exe: 'cline' },
	{ kind: 'kilo', label: 'Kilo Code', exe: 'kilo' },
	{ kind: 'pi', label: 'Pi', exe: 'pi' },
	{ kind: 'hermes', label: 'Hermes', exe: 'hermes' }
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number]['kind'];

/** Herdr's agent name rules: a lowercase letter, then lowercase letters, digits, '_' or '-', at most 32. */
export function validateAgentName(name: string): string | null {
	if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) {
		return 'Agent names start with a lowercase letter and use lowercase letters, digits, - and _ (at most 32).';
	}
	return null;
}

/** Creating these must never take focus from whoever uses the session locally. */
export const CREATE_METHODS: ReadonlySet<string> = new Set([
	'workspace.create',
	'tab.create',
	'pane.split',
	'worktree.create',
	'worktree.open'
]);

/** Herdr's session name rules: ASCII letters, digits, '.', '_' and '-', at most 64 bytes. */
export function validateSessionName(name: string): string | null {
	if (!name) return 'Session name cannot be empty.';
	if (name.length > 64) return 'Session name cannot be longer than 64 characters.';
	if (name === '.' || name === '..') return 'Session name cannot be . or ..';
	if (!/^[A-Za-z0-9._-]+$/.test(name)) return "Session name may only contain letters, numbers, '.', '_' and '-'.";
	return null;
}
