// Machine stats history: live samples are averaged into 1-minute buckets,
// minutes are rolled up into hours, and each tier is pruned by its retention.
import { sql } from 'drizzle-orm';
import type { MachineRetentionSettings, StatsPoint, StatsRange, StatsSeries } from '@hunthub/shared/machines';
import type { DiskStat, StatsSample } from '@hunthub/shared/runner-protocol';
import { db } from '../db';
import { appSetting, machineStatsMinute } from '../db/schema';

const MINUTE_MS = 60_000;

type Bucket = {
	bucket: number;
	samples: number;
	cpuSum: number;
	cpuMax: number;
	memSum: number;
	memMax: number;
	memTotal: number;
	rxSum: number;
	txSum: number;
	disks: DiskStat[];
	/** Most agents seen in the bucket; null when the runner doesn't report Herdr. */
	agents: number | null;
};

const buckets = new Map<string, Bucket>();

function emptyBucket(bucket: number): Bucket {
	return { bucket, samples: 0, cpuSum: 0, cpuMax: 0, memSum: 0, memMax: 0, memTotal: 0, rxSum: 0, txSum: 0, disks: [], agents: null };
}

/** Adds a live sample; a sample from a newer minute flushes the previous bucket. */
export function recordSample(machineId: string, sample: StatsSample, agents: number | null = null) {
	const minute = Math.floor(sample.ts / MINUTE_MS) * MINUTE_MS;
	let b = buckets.get(machineId);
	if (b && b.bucket !== minute) {
		void writeBucket(machineId, b);
		b = undefined;
	}
	b ??= emptyBucket(minute);
	b.samples++;
	b.cpuSum += sample.cpuPct;
	b.cpuMax = Math.max(b.cpuMax, sample.cpuPct);
	b.memSum += sample.mem.used;
	b.memMax = Math.max(b.memMax, sample.mem.used);
	b.memTotal = sample.mem.total;
	b.rxSum += sample.net.rxBps;
	b.txSum += sample.net.txBps;
	b.disks = sample.disks;
	if (agents !== null) b.agents = Math.max(b.agents ?? 0, agents);
	buckets.set(machineId, b);
}

async function writeBucket(machineId: string, b: Bucket) {
	if (b.samples === 0) return;
	const row = {
		machineId,
		bucket: new Date(b.bucket),
		samples: b.samples,
		cpuAvg: b.cpuSum / b.samples,
		cpuMax: b.cpuMax,
		memAvg: b.memSum / b.samples,
		memMax: b.memMax,
		memTotal: b.memTotal,
		rxBps: b.rxSum / b.samples,
		txBps: b.txSum / b.samples,
		disks: b.disks,
		agents: b.agents
	};
	try {
		await db
			.insert(machineStatsMinute)
			.values(row)
			.onConflictDoUpdate({ target: [machineStatsMinute.machineId, machineStatsMinute.bucket], set: row });
	} catch (err) {
		// The machine may have been deleted meanwhile; stats are best effort.
		console.error('stats: failed to write minute bucket', err);
	}
}

/** Writes buckets whose minute has passed (covers machines that went quiet). */
async function flushCompleted() {
	const currentMinute = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
	for (const [machineId, b] of buckets) {
		if (b.bucket < currentMinute) {
			buckets.delete(machineId);
			await writeBucket(machineId, b);
		}
	}
}

export function forgetMachine(machineId: string) {
	buckets.delete(machineId);
}

/** Rolls the last few hours of minutes into the hour tier (idempotent). */
async function rollupHours() {
	await db.execute(sql`
		insert into machine_stats_hour
			(machine_id, bucket, samples, cpu_avg, cpu_max, mem_avg, mem_max, mem_total, rx_bps, tx_bps, disks, agents)
		select machine_id,
			date_trunc('hour', bucket) as hour,
			sum(samples),
			sum(cpu_avg * samples) / sum(samples),
			max(cpu_max),
			sum(mem_avg * samples) / sum(samples),
			max(mem_max),
			max(mem_total),
			sum(rx_bps * samples) / sum(samples),
			sum(tx_bps * samples) / sum(samples),
			(array_agg(disks order by bucket desc))[1],
			max(agents)
		from machine_stats_minute
		where bucket >= date_trunc('hour', now()) - interval '3 hours'
			and bucket < date_trunc('hour', now())
		group by machine_id, hour
		on conflict (machine_id, bucket) do update set
			samples = excluded.samples, cpu_avg = excluded.cpu_avg, cpu_max = excluded.cpu_max,
			mem_avg = excluded.mem_avg, mem_max = excluded.mem_max, mem_total = excluded.mem_total,
			rx_bps = excluded.rx_bps, tx_bps = excluded.tx_bps, disks = excluded.disks, agents = excluded.agents
	`);
}

// Retention settings

const RETENTION_KEY = 'machines.stats.retention';

function envInt(name: string, fallback: number | null): number | null {
	const raw = process.env[name];
	if (raw === undefined || raw === '') return fallback;
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

const defaultRetention: MachineRetentionSettings = {
	minuteRetentionDays: envInt('MACHINE_STATS_MINUTE_RETENTION_DAYS', 30) ?? 30,
	hourRetentionDays: envInt('MACHINE_STATS_HOUR_RETENTION_DAYS', 730)
};

export async function getRetention(): Promise<MachineRetentionSettings> {
	const rows = await db.select().from(appSetting).where(sql`${appSetting.key} = ${RETENTION_KEY}`);
	return { ...defaultRetention, ...((rows[0]?.value as Partial<MachineRetentionSettings>) ?? {}) };
}

export async function setRetention(value: MachineRetentionSettings, userId: string) {
	await db
		.insert(appSetting)
		.values({ key: RETENTION_KEY, value, updatedBy: userId })
		.onConflictDoUpdate({ target: appSetting.key, set: { value, updatedBy: userId } });
}

async function prune() {
	const r = await getRetention();
	await db.execute(sql`delete from machine_stats_minute where bucket < now() - make_interval(days => ${r.minuteRetentionDays})`);
	if (r.hourRetentionDays !== null) {
		await db.execute(sql`delete from machine_stats_hour where bucket < now() - make_interval(days => ${r.hourRetentionDays})`);
	}
}

// Queries

/** Point spacing per range; short ranges read minutes, long ones read hours. */
const rangePlan: Record<StatsRange, { span: string; step: string; tier: 'minute' | 'hour' }> = {
	'1h': { span: '1 hour', step: '1 minute', tier: 'minute' },
	'24h': { span: '24 hours', step: '5 minutes', tier: 'minute' },
	'7d': { span: '7 days', step: '30 minutes', tier: 'minute' },
	'30d': { span: '30 days', step: '2 hours', tier: 'hour' },
	'1y': { span: '365 days', step: '1 day', tier: 'hour' }
};

export async function querySeries(machineId: string, range: StatsRange): Promise<StatsSeries> {
	const plan = rangePlan[range];
	const table = sql.raw(plan.tier === 'minute' ? 'machine_stats_minute' : 'machine_stats_hour');
	const step = sql.raw(`'${plan.step}'::interval`);
	const span = sql.raw(`'${plan.span}'::interval`);
	const result = await db.execute<{
		t: Date;
		cpu_avg: number;
		cpu_max: number;
		mem_avg: number;
		mem_max: number;
		mem_total: number;
		rx_bps: number;
		tx_bps: number;
		agents: number | null;
	}>(sql`
		select date_bin(${step}, bucket, timestamptz '2000-01-01') as t,
			sum(cpu_avg * samples) / sum(samples) as cpu_avg,
			max(cpu_max) as cpu_max,
			sum(mem_avg * samples) / sum(samples) as mem_avg,
			max(mem_max) as mem_max,
			max(mem_total) as mem_total,
			sum(rx_bps * samples) / sum(samples) as rx_bps,
			sum(tx_bps * samples) / sum(samples) as tx_bps,
			max(agents) as agents
		from ${table}
		where machine_id = ${machineId} and bucket >= now() - ${span}
		group by t
		order by t
	`);
	const points: StatsPoint[] = result.map((r) => ({
		t: new Date(r.t).toISOString(),
		cpuAvg: Number(r.cpu_avg),
		cpuMax: Number(r.cpu_max),
		memAvg: Number(r.mem_avg),
		memMax: Number(r.mem_max),
		memTotal: Number(r.mem_total),
		rxBps: Number(r.rx_bps),
		txBps: Number(r.tx_bps),
		agents: r.agents === null ? null : Number(r.agents)
	}));
	return { range, tier: plan.tier, points };
}

// Background jobs

let timers: ReturnType<typeof setInterval>[] = [];

export function startStatsJobs() {
	const run = (name: string, job: () => Promise<void>) => () =>
		job().catch((err) => console.error(`stats: ${name} failed`, err));
	timers = [
		setInterval(run('flush', flushCompleted), 15_000),
		setInterval(run('rollup', rollupHours), 5 * MINUTE_MS),
		setInterval(run('prune', prune), 6 * 60 * MINUTE_MS)
	];
	void run('rollup', rollupHours)();
	void run('prune', prune)();
}

/** Stops the jobs and writes any buffered minutes (on shutdown). */
export async function stopStatsJobs() {
	for (const t of timers) clearInterval(t);
	for (const [machineId, b] of buckets) await writeBucket(machineId, b);
	buckets.clear();
}
