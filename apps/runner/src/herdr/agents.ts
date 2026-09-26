// Agent actions the runner carries out itself, on top of Herdr's agent API:
// - launch: a new tab or split (or an idle pane) with HUNTHUB_RUN_ID in its
//   environment, `agent.start` in it (Herdr types the agent's command into the
//   pane's shell), and optionally a first prompt once the agent is ready.
// - stop: Herdr has no agent.stop; Ctrl+C (twice, as agents ask) until it exits.
// - installed: which agent programs the user's shell can run on this machine.
// The agent's Herdr name is its durable identity (Herdr keeps names across
// restarts; the environment variable only lives as long as the shell).
import { AGENT_KINDS, validateAgentName } from '@hunthub/shared/console';
import { HerdrError, request, socketPathFor } from './client';

const ID = /^[A-Za-z0-9:_.-]{1,64}$/;
/** How long a fresh pane's shell may take to become idle (rc files loading). */
const SHELL_READY_MS = 15_000;
/** How long an agent may take to start before the first prompt is given up. */
const AGENT_READY_MS = 120_000;
const MAX_PROMPT = 20_000;

type AgentInfo = { name?: string | null; launch_pending?: boolean; interactive_ready?: boolean; agent_status?: string };

export type LaunchParams = {
	runId: string;
	kind: string;
	name: string;
	placement: 'tab' | 'split' | 'pane';
	workspaceId?: string;
	paneId?: string;
	direction: 'right' | 'down';
	cwd?: string;
	args: string[];
	prompt?: string;
};

/** Validates the hub's launch request. */
export function parseLaunch(params: Record<string, unknown>): LaunchParams {
	const bad = (message: string) => new HerdrError('invalid_params', message);
	const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

	const runId = str(params.run_id);
	if (!runId || !/^[0-9a-f-]{36}$/.test(runId)) throw bad('Missing run id.');
	const kind = str(params.kind);
	if (!kind || !AGENT_KINDS.some((k) => k.kind === kind)) throw bad('Unknown agent kind.');
	const name = str(params.name) ?? `${kind}-${runId.slice(0, 4)}`;
	const invalidName = validateAgentName(name);
	if (invalidName) throw bad(invalidName);

	const placement = params.placement ?? 'tab';
	if (placement !== 'tab' && placement !== 'split' && placement !== 'pane') throw bad('Invalid placement.');
	const workspaceId = str(params.workspace_id);
	const paneId = str(params.pane_id);
	if (workspaceId && !ID.test(workspaceId)) throw bad('Invalid workspace.');
	if (paneId && !ID.test(paneId)) throw bad('Invalid pane.');
	if (placement === 'tab' && !workspaceId) throw bad('Choose a space for the new tab.');
	if (placement !== 'tab' && !paneId) throw bad('Choose a pane.');
	const direction = params.direction === 'down' ? 'down' : 'right';

	const cwd = str(params.cwd);
	if (cwd && (!cwd.startsWith('/') || cwd.length > 4096 || /[\0\n\r]/.test(cwd))) throw bad('The folder must be an absolute path.');
	const args = params.args ?? [];
	if (!Array.isArray(args) || args.length > 20 || args.some((a) => typeof a !== 'string' || a.length > 1000 || /[\x00-\x1f\x7f]/.test(a))) {
		throw bad('Invalid arguments.');
	}
	const prompt = str(params.prompt);
	if (prompt && prompt.length > MAX_PROMPT) throw bad('The prompt is too long.');

	return { runId, kind, name, placement, workspaceId, paneId, direction, cwd, args: args as string[], prompt };
}

/**
 * Creates the agent's pane and starts the agent in it. Returns once Herdr has
 * typed the command (the agent itself is still starting).
 */
export async function startAgent(session: string, p: LaunchParams): Promise<{ paneId: string; created: boolean }> {
	const socket = socketPathFor(session);
	const env = { HUNTHUB_RUN_ID: p.runId };
	let paneId: string;
	let created = false;
	if (p.placement === 'tab') {
		const r = await request<{ root_pane?: { pane_id?: string } }>(socket, 'tab.create', {
			workspace_id: p.workspaceId,
			...(p.cwd && { cwd: p.cwd }),
			label: p.name,
			env,
			focus: false
		});
		paneId = r.root_pane?.pane_id ?? '';
		created = true;
	} else if (p.placement === 'split') {
		const r = await request<{ pane?: { pane_id?: string } }>(socket, 'pane.split', {
			target_pane_id: p.paneId,
			direction: p.direction,
			...(p.cwd && { cwd: p.cwd }),
			env,
			focus: false
		});
		paneId = r.pane?.pane_id ?? '';
		created = true;
	} else {
		paneId = p.paneId!;
	}
	if (!paneId) throw new HerdrError('unavailable', "Herdr didn't report the new pane.");

	try {
		// A new pane's shell is busy loading its rc files for a moment; Herdr refuses until it's idle.
		const deadline = Date.now() + (created ? SHELL_READY_MS : 0);
		for (;;) {
			try {
				await request(socket, 'agent.start', { name: p.name, kind: p.kind, pane_id: paneId, args: p.args, timeout_ms: AGENT_READY_MS });
				break;
			} catch (err) {
				const busy = err instanceof HerdrError && (err.code === 'agent_pane_busy' || err.code === 'agent_pane_unavailable');
				if (!busy || Date.now() > deadline) throw err;
				await Bun.sleep(400);
			}
		}
	} catch (err) {
		// Don't leave an empty tab or split behind.
		if (created) await request(socket, 'pane.close', { pane_id: paneId }).catch(() => {});
		throw err;
	}
	return { paneId, created };
}

/**
 * Waits until the agent can take a prompt, then gives it one. Ready means idle
 * twice in a row: an agent that starts with a question (e.g. whether to trust
 * the folder) must never have it answered by the prompt's Enter.
 */
export async function promptWhenReady(session: string, name: string, text: string): Promise<void> {
	const socket = socketPathFor(session);
	const deadline = Date.now() + AGENT_READY_MS;
	let idleSeen = 0;
	for (;;) {
		let agent: AgentInfo | undefined;
		try {
			agent = (await request<{ agent?: AgentInfo }>(socket, 'agent.get', { target: name })).agent;
		} catch (err) {
			// The name is cleared when the launch fails (the program exited or never showed up).
			if (err instanceof HerdrError && err.code === 'agent_not_found') {
				throw new HerdrError('agent_launch_failed', `${name} didn't start (check its pane).`);
			}
			throw err;
		}
		if (agent?.agent_status === 'blocked') {
			throw new HerdrError('agent_blocked', `${name} is asking something first (e.g. whether to trust the folder). Answer it in its pane, then send the prompt.`);
		}
		const idle = !!agent && !agent.launch_pending && agent.interactive_ready && agent.agent_status === 'idle';
		idleSeen = idle ? idleSeen + 1 : 0;
		if (idleSeen >= 2) break;
		if (Date.now() > deadline) throw new HerdrError('agent_not_ready', `${name} wasn't ready for the prompt in time.`);
		await Bun.sleep(1000);
	}
	await request(socket, 'agent.prompt', { target: name, text });
}

/** Whether a pane still hosts an agent. */
async function hostsAgent(socket: string, paneId: string): Promise<boolean> {
	try {
		await request(socket, 'agent.get', { target: paneId });
		return true;
	} catch (err) {
		if (err instanceof HerdrError && (err.code === 'agent_not_found' || err.code === 'pane_not_found')) return false;
		throw err;
	}
}

/**
 * Stops the agent in a pane with Ctrl+C (twice per round: agents like Claude
 * Code and Codex ask for a second one), leaving the pane's shell. Returns
 * whether it stopped; if not, the caller can close the pane instead.
 */
export async function stopAgent(session: string, params: Record<string, unknown>): Promise<{ stopped: boolean }> {
	const paneId = params.pane_id;
	if (typeof paneId !== 'string' || !ID.test(paneId)) throw new HerdrError('invalid_params', 'Invalid pane.');
	const socket = socketPathFor(session);
	for (let round = 0; round < 3; round++) {
		if (!(await hostsAgent(socket, paneId))) return { stopped: true };
		await request(socket, 'pane.send_input', { pane_id: paneId, keys: ['C-c'] });
		await Bun.sleep(150);
		await request(socket, 'pane.send_input', { pane_id: paneId, keys: ['C-c'] });
		// Herdr notices the exit within a moment.
		for (let i = 0; i < 6; i++) {
			await Bun.sleep(300);
			if (!(await hostsAgent(socket, paneId))) return { stopped: true };
		}
	}
	return { stopped: false };
}

const INSTALLED_TTL_MS = 5 * 60_000;
let installed: { at: number; kinds: string[] } | null = null;

/**
 * Agent kinds whose program the user's login shell can run (the pane's shell
 * resolves the command, so its PATH is what counts). Cached for a few minutes.
 */
export async function installedKinds(): Promise<{ kinds: string[] }> {
	if (installed && Date.now() - installed.at < INSTALLED_TTL_MS) return { kinds: installed.kinds };
	const exes = AGENT_KINDS.map((k) => k.exe);
	const script = `for c in ${exes.join(' ')}; do command -v "$c" >/dev/null 2>&1 && printf 'hunthub-found:%s\\n' "$c"; done`;
	const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('HERDR_')));
	const shell = process.env.SHELL || '/bin/sh';
	let out = '';
	try {
		const proc = Bun.spawn([shell, '-ilc', script], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
		const timer = setTimeout(() => proc.kill(), 8000);
		out = await new Response(proc.stdout).text();
		clearTimeout(timer);
	} catch {
		// No shell: nothing is known to be installed.
	}
	const found = new Set([...out.matchAll(/^hunthub-found:(\S+)$/gm)].map((m) => m[1]));
	const kinds = AGENT_KINDS.filter((k) => found.has(k.exe)).map((k) => k.kind);
	installed = { at: Date.now(), kinds };
	return { kinds };
}
