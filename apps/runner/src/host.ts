// Static information about the machine, sent on connect.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import type { HostInfo } from '@hunthub/shared/runner-protocol';
import { herdrBinary } from './herdr/binary';

function osName(): string {
	try {
		const release = readFileSync('/etc/os-release', 'utf8');
		const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(release);
		if (pretty) return pretty[1]!;
	} catch {
		// Not all systems have os-release.
	}
	return `${os.type()} ${os.release()}`;
}

function privateIps(): string[] {
	const ips: string[] = [];
	for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
		if (/^(lo|docker|br-|veth|virbr|cni|flannel)/.test(name)) continue;
		for (const a of addrs ?? []) if (!a.internal) ips.push(a.address);
	}
	return ips.slice(0, 32);
}

function herdrVersion(): string | null {
	try {
		const herdr = herdrBinary();
		if (!herdr) return null;
		const result = Bun.spawnSync([herdr, '--version'], { stdout: 'pipe', stderr: 'ignore' });
		if (!result.success) return null;
		return result.stdout.toString().trim().replace(/^herdr\s+/, '') || null;
	} catch {
		return null;
	}
}

export function collectHostInfo(): HostInfo {
	const cpus = os.cpus();
	return {
		hostname: os.hostname(),
		os: osName(),
		kernel: os.release(),
		arch: os.arch(),
		cpuModel: cpus[0]?.model.trim() ?? 'unknown',
		cpuCores: cpus.length,
		memTotal: os.totalmem(),
		privateIps: privateIps(),
		herdrVersion: herdrVersion()
	};
}
