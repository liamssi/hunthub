// Messages exchanged between a machine's runner and the HuntHub API over the
// runner WebSocket. Both sides validate every message with these schemas.
import { z } from 'zod';

/** Bump when a change is not backward compatible; the server rejects mismatches. */
export const RUNNER_PROTOCOL_VERSION = 1;

/** Largest runner message the server accepts, in bytes. */
export const RUNNER_MAX_MESSAGE_BYTES = 256 * 1024;

export const hostInfoSchema = z.object({
	hostname: z.string().max(255),
	os: z.string().max(255),
	kernel: z.string().max(255),
	arch: z.string().max(64),
	cpuModel: z.string().max(255),
	cpuCores: z.number().int().nonnegative(),
	memTotal: z.number().nonnegative(),
	privateIps: z.array(z.string().max(64)).max(32),
	herdrVersion: z.string().max(64).nullable()
});
export type HostInfo = z.infer<typeof hostInfoSchema>;

export const diskStatSchema = z.object({
	mount: z.string().max(512),
	used: z.number().nonnegative(),
	total: z.number().nonnegative()
});
export type DiskStat = z.infer<typeof diskStatSchema>;

export const statsSampleSchema = z.object({
	ts: z.number().int(),
	cpuPct: z.number().min(0).max(100),
	mem: z.object({ used: z.number().nonnegative(), total: z.number().nonnegative() }),
	disks: z.array(diskStatSchema).max(64),
	net: z.object({ rxBps: z.number().nonnegative(), txBps: z.number().nonnegative() })
});
export type StatsSample = z.infer<typeof statsSampleSchema>;

// Runner -> server
export const runnerMessageSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('hello'),
		protocol: z.number().int(),
		runnerVersion: z.string().max(64),
		capabilities: z.array(z.string().max(64)).max(64),
		host: hostInfoSchema
	}),
	z.object({ type: z.literal('heartbeat'), ts: z.number().int() }),
	z.object({ type: z.literal('stats'), sample: statsSampleSchema }),
	z.object({ type: z.literal('host.changed'), host: hostInfoSchema }),
	z.object({ type: z.literal('credential.rotated') })
]);
export type RunnerMessage = z.infer<typeof runnerMessageSchema>;

export const runnerErrorCodes = ['incompatible', 'revoked', 'disabled', 'replaced', 'bad_message'] as const;
export type RunnerErrorCode = (typeof runnerErrorCodes)[number];

// Server -> runner
export const serverMessageSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('welcome'),
		machineId: z.string(),
		serverVersion: z.string(),
		statsIntervalMs: z.number().int().positive(),
		heartbeatIntervalMs: z.number().int().positive()
	}),
	z.object({ type: z.literal('error'), code: z.enum(runnerErrorCodes), message: z.string() }),
	z.object({ type: z.literal('credential.rotate'), credential: z.string() }),
	/** Updated timings; the runner applies them immediately. */
	z.object({
		type: z.literal('settings'),
		statsIntervalMs: z.number().int().positive(),
		heartbeatIntervalMs: z.number().int().positive()
	})
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// Enrollment (HTTP): POST /api/runner/enroll
export const enrollRequestSchema = z.object({
	token: z.string().min(1).max(256),
	runnerVersion: z.string().max(64),
	host: hostInfoSchema
});
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;

export const enrollResponseSchema = z.object({
	machineId: z.string(),
	credential: z.string()
});
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;

/** WebSocket close codes used on the runner channel (4000-4999 is app-defined). */
export const RUNNER_CLOSE = {
	incompatible: 4001,
	revoked: 4002,
	disabled: 4003,
	replaced: 4004,
	badMessage: 4005,
	unauthorized: 4401
} as const;
