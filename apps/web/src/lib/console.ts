// Browser helpers for Herdr console actions. They only ask the machine for a
// change and report the outcome; the new state arrives through live updates,
// because the machine is the source of truth.
import { toast } from 'svelte-sonner';

type Outcome = { ok: true; result: unknown } | { ok: false; code: string; message: string };

async function send(url: string, init: RequestInit): Promise<Outcome> {
	let res: Response;
	try {
		res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init });
	} catch {
		return { ok: false, code: 'network', message: 'Could not reach HuntHub.' };
	}
	const body = await res.json().catch(() => ({}));
	if (res.ok) return { ok: true, result: body.result };
	return { ok: false, code: body.error ?? 'failed', message: body.message ?? 'The action failed.' };
}

/** Runs an action and shows the outcome (errors always; success only with a message). */
async function runWithResult(label: string, url: string, init: RequestInit, successMessage?: string): Promise<Outcome> {
	const out = await send(url, init);
	if (out.ok) {
		if (successMessage) toast.success(successMessage);
	} else if (out.code === 'uncertain') toast.warning(`${label}: not confirmed`, { description: out.message });
	else toast.error(`${label} failed`, { description: out.message });
	return out;
}

/** Runs an action and shows the outcome; returns whether it succeeded. */
async function run(label: string, url: string, init: RequestInit, successMessage?: string): Promise<boolean> {
	return (await runWithResult(label, url, init, successMessage)).ok;
}

const base = (machineId: string) => `/api/machines/${machineId}/sessions`;
const sessionUrl = (machineId: string, session: string) => `${base(machineId)}/${encodeURIComponent(session)}`;

export const startSession = (machineId: string, name: string) =>
	run('Start session', base(machineId), { method: 'POST', body: JSON.stringify({ name }) }, `Session ${name} started`);

export const stopSession = (machineId: string, name: string) =>
	run('Stop session', `${sessionUrl(machineId, name)}/stop`, { method: 'POST' }, `Session ${name} stopped`);

export const deleteSession = (machineId: string, name: string) =>
	run('Delete session', sessionUrl(machineId, name), { method: 'DELETE' }, `Session ${name} deleted`);

/** A Herdr action inside a session (workspaces, tabs, panes, worktrees). */
export const consoleCall = (
	machineId: string,
	session: string,
	label: string,
	method: string,
	params: Record<string, unknown>,
	successMessage?: string
) =>
	run(label, `${sessionUrl(machineId, session)}/call`, { method: 'POST', body: JSON.stringify({ method, params }) }, successMessage);

/** Like `consoleCall`, but also returns Herdr's result (e.g. the pane a split created). */
export const consoleRequest = (machineId: string, session: string, label: string, method: string, params: Record<string, unknown>) =>
	runWithResult(label, `${sessionUrl(machineId, session)}/call`, { method: 'POST', body: JSON.stringify({ method, params }) });

/** A read-only call that reports its outcome without toasts (the caller shows errors in place). */
export const consoleQuery = (machineId: string, session: string, method: string, params: Record<string, unknown>) =>
	send(`${sessionUrl(machineId, session)}/call`, { method: 'POST', body: JSON.stringify({ method, params }) });

// --- Agents -------------------------------------------------------------------

export type LaunchRequest = {
	kind: string;
	name?: string;
	placement: 'tab' | 'split';
	workspaceId?: string;
	paneId?: string;
	direction?: 'right' | 'down';
	cwd?: string;
	prompt?: string;
};

/**
 * Starts an agent (a new tab or split with it, optionally given a first prompt
 * once it's ready). Resolves with the outcome, without toasts: the caller shows
 * its progress, since a first prompt can take a while.
 */
export const launchAgent = (machineId: string, session: string, request: LaunchRequest) =>
	send(`${sessionUrl(machineId, session)}/agents`, { method: 'POST', body: JSON.stringify(request) });

/** Makes an agent started elsewhere HuntHub's (it gets a Herdr name if it has none). */
export const adoptAgent = (machineId: string, session: string, paneId: string, label: string) =>
	run('Adopt agent', `${sessionUrl(machineId, session)}/agents/adopt`, { method: 'POST', body: JSON.stringify({ paneId }) }, `${label} adopted`);

const KINDS_TTL_MS = 5 * 60_000;
const kindsCache = new Map<string, { at: number; kinds: string[] }>();

/** Agent kinds installed on a machine (checked by its runner; cached for a few minutes). */
export async function installedAgentKinds(machineId: string, session: string): Promise<string[] | null> {
	const hit = kindsCache.get(machineId);
	if (hit && Date.now() - hit.at < KINDS_TTL_MS) return hit.kinds;
	const out = await send(`${sessionUrl(machineId, session)}/call`, { method: 'POST', body: JSON.stringify({ method: 'hunthub.agent.kinds', params: {} }) });
	if (!out.ok) return null;
	const kinds = (out.result as { kinds?: string[] }).kinds ?? [];
	kindsCache.set(machineId, { at: Date.now(), kinds });
	return kinds;
}

/**
 * Gives an agent a prompt through Herdr (pasted, then Enter). Herdr refuses while
 * the agent asks something or isn't ready; `typeIntoPane` sends it regardless.
 */
export const promptAgent = (machineId: string, session: string, paneId: string, text: string) =>
	send(`${sessionUrl(machineId, session)}/call`, { method: 'POST', body: JSON.stringify({ method: 'agent.prompt', params: { target: paneId, text } }) });

/** Types text into a pane as if at its keyboard, optionally pressing Enter. */
export const typeIntoPane = (machineId: string, session: string, paneId: string, text: string, enter: boolean) =>
	send(`${sessionUrl(machineId, session)}/call`, {
		method: 'POST',
		body: JSON.stringify({ method: 'pane.send_input', params: { pane_id: paneId, text, ...(enter && { keys: ['Enter'] }) } })
	});

/** Stops the agent in a pane (Ctrl+C until it exits). Resolves whether it stopped. */
export async function stopAgent(machineId: string, session: string, paneId: string, label: string): Promise<boolean | null> {
	const out = await runWithResult('Stop agent', `${sessionUrl(machineId, session)}/call`, {
		method: 'POST',
		body: JSON.stringify({ method: 'hunthub.agent.stop', params: { pane_id: paneId } })
	});
	if (!out.ok) return null;
	const stopped = !!(out.result as { stopped?: boolean }).stopped;
	if (stopped) toast.success(`${label} stopped`);
	return stopped;
}
