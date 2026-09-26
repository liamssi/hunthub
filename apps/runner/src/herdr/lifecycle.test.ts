// Session lifecycle and "the machine is the source of truth", against throwaway
// sessions only (names prefixed hunthub-lc-). Never touches the user's sessions.
import { afterAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RunnerMessage } from '@hunthub/shared/runner-protocol';
import { socketPathFor } from './client';
import { HerdrGateway, SESSION_DELETE, SESSION_START, SESSION_STOP } from './gateway';
import { validateSessionName } from '@hunthub/shared/console';
import { isRunning } from './sessions';

const herdrAvailable = Bun.spawnSync(['herdr', '--version']).success;
const MANAGED = 'hunthub-lc-managed';
const EXTERNAL = 'hunthub-lc-external';

async function waitFor<T>(check: () => T | undefined | false, ms = 15_000): Promise<T> {
	const until = Date.now() + ms;
	for (;;) {
		const value = check();
		if (value) return value;
		if (Date.now() > until) throw new Error('timed out waiting');
		await Bun.sleep(50);
	}
}

type Report = Extract<RunnerMessage, { type: 'herdr.session' }>;
type Result = Extract<RunnerMessage, { type: 'herdr.result' }>;

function harness() {
	const sent: RunnerMessage[] = [];
	const gateway = new HerdrGateway((m) => sent.push(m), () => {});
	let n = 0;
	const call = async (session: string, method: string, params: Record<string, unknown> = {}) => {
		const id = `c${++n}`;
		await gateway.call(id, session, method, params);
		return sent.find((m): m is Result => m.type === 'herdr.result' && m.id === id)!;
	};
	const reports = (name: string) => sent.filter((m): m is Report => m.type === 'herdr.session' && m.session.name === name);
	const removed = (name: string) => sent.some((m) => m.type === 'herdr.session.removed' && m.name === name);
	return { gateway, sent, call, reports, removed };
}

afterAll(async () => {
	if (!herdrAvailable) return;
	for (const name of [MANAGED, EXTERNAL]) {
		if (await isRunning(name)) Bun.spawnSync(['herdr', 'session', 'stop', name]);
		Bun.spawnSync(['systemctl', '--user', 'stop', `hunthub-herdr@${name}.service`]);
		rmSync(dirname(socketPathFor(name)), { recursive: true, force: true });
	}
});

test('session names follow Herdr rules', () => {
	expect(validateSessionName('acme-2026.09_x')).toBeNull();
	expect(validateSessionName('../etc')).not.toBeNull();
	expect(validateSessionName('a b')).not.toBeNull();
	expect(validateSessionName('x'.repeat(65))).not.toBeNull();
	expect(validateSessionName('')).not.toBeNull();
});

describe.skipIf(!herdrAvailable)('session lifecycle', () => {
	test('start, change the layout, stop and delete a session from the hub', async () => {
		const h = harness();
		h.gateway.start();
		try {
			const started = await h.call(MANAGED, SESSION_START);
			expect(started.ok).toBe(true);
			await waitFor(() => h.reports(MANAGED).some((r) => r.session.state === 'running'));

			const created = await h.call(MANAGED, 'workspace.create', { cwd: '/tmp', label: 'lc-ws', focus: true });
			expect(created.ok).toBe(true);
			await waitFor(() => h.reports(MANAGED).some((r) => JSON.stringify(r.session.snapshot).includes('lc-ws')));

			// Deleting a running session is refused (Herdr's rule).
			expect(await h.call(MANAGED, SESSION_DELETE)).toMatchObject({ ok: false, error: { code: 'running' } });

			expect((await h.call(MANAGED, SESSION_STOP)).ok).toBe(true);
			await waitFor(() => h.reports(MANAGED).at(-1)?.session.state === 'stopped');
			// A clean stop is not restarted by systemd.
			await Bun.sleep(4000);
			expect(await isRunning(MANAGED)).toBe(false);

			expect((await h.call(MANAGED, SESSION_DELETE)).ok).toBe(true);
			await waitFor(() => h.removed(MANAGED));
		} finally {
			h.gateway.stop();
		}
	}, 60_000);

	test('a session started and stopped directly on the machine is picked up', async () => {
		const h = harness();
		h.gateway.start();
		let server: ReturnType<typeof Bun.spawn> | null = null;
		try {
			// Like a user running Herdr themselves, outside HuntHub.
			server = Bun.spawn(['herdr', 'server'], { env: { ...process.env, HERDR_SESSION: EXTERNAL }, stdout: 'ignore', stderr: 'ignore' });
			await waitFor(() => h.reports(EXTERNAL).some((r) => r.session.state === 'running'));

			Bun.spawnSync(['herdr', '--session', EXTERNAL, 'workspace', 'create', '--cwd', '/tmp', '--label', 'made-outside']);
			await waitFor(() => h.reports(EXTERNAL).some((r) => JSON.stringify(r.session.snapshot).includes('made-outside')));

			Bun.spawnSync(['herdr', 'session', 'stop', EXTERNAL]);
			await waitFor(() => h.reports(EXTERNAL).at(-1)?.session.state === 'stopped');

			Bun.spawnSync(['herdr', 'session', 'delete', EXTERNAL]);
			await waitFor(() => h.removed(EXTERNAL));
		} finally {
			server?.kill();
			h.gateway.stop();
		}
	}, 60_000);

	test('invalid names and unknown sessions are refused', async () => {
		const h = harness();
		h.gateway.start();
		try {
			expect(await h.call('../x', SESSION_START)).toMatchObject({ ok: false, error: { code: 'invalid_name' } });
			expect(await h.call('hunthub-lc-missing', 'workspace.create', {})).toMatchObject({ ok: false, error: { code: 'unknown_session' } });
			expect(await h.call('default', SESSION_DELETE)).toMatchObject({ ok: false });
		} finally {
			h.gateway.stop();
		}
	});
});
