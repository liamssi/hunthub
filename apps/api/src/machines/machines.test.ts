// Integration tests for machine enrollment, the runner WebSocket and admin
// endpoints. They run against the dev database and clean up after themselves.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { websocket } from 'hono/bun';
import { RUNNER_CLOSE, RUNNER_PROTOCOL_VERSION } from '@hunthub/shared/runner-protocol';
import { app } from '../app';
import { auth } from '../auth';
import { db } from '../db';
import { machine, machineJoinToken, user } from '../db/schema';
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
	if (createdMachines.length) await db.delete(machine).where(inArray(machine.id, createdMachines));
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

function enroll(token: string) {
	return fetch(`${base}/api/runner/enroll`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
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

describe('settings', () => {
	test('an offline threshold below 3 heartbeats is rejected', async () => {
		const res = await api('/settings/machines/connection', {
			method: 'PUT',
			body: JSON.stringify({ heartbeatIntervalMs: 2000, offlineAfterMs: 3000, statsIntervalMs: 5000 })
		});
		expect(res.status).toBe(400);
	});
});
