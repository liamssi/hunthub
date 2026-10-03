// Starting, stopping and deleting Herdr sessions. The socket API can't start a
// server, so sessions started from the hub run `herdr server` under a systemd
// user template unit (hunthub-herdr@<name>.service): it survives runner
// restarts, restarts on crashes, and keeps logs. Without systemd, the server is
// started detached, as Herdr itself does. Stop and delete follow Herdr's own
// rules and work for any session, however it was started.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { validateSessionName } from '@hunthub/shared/console';
import { DEFAULT_SESSION, HerdrError, request, socketPathFor } from './client';
import { herdrBinary } from './binary';

const UNIT_TEMPLATE = 'hunthub-herdr@.service';
const unitName = (session: string) => `hunthub-herdr@${session}.service`;
const unitDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user');

function run(cmd: string[], timeoutMs = 15_000) {
	const result = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs });
	return { ok: result.success, out: result.stdout.toString().trim(), err: result.stderr.toString().trim() };
}

export async function isRunning(session: string): Promise<boolean> {
	try {
		await request(socketPathFor(session), 'ping', {}, 2000);
		return true;
	} catch {
		return false;
	}
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		if (await check()) return true;
		await Bun.sleep(200);
	}
	return check();
}

function systemdUserAvailable(): boolean {
	return run(['systemctl', '--user', 'show-environment'], 5000).ok;
}

/** Writes the template unit once (or when it changed). */
function ensureUnit(herdrPath: string) {
	mkdirSync(unitDir(), { recursive: true });
	// "default" is Herdr's unnamed session: run it without HERDR_SESSION.
	const content = `[Unit]
Description=Herdr session %i (started by HuntHub)
After=network-online.target

[Service]
ExecStart=/bin/sh -c 'if [ "%i" = "${DEFAULT_SESSION}" ]; then unset HERDR_SESSION; else export HERDR_SESSION="%i"; fi; exec "${herdrPath}" server'
# A clean stop (server.stop) exits normally and is not restarted; crashes are.
Restart=on-failure
RestartSec=3
TasksMax=infinity

[Install]
WantedBy=default.target
`;
	const path = join(unitDir(), UNIT_TEMPLATE);
	const current = existsSync(path) ? Bun.file(path).size : -1;
	if (current !== content.length) {
		writeFileSync(path, content);
		run(['systemctl', '--user', 'daemon-reload']);
	}
}

export async function startSession(session: string): Promise<{ via: 'systemd' | 'detached' }> {
	const invalid = validateSessionName(session);
	if (invalid) throw new HerdrError('invalid_name', invalid);
	if (await isRunning(session)) throw new HerdrError('already_running', `Session ${session} is already running.`);
	const herdrPath = herdrBinary();
	if (!herdrPath) throw new HerdrError('herdr_missing', 'Herdr is not installed on this machine.');

	let via: 'systemd' | 'detached';
	if (systemdUserAvailable()) {
		ensureUnit(herdrPath);
		const started = run(['systemctl', '--user', 'restart', unitName(session)]);
		if (!started.ok) throw new HerdrError('start_failed', started.err || 'systemctl failed to start the session.');
		via = 'systemd';
	} else {
		const env = { ...process.env };
		if (session === DEFAULT_SESSION) delete env.HERDR_SESSION;
		else env.HERDR_SESSION = session;
		// setsid detaches it from the runner, so it outlives the runner.
		const proc = Bun.spawn(['setsid', herdrPath, 'server'], { env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
		proc.unref();
		via = 'detached';
	}
	if (!(await waitUntil(() => isRunning(session), 15_000))) {
		throw new HerdrError('start_timeout', `Session ${session} did not start within 15s.`);
	}
	return { via };
}

export async function stopSession(session: string): Promise<void> {
	const invalid = validateSessionName(session);
	if (invalid) throw new HerdrError('invalid_name', invalid);
	if (!(await isRunning(session))) throw new HerdrError('not_running', `Session ${session} is not running.`);
	// server.stop is Herdr's own clean shutdown; the reply may not arrive before it exits.
	await request(socketPathFor(session), 'server.stop', {}, 5000).catch(() => {});
	const stopped = await waitUntil(async () => !(await isRunning(session)), 10_000);
	// If HuntHub's unit ran it, make sure systemd doesn't bring it back.
	run(['systemctl', '--user', 'stop', unitName(session)], 10_000);
	if (!stopped) throw new HerdrError('stop_timeout', `Session ${session} did not stop within 10s.`);
}

export async function deleteSession(session: string): Promise<void> {
	const invalid = validateSessionName(session);
	if (invalid) throw new HerdrError('invalid_name', invalid);
	if (session === DEFAULT_SESSION) throw new HerdrError('not_allowed', 'The default session cannot be deleted.');
	if (await isRunning(session)) throw new HerdrError('running', `Session ${session} is running; stop it first.`);
	// Herdr's own command enforces the same rules and knows its storage layout.
	const result = run([herdrBinary() ?? 'herdr', 'session', 'delete', session]);
	if (!result.ok) throw new HerdrError('delete_failed', result.err || result.out || 'herdr session delete failed.');
}
