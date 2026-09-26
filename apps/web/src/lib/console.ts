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

/** Runs an action and shows the outcome; returns whether it succeeded. */
async function run(label: string, url: string, init: RequestInit, successMessage?: string): Promise<boolean> {
	const out = await send(url, init);
	if (out.ok) {
		if (successMessage) toast.success(successMessage);
		return true;
	}
	if (out.code === 'uncertain') toast.warning(`${label}: not confirmed`, { description: out.message });
	else toast.error(`${label} failed`, { description: out.message });
	return false;
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
