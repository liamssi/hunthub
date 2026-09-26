// Runs both terminal transports against a throwaway Herdr session
// ("hunthub-terminal-test") started just for these tests.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RunnerMessage } from '@hunthub/shared/runner-protocol';
import { socketPathFor } from './client';
import { TerminalManager } from './terminals';

const SESSION = 'hunthub-terminal-test';
const herdrAvailable = Bun.spawnSync(['herdr', '--version']).success;
let server: ReturnType<typeof Bun.spawn> | null = null;
let pane = '';

const herdr = (...args: string[]) =>
	Bun.spawnSync(['herdr', '--session', SESSION, ...args], { stdout: 'pipe', stderr: 'pipe' });

async function waitFor<T>(check: () => T | undefined | false, ms = 10_000): Promise<T> {
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
	const created = herdr('workspace', 'create', '--cwd', '/tmp', '--label', 'term');
	expect(created.success).toBe(true);
	pane = JSON.parse(created.stdout.toString()).result.root_pane.pane_id;
});

afterAll(async () => {
	if (!herdrAvailable) return;
	herdr('server', 'stop');
	server?.kill();
	await server?.exited;
	rmSync(dirname(socketPathFor(SESSION)), { recursive: true, force: true });
});

describe.skipIf(!herdrAvailable)('terminals', () => {
	for (const transport of ['cli', 'native'] as const) {
		test(`${transport}: streams the pane and delivers keystrokes in control mode`, async () => {
			const sent: RunnerMessage[] = [];
			const terminals = new TerminalManager((m) => void sent.push(m), (name) => name === SESSION, () => {});
			const channel = `c-${transport}`;
			const screen = () =>
				sent
					.filter((m): m is Extract<RunnerMessage, { type: 'term.frame' }> => m.type === 'term.frame' && m.channel === channel)
					.map((m) => Buffer.from(m.frame.bytes, 'base64').toString())
					.join('');

			terminals.open({ type: 'term.open', channel, session: SESSION, view: 'pane', target: pane, mode: 'control', transport, cols: 80, rows: 20, takeover: true });
			await waitFor(() => screen().length > 0);
			const marker = `${transport}-${Date.now() % 100000}`;
			// Split so the marker only shows once the shell has run the command.
			terminals.input(channel, btoa(`echo ${marker.slice(0, 3)}''${marker.slice(3)}\r`));
			await waitFor(() => screen().includes(marker));

			terminals.close(channel);
			await waitFor(() => sent.some((m) => m.type === 'term.closed' && m.channel === channel));
		});
	}

	test('session view: streams the Herdr UI; closing it leaves the session running', async () => {
		const sent: RunnerMessage[] = [];
		const terminals = new TerminalManager((m) => void sent.push(m), (name) => name === SESSION, () => {}, (name) => name === SESSION);
		const frames = () => sent.filter((m) => m.type === 'term.frame' && m.channel === 's');
		terminals.open({ type: 'term.open', channel: 's', session: SESSION, view: 'session', target: '', mode: 'control', transport: 'cli', cols: 100, rows: 30, takeover: false });
		await waitFor(() => frames().length > 0);
		// Herdr draws its workspace list; the workspace made in beforeAll is in it.
		await waitFor(() => frames().map((m) => Buffer.from((m as any).frame.bytes, 'base64').toString()).join('').includes('term'));
		terminals.close('s');
		await Bun.sleep(500);
		expect(herdr('status', 'server').success).toBe(true);
	});

	test('session view refuses stopped sessions', () => {
		const sent: RunnerMessage[] = [];
		const terminals = new TerminalManager((m) => void sent.push(m), () => true, () => {}, () => false);
		terminals.open({ type: 'term.open', channel: 'y', session: SESSION, view: 'session', target: '', mode: 'observe', transport: 'cli', cols: 80, rows: 20, takeover: false });
		expect(sent[0]).toMatchObject({ type: 'term.closed', channel: 'y' });
	});

	test('refuses unknown sessions and bad targets', () => {
		const sent: RunnerMessage[] = [];
		const terminals = new TerminalManager((m) => void sent.push(m), () => false, () => {});
		terminals.open({ type: 'term.open', channel: 'x', session: 'nope', view: 'pane', target: 'w1:p1', mode: 'observe', transport: 'cli', cols: 80, rows: 20, takeover: false });
		expect(sent[0]).toMatchObject({ type: 'term.closed', channel: 'x' });
	});
});
