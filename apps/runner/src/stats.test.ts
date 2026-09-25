import { describe, expect, test } from 'bun:test';
import { backoffMs, wsUrl } from './connection';
import { cpuPercent, parseCpuTimes, parseMemory, parseMounts, parseNetDev } from './stats';

describe('cpu', () => {
	test('parses aggregate times and computes busy percent', () => {
		const a = parseCpuTimes('cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2 3 4\n');
		const b = parseCpuTimes('cpu  200 0 200 1300 100 0 0 0 0 0\ncpu0 1 2 3 4\n');
		expect(a).toEqual({ idle: 800, total: 1000 });
		// 800 more ticks, 200 of them busy.
		expect(cpuPercent(a, b)).toBeCloseTo(25);
	});

	test('no elapsed ticks means 0%', () => {
		const a = parseCpuTimes('cpu  1 1 1 1 1 1 1 1\n');
		expect(cpuPercent(a, a)).toBe(0);
	});
});

test('memory used is total minus available', () => {
	const meminfo = 'MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    6000000 kB\n';
	expect(parseMemory(meminfo)).toEqual({ used: 10_000_000 * 1024, total: 16_000_000 * 1024 });
});

test('mounts keep real filesystems once per device and unescape names', () => {
	const mounts = [
		'/dev/nvme0n1p2 / ext4 rw,relatime 0 0',
		'proc /proc proc rw 0 0',
		'tmpfs /run tmpfs rw 0 0',
		'/dev/nvme0n1p1 /boot/efi vfat rw 0 0',
		'/dev/nvme0n1p2 /var/lib/docker ext4 rw 0 0',
		'/dev/sdb1 /mnt/my\\040disk xfs rw 0 0',
		'overlay /var/lib/docker/overlay2/x/merged overlay rw 0 0'
	].join('\n');
	expect(parseMounts(mounts)).toEqual(['/', '/boot/efi', '/mnt/my disk']);
});

test('network sums physical interfaces and skips virtual ones', () => {
	const netDev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 5000 10 0 0 0 0 0 0 5000 10 0 0 0 0 0 0
  eth0: 1000 10 0 0 0 0 0 0 300 10 0 0 0 0 0 0
 wlan0: 2000 10 0 0 0 0 0 0 400 10 0 0 0 0 0 0
docker0: 9000 10 0 0 0 0 0 0 9000 10 0 0 0 0 0 0
vethabc: 9000 10 0 0 0 0 0 0 9000 10 0 0 0 0 0 0
`;
	expect(parseNetDev(netDev)).toEqual({ rx: 3000, tx: 700 });
});

describe('connection helpers', () => {
	test('websocket url follows the hub scheme', () => {
		expect(wsUrl('http://localhost:5173')).toBe('ws://localhost:5173/api/runner/ws');
		expect(wsUrl('https://hub.example.com')).toBe('wss://hub.example.com/api/runner/ws');
	});

	test('backoff grows and is capped at 60s', () => {
		for (let i = 0; i < 20; i++) {
			const d = backoffMs(i);
			expect(d).toBeGreaterThanOrEqual(Math.min(60_000, 1000 * 2 ** i) / 2);
			expect(d).toBeLessThanOrEqual(60_000);
		}
	});
});
