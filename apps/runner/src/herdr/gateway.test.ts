// Runs against a throwaway Herdr session ("hunthub-gateway-test") started just
// for these tests. It never touches the user's own sessions.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RunnerMessage } from '@hunthub/shared/runner-protocol';
import { request, socketPathFor } from './client';
import { HerdrGateway, meaningfulJson } from './gateway';

const SESSION = 'hunthub-gateway-test';
const herdrAvailable = Bun.spawnSync(['herdr', '--version']).success;
let server: ReturnType<typeof Bun.spawn> | null = null;

const herdr = (...args: string[]) =>
	Bun.spawnSync(['herdr', '--session', SESSION, ...args], { stdout: 'pipe', stderr: 'pipe' });

async function waitFor<T>(check: () => T | undefined | false, ms = 8000): Promise<T> {
	const until = Date.now() + ms;
	for (;;) {
		const value = check();
		if (value) return value;
		if (Date.now() > until) throw new Error('timed out waiting');
		await Bun.sleep(50);
	}
}

beforeAll(async () => {
	if (!herdrAvailable) return;
	server = Bun.spawn(['herdr', 'server'], { env: { ...process.env, HERDR_SESSION: SESSION }, stdout: 'ignore', stderr: 'ignore' });
	await waitFor(() => existsSync(socketPathFor(SESSION)));
	await waitFor(() => herdr('status', 'server').success);
});

afterAll(async () => {
	if (!herdrAvailable) return;
	herdr('server', 'stop');
	server?.kill();
	await server?.exited;
	rmSync(dirname(socketPathFor(SESSION)), { recursive: true, force: true });
});

describe.skipIf(!herdrAvailable)('herdr gateway', () => {
	test('client talks to the socket', async () => {
		const pong = await request<{ type: string; protocol: number }>(socketPathFor(SESSION), 'ping');
		expect(pong.type).toBe('pong');
	});

	test('reports the session, then structure and agent state changes', async () => {
		const sent: RunnerMessage[] = [];
		const gateway = new HerdrGateway((m) => sent.push(m), () => {});
		gateway.start();
		try {
			const sessionReports = () =>
				sent.filter((m): m is Extract<RunnerMessage, { type: 'herdr.session' }> => m.type === 'herdr.session' && m.session.name === SESSION);

			await waitFor(() => sessionReports().some((m) => m.session.state === 'running'));

			// A new workspace shows up (lifecycle event).
			expect(herdr('workspace', 'create', '--cwd', '/tmp', '--label', 'gw-ws').success).toBe(true);
			const withWorkspace = await waitFor(() =>
				sessionReports().find((m) => JSON.stringify(m.session.snapshot).includes('gw-ws'))
			);
			const paneId = (withWorkspace.session.snapshot as { panes: { pane_id: string }[] }).panes[0]!.pane_id;

			// An agent state change shows up (no event for it; found by the poll).
			herdr('pane', 'report-agent', '--source', 'custom:hunthub-test', '--agent', 'test-bot', '--state', 'blocked', paneId);
			await waitFor(() =>
				sessionReports().some((m) => JSON.stringify(m.session.snapshot).includes('"agent_status":"blocked"'))
			);
		} finally {
			gateway.stop();
		}
	});

	test('only allowlisted methods are forwarded', async () => {
		const sent: RunnerMessage[] = [];
		const gateway = new HerdrGateway((m) => sent.push(m), () => {});
		gateway.start();
		try {
			await waitFor(() => sent.some((m) => m.type === 'herdr.session'));
			await gateway.call('1', SESSION, 'server.stop', {});
			await gateway.call('2', SESSION, 'agent.list', {});
			await gateway.call('3', '../../etc', 'agent.list', {});
			const results = sent.filter((m): m is Extract<RunnerMessage, { type: 'herdr.result' }> => m.type === 'herdr.result');
			expect(results.find((r) => r.id === '1')).toMatchObject({ ok: false, error: { code: 'not_allowed' } });
			expect(results.find((r) => r.id === '2')).toMatchObject({ ok: true });
			expect(results.find((r) => r.id === '3')).toMatchObject({ ok: false, error: { code: 'unknown_session' } });
		} finally {
			gateway.stop();
		}
	});
});

test('meaningful comparison ignores output-driven fields', () => {
	const a = { panes: [{ pane_id: 'w1:p1', revision: 1, agent_status: 'idle', scroll: { offset: 0 } }] };
	const b = { panes: [{ pane_id: 'w1:p1', revision: 9, agent_status: 'idle', scroll: { offset: 5 } }] };
	const c = { panes: [{ pane_id: 'w1:p1', revision: 9, agent_status: 'working', scroll: { offset: 5 } }] };
	expect(meaningfulJson(a)).toBe(meaningfulJson(b));
	expect(meaningfulJson(a)).not.toBe(meaningfulJson(c));
});
