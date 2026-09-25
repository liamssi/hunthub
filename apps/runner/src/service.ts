// Installs the runner as a systemd user service, so it starts on boot and
// restarts on failure, running as the current (non-root) user.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';

const unitName = 'hunthub-runner.service';
const unitDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user');
const unitPath = join(unitDir, unitName);

function systemctl(...args: string[]) {
	const result = Bun.spawnSync(['systemctl', '--user', ...args], { stdout: 'inherit', stderr: 'inherit' });
	if (!result.success) throw new Error(`systemctl --user ${args.join(' ')} failed`);
}

/** The command systemd should run: the compiled binary, or bun + the script (bundle or source). */
function execStart(): string {
	const exe = process.execPath;
	const isCompiled = !exe.endsWith('/bun') && !exe.endsWith('/bun-debug');
	return isCompiled ? `${exe} run` : `${exe} ${resolve(process.argv[1]!)} run`;
}

export function installService() {
	mkdirSync(unitDir, { recursive: true });
	writeFileSync(
		unitPath,
		`[Unit]
Description=HuntHub runner
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${execStart()}
Restart=always
RestartSec=5
# The runner exits 0 when the hub revoked this machine; don't restart then.
RestartPreventExitStatus=0
NoNewPrivileges=true

[Install]
WantedBy=default.target
`
	);
	systemctl('daemon-reload');
	systemctl('enable', '--now', unitName);
	console.log(`Installed and started ${unitName}.`);
	const user = userInfo().username;
	const linger = Bun.spawnSync(['loginctl', 'show-user', user, '-p', 'Linger'], { stdout: 'pipe', stderr: 'ignore' });
	if (!linger.stdout.toString().includes('Linger=yes')) {
		console.log(`To keep it running when you're logged out, run once:\n  sudo loginctl enable-linger ${user}`);
	}
}

export function uninstallService() {
	if (existsSync(unitPath)) {
		Bun.spawnSync(['systemctl', '--user', 'disable', '--now', unitName], { stdout: 'inherit', stderr: 'inherit' });
		rmSync(unitPath);
		Bun.spawnSync(['systemctl', '--user', 'daemon-reload']);
		console.log(`Removed ${unitName}.`);
	}
}
