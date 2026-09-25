#!/usr/bin/env bun
// HuntHub runner: connects this machine to a HuntHub hub.
import { hostname } from 'node:os';
import { enrollResponseSchema } from '@hunthub/shared/runner-protocol';
import { clearState, configDir, loadConfig, loadCredential, revokedReason, saveConfig, saveCredential } from './config';
import { runConnection } from './connection';
import { collectHostInfo } from './host';
import { installService, uninstallService } from './service';
import { runnerVersion } from './version';

const usage = `hunthub-runner ${runnerVersion}

Usage:
  hunthub-runner join <hub-url> <join-token>   Register this machine with a hub
  hunthub-runner run                           Connect and stay connected (used by the service)
  hunthub-runner install-service               Install and start the systemd user service
  hunthub-runner status                        Show this runner's registration
  hunthub-runner uninstall                     Stop the service and forget this machine
  hunthub-runner --version`;

function log(msg: string) {
	console.log(`${new Date().toISOString()} ${msg}`);
}

async function join(hubUrl: string | undefined, token: string | undefined) {
	if (!hubUrl || !token) {
		console.error(usage);
		process.exit(2);
	}
	const url = new URL(hubUrl).origin;
	const res = await fetch(`${url}/api/runner/enroll`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ token, runnerVersion, host: collectHostInfo() })
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		console.error(`Enrollment failed (${res.status}): ${(body as { message?: string }).message ?? JSON.stringify(body)}`);
		process.exit(1);
	}
	const { machineId, credential } = enrollResponseSchema.parse(body);
	clearState(); // a fresh registration replaces any previous one
	saveConfig({ hubUrl: url, machineId });
	saveCredential(credential);
	console.log(`Joined ${url} as machine ${machineId} (${hostname()}). Credentials saved in ${configDir}.`);
}

async function run() {
	const config = loadConfig();
	const credential = loadCredential();
	if (!config || !credential) {
		console.error('This machine is not registered. Run: hunthub-runner join <hub-url> <join-token>');
		process.exit(1);
	}
	const revoked = revokedReason();
	if (revoked) {
		console.error(`${revoked} Run join again with a new token to re-register.`);
		process.exit(0);
	}
	log(`hunthub-runner ${runnerVersion} starting`);
	await runConnection({ hubUrl: config.hubUrl, credential, log });
	process.exit(0); // only reached when the hub revoked the machine
}

function status() {
	const config = loadConfig();
	if (!config) return console.log('Not registered.');
	console.log(`Hub:      ${config.hubUrl}\nMachine:  ${config.machineId}\nConfig:   ${configDir}`);
	const revoked = revokedReason();
	if (revoked) console.log(`State:    revoked (${revoked})`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
	case 'join':
		await join(args[0], args[1]);
		break;
	case 'run':
		await run();
		break;
	case 'install-service':
		installService();
		break;
	case 'status':
		status();
		break;
	case 'uninstall':
		uninstallService();
		clearState();
		console.log('Runner registration removed.');
		break;
	case '--version':
	case '-v':
		console.log(runnerVersion);
		break;
	default:
		console.log(usage);
		process.exit(command ? 2 : 0);
}
