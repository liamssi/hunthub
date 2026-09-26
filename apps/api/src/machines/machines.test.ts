// Integration tests for machine enrollment, the runner WebSocket and admin
// endpoints. They run against the dev database and clean up after themselves.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { websocket } from 'hono/bun';
import { RUNNER_CLOSE, RUNNER_PROTOCOL_VERSION } from '@hunthub/shared/runner-protocol';
import { app } from '../app';
import { auth } from '../auth';
import { db } from '../db';
import { consoleAudit, machine, machineJoinToken, user } from '../db/schema';
import { connectionSettings, setConnectionSettingsInMemory } from './connection-settings';
import { startOfflineSweep, stopOfflineSweep } from './registry';

const host = {
	hostname: 'test-host',
	os: 'Test OS',
	kernel: '1.0',
	arch: 'x64',
	cpuModel: 'Test CPU',
	cpuCores: 2,
	memTotal: 1024,
	privateIps: [],
	herdrVersion: null
};

let server: ReturnType<typeof Bun.serve>;
let base: string;
let adminCookie: string;
const email = `test-admin-${Date.now()}@hunthub.test`;
const createdMachines: string[] = [];
const savedSettings = { ...connectionSettings() };

beforeAll(async () => {
	server = Bun.serve({ port: 0, fetch: app.fetch, websocket });
	base = `http://localhost:${server.port}`;
	await auth.api.createUser({ body: { email, name: 'Test Admin', password: 'test-password-123', role: 'admin' } });
	const signIn = await auth.api.signInEmail({ body: { email, password: 'test-password-123' }, returnHeaders: true });
	adminCookie = signIn.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	setConnectionSettingsInMemory({ heartbeatIntervalMs: 500, offlineAfterMs: 1500, statsIntervalMs: 1000 });
	startOfflineSweep();
});

afterAll(async () => {
	stopOfflineSweep();
	setConnectionSettingsInMemory(savedSettings);
	const ids = createdMachines.filter(Boolean);
	if (ids.length) {
		await db.delete(consoleAudit).where(inArray(consoleAudit.machineId, ids));
		await db.delete(machine).where(inArray(machine.id, ids));
	}
	await db.delete(user).where(eq(user.email, email));
	server.stop(true);
});

const api = (path: string, init: RequestInit = {}) =>
	fetch(`${base}/api${path}`, {
		...init,
		headers: { 'content-type': 'application/json', cookie: adminCookie, ...(init.headers ?? {}) }
	});

async function createToken(name = 'test-machine') {
	const res = await api('/machines/join-tokens', { method: 'POST', body: JSON.stringify({ name, tags: ['test'] }) });
	expect(res.status).toBe(201);
	return (await res.json()) as { token: string; tokenId: string; installCommand: string };
}

let enrollCount = 0;

function enroll(token: string) {
	return fetch(`${base}/api/runner/enroll`, {
		method: 'POST',
		// A distinct client address per call keeps the suite under the per-IP enroll rate limit.
		headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.99.0.${++enrollCount}` },
		body: JSON.stringify({ token, runnerVersion: 'test', host })
	});
}

async function enrolledMachine() {
	const { token } = await createToken();
	const res = await enroll(token);
	const body = (await res.json()) as { machineId: string; credential: string };
	createdMachines.push(body.machineId);
	return body;
}

type Conn = { ws: WebSocket; messages: any[]; closed: Promise<{ code: number; reason: string }> };

function connectRunner(credential: string, protocol = RUNNER_PROTOCOL_VERSION): Conn {
	const ws = new WebSocket(`${base.replace('http', 'ws')}/api/runner/ws`, {
		headers: { authorization: `Bearer ${credential}` }
	});
	const messages: any[] = [];
	const closed = new Promise<{ code: number; reason: string }>((resolve) => {
		ws.onclose = (e) => resolve({ code: e.code, reason: e.reason });
	});
	ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', protocol, runnerVersion: 'test', capabilities: [], host }));
	ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
	return { ws, messages, closed };
}

async function waitFor(check: () => boolean, ms = 3000) {
	const until = Date.now() + ms;
	while (!check()) {
		if (Date.now() > until) throw new Error('timed out waiting');
		await Bun.sleep(25);
	}
}

const wsProbe = (credential: string) =>
	fetch(`${base}/api/runner/ws`, { headers: { authorization: `Bearer ${credential}` } });

const connectionOf = async (machineId: string) => {
	const list = (await (await api('/machines')).json()) as { machines: { id: string; connection: string }[] };
	return list.machines.find((m) => m.id === machineId)?.connection;
};

describe('join tokens and enrollment', () => {
	test('creating a join token requires a signed-in admin', async () => {
		const res = await fetch(`${base}/api/machines/join-tokens`, { method: 'POST', body: '{}' });
		expect(res.status).toBe(401);
	});

	test('the install command points at the install script', async () => {
		const { installCommand, token } = await createToken();
		expect(installCommand).toContain('/api/install.sh');
		expect(installCommand).toContain(token);
	});

	test('a token enrolls exactly once', async () => {
		const { token } = await createToken();
		const first = await enroll(token);
		expect(first.status).toBe(201);
		createdMachines.push(((await first.json()) as { machineId: string }).machineId);
		expect((await enroll(token)).status).toBe(401);
	});

	test('an expired token is rejected', async () => {
		const { token, tokenId } = await createToken();
		await db
			.update(machineJoinToken)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(machineJoinToken.id, tokenId));
		expect((await enroll(token)).status).toBe(401);
	});
});

describe('runner websocket', () => {
	test('an unknown credential is refused as revoked', async () => {
		const res = await wsProbe('hh_mc_nope');
		expect(res.status).toBe(401);
		expect(((await res.json()) as { error: string }).error).toBe('revoked');
	});

	test('a valid hello gets a welcome with the current timings', async () => {
		const { credential, machineId } = await enrolledMachine();
		const conn = connectRunner(credential);
		await waitFor(() => conn.messages.length > 0);
		expect(conn.messages[0]).toMatchObject({ type: 'welcome', machineId, heartbeatIntervalMs: 500, statsIntervalMs: 1000 });
		expect(await connectionOf(machineId)).toBe('online');
		conn.ws.close();
	});

	test('a protocol mismatch is closed as incompatible', async () => {
		const { credential } = await enrolledMachine();
		const conn = connectRunner(credential, 999);
		expect((await conn.closed).code).toBe(RUNNER_CLOSE.incompatible);
	});

	test('a silent runner is marked offline after the configured threshold', async () => {
		const { credential, machineId } = await enrolledMachine();
		const conn = connectRunner(credential);
		await waitFor(() => conn.messages.length > 0);
		const started = Date.now();
		expect((await conn.closed).code).toBe(4008);
		// 1.5s threshold, checked every second.
		expect(Date.now() - started).toBeLessThan(3000);
		expect(await connectionOf(machineId)).toBe('offline');
	});

	test('disabling kicks the runner and blocks reconnects; enabling allows them', async () => {
		const { credential, machineId } = await enrolledMachine();
		const conn = connectRunner(credential);
		await waitFor(() => conn.messages.length > 0);
		expect((await api(`/machines/${machineId}/disable`, { method: 'POST' })).status).toBe(200);
		expect((await conn.closed).code).toBe(RUNNER_CLOSE.disabled);
		expect((await wsProbe(credential)).status).toBe(403);
		expect((await api(`/machines/${machineId}/enable`, { method: 'POST' })).status).toBe(200);
		const again = connectRunner(credential);
		await waitFor(() => again.messages.length > 0);
		expect(again.messages[0].type).toBe('welcome');
		again.ws.close();
	});

	test('removing a machine revokes its credential', async () => {
		const { credential, machineId } = await enrolledMachine();
		const conn = connectRunner(credential);
		await waitFor(() => conn.messages.length > 0);
		expect((await api(`/machines/${machineId}`, { method: 'DELETE' })).status).toBe(200);
		expect((await conn.closed).code).toBe(RUNNER_CLOSE.revoked);
		expect((await wsProbe(credential)).status).toBe(401);
	});

	test('credential rotation swaps the credential once the runner confirms', async () => {
		const { credential, machineId } = await enrolledMachine();
		const conn = connectRunner(credential);
		await waitFor(() => conn.messages.length > 0);
		expect((await api(`/machines/${machineId}/rotate-credential`, { method: 'POST' })).status).toBe(200);
		await waitFor(() => conn.messages.some((m) => m.type === 'credential.rotate'));
		const next = conn.messages.find((m) => m.type === 'credential.rotate').credential as string;
		conn.ws.send(JSON.stringify({ type: 'credential.rotated' }));
		await Bun.sleep(300); // let the server store the new credential
		conn.ws.close();
		expect((await wsProbe(credential)).status).toBe(401);
		const withNew = connectRunner(next);
		await waitFor(() => withNew.messages.length > 0);
		expect(withNew.messages[0].type).toBe('welcome');
		withNew.ws.close();
	});
});

describe('herdr reports', () => {
	const snapshot = {
		workspaces: [{ workspace_id: 'w1', label: 'ws-one', agent_status: 'blocked', pane_count: 1 }],
		agents: [{ pane_id: 'w1:p1', workspace_id: 'w1', agent: 'claude', agent_status: 'blocked', cwd: '/srv/app' }]
	};

	function connectHerdrRunner(credential: string): Conn {
		const ws = new WebSocket(`${base.replace('http', 'ws')}/api/runner/ws`, {
			headers: { authorization: `Bearer ${credential}` }
		});
		const messages: any[] = [];
		const closed = new Promise<{ code: number; reason: string }>((resolve) => {
			ws.onclose = (e) => resolve({ code: e.code, reason: e.reason });
		});
		ws.onopen = () =>
			ws.send(JSON.stringify({ type: 'hello', protocol: RUNNER_PROTOCOL_VERSION, runnerVersion: 'test', capabilities: ['herdr'], host }));
		ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
		return { ws, messages, closed };
	}

	test('session reports become agents, counts and a machine view', async () => {
		const { credential, machineId } = await enrolledMachine();
		const conn = connectHerdrRunner(credential);
		await waitFor(() => conn.messages.length > 0);
		conn.ws.send(JSON.stringify({ type: 'herdr.session', session: { name: 'main', state: 'running', snapshot } }));
		await Bun.sleep(100);

		const agents = (await (await api('/agents')).json()) as { agents: { machineId: string; name: string; status: string }[] };
		expect(agents.agents.filter((a) => a.machineId === machineId)).toEqual([
			expect.objectContaining({ name: 'claude', status: 'blocked', session: 'main', workspaceLabel: 'ws-one', cwd: '/srv/app' })
		]);
		const view = (await (await api(`/machines/${machineId}/herdr`)).json()) as { supported: boolean; sessions: { name: string }[] };
		expect(view.supported).toBe(true);
		expect(view.sessions.map((s) => s.name)).toEqual(['main']);
		const list = (await (await api('/machines')).json()) as { machines: { id: string; agents: number | null }[] };
		expect(list.machines.find((m) => m.id === machineId)?.agents).toBe(1);

		// Removing the session removes its agents; disconnecting clears the machine.
		conn.ws.send(JSON.stringify({ type: 'herdr.session.removed', name: 'main' }));
		await Bun.sleep(100);
		const after = (await (await api('/agents')).json()) as { agents: { machineId: string }[] };
		expect(after.agents.some((a) => a.machineId === machineId)).toBe(false);
		conn.ws.close();
	});

	test('pane output is fetched through the runner', async () => {
		const { credential, machineId } = await enrolledMachine();
		const conn = connectHerdrRunner(credential);
		await waitFor(() => conn.messages.length > 0);
		// Answer the hub's herdr.call like a runner would.
		conn.ws.onmessage = (e) => {
			const msg = JSON.parse(String(e.data));
			if (msg.type !== 'herdr.call') return;
			expect(msg).toMatchObject({ session: 'main', method: 'pane.read', params: { pane_id: 'w1:p1' } });
			conn.ws.send(JSON.stringify({ type: 'herdr.result', id: msg.id, ok: true, result: { type: 'pane_read', text: 'hello from the pane' } }));
		};
		const res = await api(`/machines/${machineId}/sessions/main/panes/w1:p1/output?lines=10`);
		expect(await res.json()).toEqual({ text: 'hello from the pane' });
		conn.ws.close();
	});

	test('pane output from an offline machine fails cleanly', async () => {
		const { machineId } = await enrolledMachine();
		const res = await api(`/machines/${machineId}/sessions/main/panes/w1:p1/output`);
		expect(res.status).toBe(409);
	});
});

describe('herdr console', () => {
	/** A fake runner that answers every herdr.call with a canned result. */
	async function answeringRunner(answer: (msg: any) => { ok: boolean; result?: unknown; error?: { code: string; message: string } }) {
		const { credential, machineId } = await enrolledMachine();
		const ws = new WebSocket(`${base.replace('http', 'ws')}/api/runner/ws`, { headers: { authorization: `Bearer ${credential}` } });
		const calls: any[] = [];
		await new Promise<void>((resolve) => {
			ws.onopen = () =>
				ws.send(JSON.stringify({ type: 'hello', protocol: RUNNER_PROTOCOL_VERSION, runnerVersion: 'test', capabilities: ['herdr'], host }));
			ws.onmessage = (e) => {
				const msg = JSON.parse(String(e.data));
				if (msg.type === 'welcome') return resolve();
				if (msg.type !== 'herdr.call') return;
				calls.push(msg);
				ws.send(JSON.stringify({ type: 'herdr.result', id: msg.id, ...answer(msg) }));
			};
		});
		return { machineId, calls, close: () => ws.close() };
	}

	const auditFor = (machineId: string) => db.select().from(consoleAudit).where(eq(consoleAudit.machineId, machineId));

	test('starting a session goes to the runner and is audited', async () => {
		const r = await answeringRunner(() => ({ ok: true, result: { via: 'systemd' } }));
		const res = await api(`/machines/${r.machineId}/sessions`, { method: 'POST', body: JSON.stringify({ name: 'acme-1' }) });
		expect(res.status).toBe(200);
		expect(r.calls[0]).toMatchObject({ session: 'acme-1', method: 'hunthub.session.start' });
		const audit = await auditFor(r.machineId);
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({ session: 'acme-1', method: 'hunthub.session.start', outcome: 'ok' });
		r.close();
	});

	test('layout calls are forwarded; secrets are redacted in the audit log', async () => {
		const r = await answeringRunner(() => ({ ok: true, result: { type: 'workspace_created' } }));
		const res = await api(`/machines/${r.machineId}/sessions/acme-1/call`, {
			method: 'POST',
			body: JSON.stringify({ method: 'workspace.create', params: { cwd: '/srv', label: 'x', env: { API_TOKEN: 's3cret' } } })
		});
		expect(res.status).toBe(200);
		const [row] = await auditFor(r.machineId);
		expect(row!.params).toEqual({ cwd: '/srv', label: 'x', env: '[redacted]' });
		expect(JSON.stringify(row!.params)).not.toContain('s3cret');
		r.close();
	});

	test('runner errors come back with their code and are audited as errors', async () => {
		const r = await answeringRunner(() => ({ ok: false, error: { code: 'running', message: 'Session acme-1 is running; stop it first.' } }));
		const res = await api(`/machines/${r.machineId}/sessions/acme-1`, { method: 'DELETE' });
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'running' });
		expect((await auditFor(r.machineId))[0]).toMatchObject({ outcome: 'error' });
		r.close();
	});

	test('actions outside the console list and bad names are refused before reaching the machine', async () => {
		const r = await answeringRunner(() => ({ ok: true }));
		const notAllowed = await api(`/machines/${r.machineId}/sessions/acme-1/call`, {
			method: 'POST',
			body: JSON.stringify({ method: 'server.stop', params: {} })
		});
		expect(notAllowed.status).toBe(400);
		const badName = await api(`/machines/${r.machineId}/sessions`, { method: 'POST', body: JSON.stringify({ name: '../etc' }) });
		expect(badName.status).toBe(400);
		expect(r.calls).toHaveLength(0);
		r.close();
	});

	test('reads are not audited', async () => {
		const r = await answeringRunner(() => ({ ok: true, result: { agents: [] } }));
		const res = await api(`/machines/${r.machineId}/sessions/acme-1/call`, { method: 'POST', body: JSON.stringify({ method: 'agent.list' }) });
		expect(res.status).toBe(200);
		expect(await auditFor(r.machineId)).toHaveLength(0);
		r.close();
	});
});

describe('live terminals', () => {
	/** A fake runner that answers term.open with a frame and echoes input back as frames. */
	async function terminalRunner(capabilities = ['herdr', 'terminal:cli']) {
		const { credential, machineId } = await enrolledMachine();
		const ws = new WebSocket(`${base.replace('http', 'ws')}/api/runner/ws`, { headers: { authorization: `Bearer ${credential}` } });
		const received: any[] = [];
		const frame = (channel: string, text: string) =>
			ws.send(JSON.stringify({ type: 'term.frame', channel, frame: { seq: 1, full: true, width: 80, height: 24, bytes: btoa(text) } }));
		await new Promise<void>((resolve) => {
			ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', protocol: RUNNER_PROTOCOL_VERSION, runnerVersion: 'test', capabilities, host }));
			ws.onmessage = (e) => {
				const msg = JSON.parse(String(e.data));
				if (msg.type === 'welcome') return resolve();
				received.push(msg);
				if (msg.type === 'term.open') frame(msg.channel, 'hello');
				if (msg.type === 'term.input') frame(msg.channel, atob(msg.bytes));
			};
		});
		return { machineId, received, close: () => ws.close() };
	}

	function openBrowser(machineId: string, query: Record<string, string>, origin = base) {
		const q = new URLSearchParams({ session: 'acme-1', target: 'w1:p1', ...query });
		const ws = new WebSocket(`${base.replace('http', 'ws')}/api/machines/${machineId}/terminal?${q}`, {
			headers: { cookie: adminCookie, origin }
		} as any);
		const messages: any[] = [];
		const closed = new Promise<void>((resolve) => (ws.onclose = () => resolve()));
		ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
		return { ws, messages, closed, opened: new Promise<void>((resolve) => (ws.onopen = () => resolve())) };
	}

	test('frames and input are relayed; closing the browser closes the channel; control is audited', async () => {
		const r = await terminalRunner();
		const b = openBrowser(r.machineId, { mode: 'control', cols: '100', rows: '30' });
		await b.opened;
		await waitFor(() => b.messages.length === 1);
		expect(b.messages[0]).toMatchObject({ type: 'frame', bytes: btoa('hello') });
		const open = r.received.find((m) => m.type === 'term.open');
		expect(open).toMatchObject({ session: 'acme-1', target: 'w1:p1', mode: 'control', transport: 'cli', cols: 100, rows: 30, takeover: false });

		b.ws.send(JSON.stringify({ type: 'input', bytes: btoa('ls\r') }));
		await waitFor(() => b.messages.length === 2);
		expect(atob(b.messages[1].bytes)).toBe('ls\r');

		b.ws.close();
		await waitFor(() => r.received.some((m) => m.type === 'term.close' && m.channel === open.channel));
		const audit = await db.select().from(consoleAudit).where(eq(consoleAudit.machineId, r.machineId));
		expect(audit).toHaveLength(1);
		expect(audit[0]).toMatchObject({ method: 'terminal.control', session: 'acme-1', outcome: 'ok' });
		r.close();
	});

	test('watching never forwards keystrokes', async () => {
		const r = await terminalRunner();
		const b = openBrowser(r.machineId, { mode: 'observe' });
		await b.opened;
		await waitFor(() => b.messages.length === 1);
		b.ws.send(JSON.stringify({ type: 'input', bytes: btoa('rm -rf /\r') }));
		b.ws.send(JSON.stringify({ type: 'resize', cols: 90, rows: 20 }));
		await waitFor(() => r.received.some((m) => m.type === 'term.resize'));
		expect(r.received.some((m) => m.type === 'term.input')).toBe(false);
		b.ws.close();
		r.close();
	});

	test('the browser is told when the machine disconnects', async () => {
		const r = await terminalRunner();
		const b = openBrowser(r.machineId, { mode: 'observe' });
		await b.opened;
		await waitFor(() => b.messages.length === 1);
		r.close();
		await b.closed;
		expect(b.messages.at(-1)).toMatchObject({ type: 'closed' });
	});

	test('other sites, unsupported runners and bad targets are refused before upgrading', async () => {
		const r = await terminalRunner(['herdr']);
		const url = (q: string) => `/machines/${r.machineId}/terminal?session=acme-1&${q}`;
		expect((await api(url('target=w1:p1'), { headers: { origin: 'https://evil.example' } })).status).toBe(403);
		expect((await api(url('target=w1:p1'))).status).toBe(409);
		expect((await api(url('target=$(id)'))).status).toBe(400);
		expect(r.received.some((m) => m.type === 'term.open')).toBe(false);
		r.close();
	});
});

describe('settings', () => {
	test('an offline threshold below 3 heartbeats is rejected', async () => {
		const res = await api('/settings/machines/connection', {
			method: 'PUT',
			body: JSON.stringify({ heartbeatIntervalMs: 2000, offlineAfterMs: 3000, statsIntervalMs: 5000 })
		});
		expect(res.status).toBe(400);
	});
});
