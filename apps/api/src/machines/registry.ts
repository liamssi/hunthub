// Live runner connections: which machines are online, their latest sample,
// and offline detection. The database stays the source of truth for machine
// records; this only holds what exists while a runner is connected.
import { eq } from 'drizzle-orm';
import type { WSContext } from 'hono/ws';
import type { HostInfo, ServerMessage, StatsSample } from '@hunthub/shared/runner-protocol';
import { RUNNER_CLOSE } from '@hunthub/shared/runner-protocol';
import { db } from '../db';
import { machine } from '../db/schema';
import { publish } from '../live/hub';
import { failCallsFor } from '../herdr/calls';
import * as herdrState from '../herdr/state';
import { connectionSettings } from './connection-settings';
import { forgetMachine, recordSample } from './stats';

type Connection = {
	ws: WSContext;
	connectedAt: number;
	lastMessageAt: number;
	stats: StatsSample | null;
	/** Credential sent in a pending rotation, applied once the runner confirms. */
	pendingCredentialHash: string | null;
};

const connections = new Map<string, Connection>();

export function isOnline(machineId: string): boolean {
	return connections.has(machineId);
}

export function latestStats(machineId: string): StatsSample | null {
	return connections.get(machineId)?.stats ?? null;
}

function topics(machineId: string) {
	return ['machines', `machine:${machineId}`] as const;
}

function sendTo(ws: WSContext, message: ServerMessage) {
	if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

async function touchLastSeen(machineId: string, extra: Partial<typeof machine.$inferInsert> = {}) {
	const lastSeenAt = new Date();
	await db
		.update(machine)
		.set({ lastSeenAt, ...extra })
		.where(eq(machine.id, machineId))
		.catch((err) => console.error('registry: failed to update machine', err));
	return lastSeenAt;
}

/** Registers a connection after a valid hello; replaces any older connection. */
export async function connect(
	machineId: string,
	ws: WSContext,
	info: { host: HostInfo; runnerVersion: string; publicIp: string | null; capabilities: string[] }
) {
	const previous = connections.get(machineId);
	if (previous) previous.ws.close(RUNNER_CLOSE.replaced, 'replaced by a newer connection');
	const now = Date.now();
	connections.set(machineId, { ws, connectedAt: now, lastMessageAt: now, stats: null, pendingCredentialHash: null });
	const lastSeenAt = await touchLastSeen(machineId, {
		host: info.host,
		runnerVersion: info.runnerVersion,
		publicIp: info.publicIp
	});
	const [row] = await db.select({ name: machine.name }).from(machine).where(eq(machine.id, machineId));
	herdrState.trackMachine(machineId, row?.name ?? 'machine', info.capabilities.includes('herdr'));
	publish([...topics(machineId)], {
		type: 'machine.connection',
		machineId,
		connection: 'online',
		lastSeenAt: lastSeenAt.toISOString()
	});
}

/** Removes a connection (only if it is still the current one for the machine). */
export async function disconnect(machineId: string, ws: WSContext) {
	const current = connections.get(machineId);
	if (!current || current.ws !== ws) return;
	connections.delete(machineId);
	forgetMachine(machineId);
	herdrState.forgetMachine(machineId);
	failCallsFor(machineId);
	const lastSeenAt = await touchLastSeen(machineId);
	publish([...topics(machineId)], {
		type: 'machine.connection',
		machineId,
		connection: 'offline',
		lastSeenAt: lastSeenAt.toISOString()
	});
}

export function markActivity(machineId: string) {
	const c = connections.get(machineId);
	if (c) c.lastMessageAt = Date.now();
}

export function handleStats(machineId: string, sample: StatsSample) {
	const c = connections.get(machineId);
	if (!c) return;
	c.stats = sample;
	recordSample(machineId, sample, herdrState.agentCount(machineId));
	publish([...topics(machineId)], { type: 'machine.stats', machineId, sample });
}

export async function handleHostChanged(machineId: string, host: HostInfo) {
	await db.update(machine).set({ host }).where(eq(machine.id, machineId));
}

/** Sends a message to a connected runner; false if the machine is offline. */
export function sendToMachine(machineId: string, message: ServerMessage): boolean {
	const c = connections.get(machineId);
	if (!c || c.ws.readyState !== 1) return false;
	sendTo(c.ws, message);
	return true;
}

/** Closes a machine's connection, e.g. when it is disabled or removed. */
export function kick(machineId: string, code: number, reason: string, error?: ServerMessage) {
	const c = connections.get(machineId);
	if (!c) return;
	if (error) sendTo(c.ws, error);
	c.ws.close(code, reason);
}

/** Starts a credential rotation; returns false if the machine is offline. */
export function startRotation(machineId: string, credential: string, credentialHash: string): boolean {
	const c = connections.get(machineId);
	if (!c) return false;
	c.pendingCredentialHash = credentialHash;
	sendTo(c.ws, { type: 'credential.rotate', credential });
	return true;
}

/** Called when the runner confirms it saved the new credential. */
export async function completeRotation(machineId: string) {
	const c = connections.get(machineId);
	if (!c?.pendingCredentialHash) return;
	await db.update(machine).set({ credentialHash: c.pendingCredentialHash }).where(eq(machine.id, machineId));
	c.pendingCredentialHash = null;
}

/** Pushes new timings to every connected runner. */
export function broadcastSettings() {
	const { statsIntervalMs, heartbeatIntervalMs } = connectionSettings();
	for (const c of connections.values()) sendTo(c.ws, { type: 'settings', statsIntervalMs, heartbeatIntervalMs });
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Marks quiet connections offline. It doesn't wait for the close handshake,
 * which may never finish if the network to the machine is gone.
 */
export function startOfflineSweep() {
	sweepTimer = setInterval(() => {
		const cutoff = Date.now() - connectionSettings().offlineAfterMs;
		for (const [machineId, c] of connections) {
			if (c.lastMessageAt >= cutoff) continue;
			c.ws.close(4008, 'heartbeat timeout');
			void disconnect(machineId, c.ws);
		}
	}, 1_000);
}

export function stopOfflineSweep() {
	if (sweepTimer) clearInterval(sweepTimer);
	for (const c of connections.values()) c.ws.close(1001, 'server shutting down');
}
