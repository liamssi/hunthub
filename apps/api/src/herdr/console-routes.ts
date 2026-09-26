// Herdr console: session lifecycle and layout changes on a machine, carried
// out by its runner. The machine stays the source of truth: these endpoints
// only ask for changes and report the outcome; the new state arrives through
// the runner's normal session reports.
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import { z } from 'zod';
import {
	CONSOLE_METHODS,
	MUTATING_METHODS,
	SESSION_DELETE,
	SESSION_START,
	SESSION_STOP,
	validateSessionName
} from '@hunthub/shared/console';
import { db } from '../db';
import { consoleAudit, machine } from '../db/schema';
import { type AuthVariables, requireUser } from '../lib/auth-guard';
import { hasCapability } from '../machines/registry';
import { callHerdr, HerdrCallError } from './calls';
import { closeTerminal, openTerminal, terminalFromBrowser } from './terminals';

const SECRET_KEY = /token|secret|password|passwd|key|credential|auth|cookie|env/i;

/** Copies params for the audit log with secret-looking values and long strings trimmed. */
export function redact(value: unknown, depth = 0): unknown {
	if (depth > 4) return '[…]';
	if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
	if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)])
		);
	}
	return value;
}

type Outcome = { status: 200 | 400 | 404 | 409 | 504; body: Record<string, unknown> };

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

	const [row] = await db.select({ id: machine.id, status: machine.status }).from(machine).where(eq(machine.id, machineId));
	if (!row) return { status: 404, body: { error: 'not_found' } };
	if (row.status !== 'active') return { status: 409, body: { error: 'disabled', message: 'The machine is disabled.' } };

	const mutating = MUTATING_METHODS.has(method);
	// Starting or stopping waits for Herdr; allow more time than a plain call.
	const timeoutMs = method === SESSION_START || method === SESSION_STOP ? 30_000 : 15_000;

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
	target: z.string().regex(/^[A-Za-z0-9:_.-]{1,64}$/),
	mode: z.enum(['observe', 'control']).default('observe'),
	transport: z.enum(['cli', 'native']).default('cli'),
	cols: z.coerce.number().int().min(10).max(1000).default(120),
	rows: z.coerce.number().int().min(4).max(500).default(32),
	takeover: z.enum(['0', '1']).default('0')
});

const sessionParam = (c: { req: { param: (k: string) => string } }) => decodeURIComponent(c.req.param('session'));

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
	// Any other console action inside a session (workspaces, tabs, panes, worktrees).
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
			if (!hasCapability(c.req.param('id'), `terminal:${q.data.transport}`)) {
				return c.json({ error: 'unsupported', message: `This machine's runner doesn't support the ${q.data.transport} terminal. Update the runner.` }, 409);
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
					channel = openTerminal(ws, { machineId, ...q, takeover: q.takeover === '1' });
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
								params: { target: q.target, transport: q.transport, takeover: q.takeover === '1' },
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
