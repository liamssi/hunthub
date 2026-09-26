// Herdr console: session lifecycle and layout changes on a machine, carried
// out by its runner. The machine stays the source of truth: these endpoints
// only ask for changes and report the outcome; the new state arrives through
// the runner's normal session reports.
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import { z } from 'zod';
import {
	AGENT_KINDS,
	AGENT_LAUNCH,
	AGENT_STOP,
	CONSOLE_METHODS,
	MUTATING_METHODS,
	SESSION_DELETE,
	SESSION_START,
	SESSION_STOP,
	CONSOLE_POLICY_INFO,
	parsePolicy,
	policyAllows,
	TERMINAL_CONTROL,
	validateAgentName,
	validateSessionName
} from '@hunthub/shared/console';
import { db } from '../db';
import { consoleAudit, machine } from '../db/schema';
import { type AuthVariables, requireUser } from '../lib/auth-guard';
import { hasCapability } from '../machines/registry';
import { endRun, recordRun } from './agent-runs';
import { callHerdr, HerdrCallError } from './calls';
import { findAgent, machineHerdr, refreshMachine } from './state';
import { closeTerminal, openTerminal, terminalFromBrowser } from './terminals';

const SECRET_KEY = /token|secret|password|passwd|key|credential|auth|cookie|env/i;

/** Copies params for the audit log with secret-looking values and long strings trimmed. */
export function redact(value: unknown, depth = 0): unknown {
	if (depth > 4) return '[…]';
	if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
	if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			// `keys` are key names sent to a pane (Ctrl+C), not secrets.
			Object.entries(value).map(([k, v]) => [k, k !== 'keys' && SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)])
		);
	}
	return value;
}

type Outcome = { status: 200 | 400 | 403 | 404 | 409 | 504; body: Record<string, unknown> };

async function runConsoleCall(
	userId: string,
	machineId: string,
	session: string,
	method: string,
	params: Record<string, unknown>
): Promise<Outcome> {
	if (!CONSOLE_METHODS.has(method)) return { status: 400, body: { error: 'not_allowed', message: `${method} is not a console action.` } };
	const invalid = validateSessionName(session);
	if (invalid) return { status: 400, body: { error: 'invalid_name', message: invalid } };

	const [row] = await db.select({ id: machine.id, status: machine.status, policy: machine.consolePolicy }).from(machine).where(eq(machine.id, machineId));
	if (!row) return { status: 404, body: { error: 'not_found' } };
	if (row.status !== 'active') return { status: 409, body: { error: 'disabled', message: 'The machine is disabled.' } };
	const policy = parsePolicy(row.policy) ?? 'full';
	if (!policyAllows(policy, method)) return { status: 403, body: { error: 'not_allowed', message: notAllowed(policy) } };

	const mutating = MUTATING_METHODS.has(method);
	// Starting or stopping waits for Herdr; a launch with a first prompt waits for the agent too.
	const timeoutMs =
		method === AGENT_LAUNCH ? 150_000 : method === SESSION_START || method === SESSION_STOP || method === AGENT_STOP ? 30_000 : 15_000;

	let outcome: Outcome;
	let audit: { outcome: 'ok' | 'error' | 'uncertain'; error?: string };
	try {
		const result = await callHerdr(machineId, session, method, params, timeoutMs);
		outcome = { status: 200, body: { result: result ?? null } };
		audit = { outcome: 'ok' };
	} catch (err) {
		if (!(err instanceof HerdrCallError)) throw err;
		if (err.code === 'timeout') {
			// The change may or may not have happened; the UI re-reads state instead of retrying.
			outcome = {
				status: 504,
				body: {
					error: 'uncertain',
					message: "The machine didn't confirm in time. The change may or may not have happened; check the current state before retrying."
				}
			};
			audit = { outcome: 'uncertain', error: err.message };
		} else {
			outcome = { status: err.code === 'offline' ? 409 : 400, body: { error: err.code, message: err.message } };
			audit = { outcome: 'error', error: err.message };
		}
	}

	if (mutating) {
		await db
			.insert(consoleAudit)
			.values({ userId, machineId, session, method, params: redact(params) as Record<string, unknown>, ...audit })
			.catch((e) => console.error('console: failed to write audit entry', e));
	}
	return outcome;
}

const TRUSTED_ORIGINS = new Set(
	(process.env.TRUSTED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
);

/**
 * Browsers send cookies on cross-site WebSocket upgrades, so terminal sockets
 * only accept pages from this hub (same host) or a trusted origin.
 */
function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
	if (!origin) return true; // Not a browser.
	if (TRUSTED_ORIGINS.has(origin)) return true;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

const terminalQuery = z.object({
	session: z.string(),
	view: z.enum(['pane', 'session']).default('pane'),
	/** The pane; not used by the session view. */
	target: z.string().regex(/^[A-Za-z0-9:_.-]{1,64}$/).optional(),
	mode: z.enum(['observe', 'control']).default('observe'),
	transport: z.enum(['cli', 'native']).default('cli'),
	cols: z.coerce.number().int().min(10).max(1000).default(120),
	rows: z.coerce.number().int().min(4).max(500).default(32),
	takeover: z.enum(['0', '1']).default('0')
});

const sessionParam = (c: { req: { param: (k: string) => string } }) => decodeURIComponent(c.req.param('session'));

const notAllowed = (policy: Parameters<typeof policyAllows>[0]) =>
	`This machine's console access is "${CONSOLE_POLICY_INFO[policy].label}", which doesn't allow that. An admin can change it on the machine's page.`;

/** A running session to reach Herdr's machine-wide features through (the default one first). */
function integrationSession(machineId: string): string | null {
	const running = machineHerdr(machineId).sessions.filter((s) => s.state === 'running');
	return (running.find((s) => s.name === 'default') ?? running[0])?.name ?? null;
}

const launchBody = z.object({
	kind: z.enum(AGENT_KINDS.map((k) => k.kind) as [string, ...string[]]),
	name: z.string().max(32).optional(),
	placement: z.enum(['tab', 'split', 'pane']).default('tab'),
	workspaceId: z.string().max(64).optional(),
	paneId: z.string().max(64).optional(),
	direction: z.enum(['right', 'down']).default('right'),
	cwd: z.string().max(4096).optional(),
	args: z.array(z.string().max(1000)).max(20).default([]),
	prompt: z.string().max(20_000).optional()
});

export const consoleRoutes = new Hono<{ Variables: AuthVariables }>()
	.use(requireUser)
	// Start a session (new or stopped).
	.post('/:id/sessions', async (c) => {
		const body = z.object({ name: z.string() }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body' }, 400);
		const out = await runConsoleCall(c.get('user').id, c.req.param('id'), body.data.name, SESSION_START, {});
		return c.json(out.body, out.status);
	})
	.post('/:id/sessions/:session/stop', async (c) => {
		const out = await runConsoleCall(c.get('user').id, c.req.param('id'), sessionParam(c), SESSION_STOP, {});
		return c.json(out.body, out.status);
	})
	.delete('/:id/sessions/:session', async (c) => {
		const out = await runConsoleCall(c.get('user').id, c.req.param('id'), sessionParam(c), SESSION_DELETE, {});
		return c.json(out.body, out.status);
	})
	// Starts an agent in a new tab or split (or an idle pane), optionally with a first prompt.
	.post('/:id/sessions/:session/agents', async (c) => {
		const body = launchBody.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body', message: body.error.issues[0]?.message }, 400);
		const b = body.data;
		const machineId = c.req.param('id');
		const session = sessionParam(c);
		const user = c.get('user');
		const runId = crypto.randomUUID();
		const name = b.name || `${b.kind}-${runId.slice(0, 4)}`;
		const invalid = validateAgentName(name) ?? validateSessionName(session);
		if (invalid) return c.json({ error: 'invalid_name', message: invalid }, 400);
		// Recorded first, so the agent shows as HuntHub's as soon as it appears.
		const run = { id: runId, machineId, session, name, kind: b.kind, adopted: false };
		try {
			await recordRun({ ...run, userId: user.id, userName: user.name });
		} catch {
			return c.json({ error: 'agent_name_taken', message: `An agent named ${name} already exists here.` }, 409);
		}
		const out = await runConsoleCall(user.id, machineId, session, AGENT_LAUNCH, {
			run_id: runId,
			kind: b.kind,
			name,
			placement: b.placement,
			...(b.workspaceId && { workspace_id: b.workspaceId }),
			...(b.paneId && { pane_id: b.paneId }),
			direction: b.direction,
			...(b.cwd && { cwd: b.cwd }),
			args: b.args,
			...(b.prompt && { prompt: b.prompt })
		});
		// A definite failure started nothing (an uncertain one might have).
		if (out.status !== 200 && out.status !== 504) await endRun({ ...run, by: user.name, at: new Date() }).catch(() => {});
		refreshMachine(machineId);
		return c.json(out.body, out.status);
	})
	// Takes over an agent started elsewhere: it gets a Herdr name if it has none,
	// and shows as HuntHub's (adopted by this user) from then on.
	.post('/:id/sessions/:session/agents/adopt', async (c) => {
		const body = z
			.object({ paneId: z.string().max(64), name: z.string().max(32).optional() })
			.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body' }, 400);
		const machineId = c.req.param('id');
		const session = sessionParam(c);
		const user = c.get('user');
		const agent = findAgent(machineId, session, body.data.paneId);
		if (!agent) return c.json({ error: 'not_found', message: 'That agent is gone.' }, 404);
		if (agent.origin === 'hunthub') return c.json({ error: 'already_adopted', message: 'HuntHub already tracks this agent.' }, 409);
		let name = agent.herdrName;
		if (!name) {
			name = body.data.name || `${/^[a-z][a-z0-9_-]*$/.test(agent.kind ?? '') ? agent.kind : 'agent'}-${crypto.randomUUID().slice(0, 4)}`;
			const invalid = validateAgentName(name);
			if (invalid) return c.json({ error: 'invalid_name', message: invalid }, 400);
			const out = await runConsoleCall(user.id, machineId, session, 'agent.rename', { target: agent.paneId, name });
			if (out.status !== 200) return c.json(out.body, out.status);
		}
		await recordRun({ id: crypto.randomUUID(), machineId, session, name, kind: agent.kind, adopted: true, userId: user.id, userName: user.name });
		refreshMachine(machineId);
		return c.json({ result: { name } });
	})
	// Herdr's agent integrations on a machine. They belong to the machine's user,
	// not a session, but Herdr answers through a session: any running one does.
	.get('/:id/integrations', async (c) => {
		const machineId = c.req.param('id');
		const session = integrationSession(machineId);
		if (!session) return c.json({ error: 'no_session', message: 'Start a Herdr session on this machine to see its integrations.' }, 409);
		try {
			const result = await callHerdr<{ integrations?: unknown[] }>(machineId, session, 'integration.list', {}, 15_000);
			return c.json({ session, integrations: result?.integrations ?? [] });
		} catch (err) {
			if (!(err instanceof HerdrCallError)) throw err;
			return c.json({ error: err.code, message: err.message }, err.code === 'offline' ? 409 : 400);
		}
	})
	.post('/:id/integrations/:target', async (c) => {
		const body = z.object({ action: z.enum(['install', 'uninstall']) }).safeParse(await c.req.json().catch(() => null));
		const target = c.req.param('target');
		if (!body.success || !/^[a-z_]{1,32}$/.test(target)) return c.json({ error: 'invalid_body' }, 400);
		const machineId = c.req.param('id');
		const session = integrationSession(machineId);
		if (!session) return c.json({ error: 'no_session', message: 'Start a Herdr session on this machine first.' }, 409);
		const out = await runConsoleCall(c.get('user').id, machineId, session, `integration.${body.data.action}`, { target });
		return c.json(out.body, out.status);
	})
	// Any other console action inside a session (workspaces, tabs, panes, worktrees, agents).
	.post('/:id/sessions/:session/call', async (c) => {
		const body = z
			.object({ method: z.string().max(128), params: z.record(z.string(), z.unknown()).default({}) })
			.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body' }, 400);
		const out = await runConsoleCall(c.get('user').id, c.req.param('id'), sessionParam(c), body.data.method, body.data.params);
		return c.json(out.body, out.status);
	})
	// Live terminal for one pane (WebSocket). Frames arrive as {type:'frame',…};
	// the browser sends {type:'input'|'resize'|'scroll',…}.
	.get(
		'/:id/terminal',
		async (c, next) => {
			const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
			if (!sameOrigin(c.req.header('origin'), host)) return c.json({ error: 'forbidden_origin' }, 403);
			const q = terminalQuery.safeParse(c.req.query());
			if (!q.success) return c.json({ error: 'invalid_query' }, 400);
			const invalid = validateSessionName(q.data.session);
			if (invalid) return c.json({ error: 'invalid_name', message: invalid }, 400);
			if (q.data.view === 'pane' && !q.data.target) return c.json({ error: 'invalid_query', message: 'Which pane?' }, 400);
			if (q.data.mode === 'control') {
				const [row] = await db.select({ policy: machine.consolePolicy }).from(machine).where(eq(machine.id, c.req.param('id')));
				const policy = parsePolicy(row?.policy) ?? 'full';
				if (!policyAllows(policy, TERMINAL_CONTROL)) return c.json({ error: 'not_allowed', message: notAllowed(policy) }, 403);
			}
			const capability = q.data.view === 'session' ? 'session' : q.data.transport;
			if (!hasCapability(c.req.param('id'), `terminal:${capability}`)) {
				return c.json({ error: 'unsupported', message: `This machine's runner doesn't support this terminal (${capability}). Update the runner.` }, 409);
			}
			await next();
		},
		upgradeWebSocket((c) => {
			const q = terminalQuery.parse(c.req.query());
			const machineId = c.req.param('id') ?? '';
			const userId = c.get('user').id;
			let channel: string | null = null;
			return {
				onOpen(_event, ws) {
					channel = openTerminal(ws, { machineId, ...q, target: q.target ?? '', takeover: q.takeover === '1' });
					if (!channel) {
						ws.send(JSON.stringify({ type: 'closed', reason: 'The machine is offline.' }));
						ws.close(1000, 'offline');
						return;
					}
					if (q.mode === 'control') {
						void db
							.insert(consoleAudit)
							.values({
								userId,
								machineId,
								session: q.session,
								method: 'terminal.control',
								params: q.view === 'session' ? { view: 'session' } : { target: q.target, transport: q.transport, takeover: q.takeover === '1' },
								outcome: 'ok'
							})
							.catch((e) => console.error('console: failed to write audit entry', e));
					}
				},
				onMessage(event) {
					if (!channel || typeof event.data !== 'string' || event.data.length > 100_000) return;
					try {
						const msg = JSON.parse(event.data);
						// Watching never forwards keystrokes.
						if (q.mode === 'observe' && msg?.type === 'input') return;
						terminalFromBrowser(channel, msg);
					} catch {
						// Ignore malformed input.
					}
				},
				onClose() {
					if (channel) closeTerminal(channel);
				}
			};
		})
	);
