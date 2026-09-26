// Messages exchanged between a machine's runner and the HuntHub API over the
// runner WebSocket. Both sides validate every message with these schemas.
import { z } from 'zod';

/** Bump when a change is not backward compatible; the server rejects mismatches. */
export const RUNNER_PROTOCOL_VERSION = 1;

/** Largest runner message the server accepts, in bytes. */
export const RUNNER_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

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

/**
 * A Herdr session on the machine. The snapshot is Herdr's own `session.snapshot`
 * result, forwarded as is; the hub interprets it.
 */
export const herdrSessionReportSchema = z.object({
	name: z.string().min(1).max(128),
	state: z.enum(['running', 'stopped']),
	snapshot: z.unknown().nullable()
});
export type HerdrSessionReport = z.infer<typeof herdrSessionReportSchema>;

const herdrErrorSchema = z.object({ code: z.string().max(64), message: z.string().max(2000) });

// Live terminals. A terminal is a channel between a browser and one pane,
// relayed by the hub. "cli" streams through Herdr's own
// `herdr terminal session observe|control`; "native" speaks Herdr's endpoint
// protocol directly. Both deliver ANSI frames for xterm.js.
export const terminalTransports = ['cli', 'native'] as const;
export type TerminalTransport = (typeof terminalTransports)[number];

export const terminalFrameSchema = z.object({
	seq: z.number().int(),
	/** True when `bytes` redraws the whole screen. */
	full: z.boolean(),
	width: z.number().int(),
	height: z.number().int(),
	/** Base64 ANSI to write to the terminal as is. */
	bytes: z.string()
});
export type TerminalFrame = z.infer<typeof terminalFrameSchema>;

// Runner -> server
export const runnerMessageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('term.frame'), channel: z.string().max(64), frame: terminalFrameSchema }),
	z.object({ type: z.literal('term.closed'), channel: z.string().max(64), reason: z.string().max(500) }),
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
	z.object({ type: z.literal('credential.rotated') }),
	/** A session's current state; sent when it changes. */
	z.object({ type: z.literal('herdr.session'), session: herdrSessionReportSchema }),
	/** A session disappeared from the machine. */
	z.object({ type: z.literal('herdr.session.removed'), name: z.string().max(128) }),
	/** Reply to a `herdr.call`. */
	z.object({
		type: z.literal('herdr.result'),
		id: z.string().max(128),
		ok: z.boolean(),
		result: z.unknown().optional(),
		error: herdrErrorSchema.optional()
	})
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
	/** Run a Herdr API call in a session (the runner enforces an allowlist). */
	z.object({
		type: z.literal('herdr.call'),
		id: z.string().max(128),
		session: z.string().max(128),
		method: z.string().max(128),
		params: z.record(z.string(), z.unknown())
	}),
	z.object({
		type: z.literal('term.open'),
		channel: z.string().max(64),
		session: z.string().max(128),
		target: z.string().max(128),
		mode: z.enum(['observe', 'control']),
		transport: z.enum(terminalTransports),
		cols: z.number().int().min(10).max(1000),
		rows: z.number().int().min(4).max(500),
		takeover: z.boolean()
	}),
	/** Keyboard input (base64 bytes), only for control terminals. */
	z.object({ type: z.literal('term.input'), channel: z.string().max(64), bytes: z.string().max(65536) }),
	z.object({ type: z.literal('term.resize'), channel: z.string().max(64), cols: z.number().int().min(10).max(1000), rows: z.number().int().min(4).max(500) }),
	z.object({ type: z.literal('term.scroll'), channel: z.string().max(64), direction: z.enum(['up', 'down']), lines: z.number().int().min(1).max(500) }),
	z.object({ type: z.literal('term.close'), channel: z.string().max(64) }),
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
