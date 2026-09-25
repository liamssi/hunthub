// Runner configuration and credential on disk. The credential file is only
// readable by the runner's user.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type RunnerConfig = {
	hubUrl: string;
	machineId: string;
};

export const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'hunthub-runner');
const configPath = join(configDir, 'config.json');
const credentialPath = join(configDir, 'credential');
const revokedPath = join(configDir, 'revoked');

function ensureDir() {
	mkdirSync(configDir, { recursive: true, mode: 0o700 });
	chmodSync(configDir, 0o700);
}

export function loadConfig(): RunnerConfig | null {
	if (!existsSync(configPath)) return null;
	return JSON.parse(readFileSync(configPath, 'utf8')) as RunnerConfig;
}

export function loadCredential(): string | null {
	return existsSync(credentialPath) ? readFileSync(credentialPath, 'utf8').trim() : null;
}

export function saveConfig(config: RunnerConfig) {
	ensureDir();
	writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

export function saveCredential(credential: string) {
	ensureDir();
	// Write then chmod: the mode option only applies when the file is created.
	writeFileSync(credentialPath, credential + '\n', { mode: 0o600 });
	chmodSync(credentialPath, 0o600);
}

/** Remembers that the hub revoked this machine, so the service stops retrying. */
export function markRevoked(reason: string) {
	ensureDir();
	writeFileSync(revokedPath, reason + '\n', { mode: 0o600 });
}

export function revokedReason(): string | null {
	return existsSync(revokedPath) ? readFileSync(revokedPath, 'utf8').trim() : null;
}

export function clearState() {
	rmSync(configDir, { recursive: true, force: true });
}
