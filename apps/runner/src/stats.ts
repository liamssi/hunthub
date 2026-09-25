// Basic resource monitor: CPU %, memory, disk usage per real filesystem, and
// network throughput. Reads Linux /proc directly; parsing is kept in pure
// functions so it can be tested against fixture files.
import { readFileSync, statfsSync } from 'node:fs';
import type { DiskStat, StatsSample } from '@hunthub/shared/runner-protocol';

export type CpuTimes = { idle: number; total: number };

/** Aggregate CPU times from the first line of /proc/stat. */
export function parseCpuTimes(procStat: string): CpuTimes {
	const line = procStat.split('\n').find((l) => l.startsWith('cpu '));
	if (!line) throw new Error('no cpu line in /proc/stat');
	const values = line.trim().split(/\s+/).slice(1).map(Number);
	// user nice system idle iowait irq softirq steal (guest time is already in user/nice)
	const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = values;
	return { idle: idle + iowait, total: user + nice + system + idle + iowait + irq + softirq + steal };
}

export function cpuPercent(prev: CpuTimes, next: CpuTimes): number {
	const total = next.total - prev.total;
	if (total <= 0) return 0;
	const busy = total - (next.idle - prev.idle);
	return Math.min(100, Math.max(0, (busy / total) * 100));
}

/** Used = total - available, as tools like `free` report it. */
export function parseMemory(meminfo: string): { used: number; total: number } {
	const kb = (key: string) => {
		const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(meminfo);
		return m ? Number(m[1]) * 1024 : 0;
	};
	const total = kb('MemTotal');
	const available = kb('MemAvailable');
	return { used: Math.max(0, total - available), total };
}

const REAL_FILESYSTEMS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'f2fs', 'jfs', 'reiserfs', 'vfat', 'exfat', 'ntfs', 'ntfs3', 'fuseblk']);

/** Mount points of real (disk-backed) filesystems, one per device. */
export function parseMounts(procMounts: string): string[] {
	const seenDevices = new Set<string>();
	const mounts: string[] = [];
	for (const line of procMounts.split('\n')) {
		const [device, mount, type] = line.split(' ');
		if (!device || !mount || !type || !REAL_FILESYSTEMS.has(type)) continue;
		if (seenDevices.has(device)) continue; // bind mounts and btrfs subvolumes share a device
		// /proc/mounts escapes spaces and other characters as octal (\040).
		mounts.push(mount.replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))));
		seenDevices.add(device);
	}
	return mounts.slice(0, 64);
}

export type NetCounters = { rx: number; tx: number };

// Virtual interfaces would count the same traffic twice (e.g. veth + bridge).
const SKIP_INTERFACES = /^(lo|docker|br-|veth|virbr|cni|flannel|tun|tap)/;

/** Total received/transmitted bytes over physical-ish interfaces. */
export function parseNetDev(netDev: string): NetCounters {
	let rx = 0;
	let tx = 0;
	for (const line of netDev.split('\n').slice(2)) {
		const [name, data] = line.split(':');
		if (!name || !data || SKIP_INTERFACES.test(name.trim())) continue;
		const fields = data.trim().split(/\s+/).map(Number);
		rx += fields[0] ?? 0;
		tx += fields[8] ?? 0;
	}
	return { rx, tx };
}

function diskUsage(mount: string): DiskStat | null {
	try {
		const s = statfsSync(mount);
		const total = s.blocks * s.bsize;
		if (total === 0) return null;
		return { mount, used: total - s.bfree * s.bsize, total };
	} catch {
		return null;
	}
}

/** Keeps the previous counters so each sample reports rates over the interval. */
export class StatsCollector {
	private prevCpu: CpuTimes | null = null;
	private prevNet: (NetCounters & { at: number }) | null = null;

	sample(): StatsSample {
		const now = Date.now();
		const cpu = parseCpuTimes(readFileSync('/proc/stat', 'utf8'));
		const net = parseNetDev(readFileSync('/proc/net/dev', 'utf8'));

		const cpuPct = this.prevCpu ? cpuPercent(this.prevCpu, cpu) : 0;
		let rxBps = 0;
		let txBps = 0;
		if (this.prevNet) {
			const seconds = (now - this.prevNet.at) / 1000;
			// Counters reset on interface restarts; never report negative rates.
			if (seconds > 0) {
				rxBps = Math.max(0, (net.rx - this.prevNet.rx) / seconds);
				txBps = Math.max(0, (net.tx - this.prevNet.tx) / seconds);
			}
		}
		this.prevCpu = cpu;
		this.prevNet = { ...net, at: now };

		const disks = parseMounts(readFileSync('/proc/mounts', 'utf8'))
			.map(diskUsage)
			.filter((d): d is DiskStat => d !== null);

		return {
			ts: now,
			cpuPct,
			mem: parseMemory(readFileSync('/proc/meminfo', 'utf8')),
			disks,
			net: { rxBps, txBps }
		};
	}
}
