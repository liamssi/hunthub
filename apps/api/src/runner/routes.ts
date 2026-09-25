// Endpoints used by machine runners: one-time enrollment, then a long-lived
// WebSocket authenticated with the machine credential.
import { and, eq, gt, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import type { WSContext } from 'hono/ws';
import {
	RUNNER_CLOSE,
	RUNNER_MAX_MESSAGE_BYTES,
	RUNNER_PROTOCOL_VERSION,
	type ServerMessage,
	enrollRequestSchema,
	runnerMessageSchema
} from '@hunthub/shared/runner-protocol';
import { db } from '../db';
import { machine, machineJoinToken } from '../db/schema';
import { clientIp } from '../lib/client-ip';
import { createRateLimiter } from '../lib/rate-limit';
import { generateSecret, hashSecret } from '../lib/secrets';
import { serverVersion } from '../lib/version';
import { publish } from '../live/hub';
import { connectionSettings } from '../machines/connection-settings';
import * as registry from '../machines/registry';
import { toMachineDto } from '../machines/routes';

const enrollLimiter = createRateLimiter(10, 60_000);

function send(ws: WSContext, message: ServerMessage) {
	if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

type RunnerVariables = { machineId: string; publicIp: string | null };

export const runnerRoutes = new Hono<{ Variables: RunnerVariables }>()
	.post('/enroll', async (c) => {
		if (!enrollLimiter(clientIp(c) ?? 'unknown')) return c.json({ error: 'rate_limited' }, 429);
		const body = enrollRequestSchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body' }, 400);

		const credential = generateSecret('hh_mc_');
		const result = await db.transaction(async (tx) => {
			// Burn the token atomically: only one enrollment can claim it.
			const [token] = await tx
				.update(machineJoinToken)
				.set({ usedAt: new Date() })
				.where(
					and(
						eq(machineJoinToken.tokenHash, hashSecret(body.data.token)),
						isNull(machineJoinToken.usedAt),
						gt(machineJoinToken.expiresAt, new Date())
					)
				)
				.returning();
			if (!token) return null;
			const [row] = await tx
				.insert(machine)
				.values({
					name: token.name,
					tags: token.tags,
					credentialHash: hashSecret(credential),
					host: body.data.host,
					runnerVersion: body.data.runnerVersion,
					publicIp: clientIp(c),
					createdBy: token.createdBy
				})
				.returning();
			await tx.update(machineJoinToken).set({ machineId: row!.id }).where(eq(machineJoinToken.id, token.id));
			return { token, machine: row! };
		});
		if (!result) return c.json({ error: 'invalid_token', message: 'The join token is invalid, expired or already used.' }, 401);

		publish(['machines'], { type: 'machine.updated', machine: toMachineDto(result.machine) });
		publish(['machines'], { type: 'enroll.completed', tokenId: result.token.id, machineId: result.machine.id });
		return c.json({ machineId: result.machine.id, credential }, 201);
	})

	.get(
		'/ws',
		async (c, next) => {
			const header = c.req.header('authorization') ?? '';
			const credential = header.startsWith('Bearer ') ? header.slice(7) : '';
			if (!credential) return c.json({ error: 'unauthorized' }, 401);
			const [row] = await db
				.select({ id: machine.id, status: machine.status })
				.from(machine)
				.where(eq(machine.credentialHash, hashSecret(credential)));
			if (!row) return c.json({ error: 'revoked', message: 'Unknown or revoked machine credential.' }, 401);
			if (row.status !== 'active') return c.json({ error: 'disabled', message: 'This machine is disabled.' }, 403);
			c.set('machineId', row.id);
			c.set('publicIp', clientIp(c));
			await next();
		},
		upgradeWebSocket((c) => {
			const machineId = c.get('machineId');
			const publicIp = c.get('publicIp');
			let helloDone = false;

			return {
				async onMessage(event, ws) {
					const raw = typeof event.data === 'string' ? event.data : '';
					if (raw.length === 0 || raw.length > RUNNER_MAX_MESSAGE_BYTES) {
						ws.close(RUNNER_CLOSE.badMessage, 'bad message');
						return;
					}
					let parsed;
					try {
						parsed = runnerMessageSchema.safeParse(JSON.parse(raw));
					} catch {
						parsed = null;
					}
					if (!parsed?.success) {
						send(ws, { type: 'error', code: 'bad_message', message: 'Invalid message.' });
						ws.close(RUNNER_CLOSE.badMessage, 'bad message');
						return;
					}
					const msg = parsed.data;

					if (!helloDone) {
						if (msg.type !== 'hello') {
							ws.close(RUNNER_CLOSE.badMessage, 'expected hello');
							return;
						}
						if (msg.protocol !== RUNNER_PROTOCOL_VERSION) {
							send(ws, {
								type: 'error',
								code: 'incompatible',
								message: `Runner protocol ${msg.protocol} is not supported (server expects ${RUNNER_PROTOCOL_VERSION}). Update the runner.`
							});
							ws.close(RUNNER_CLOSE.incompatible, 'incompatible protocol');
							return;
						}
						helloDone = true;
						await registry.connect(machineId, ws, { host: msg.host, runnerVersion: msg.runnerVersion, publicIp });
						send(ws, {
							type: 'welcome',
							machineId,
							serverVersion,
							statsIntervalMs: connectionSettings().statsIntervalMs,
							heartbeatIntervalMs: connectionSettings().heartbeatIntervalMs
						});
						return;
					}

					registry.markActivity(machineId);
					switch (msg.type) {
						case 'stats':
							registry.handleStats(machineId, msg.sample);
							break;
						case 'host.changed':
							await registry.handleHostChanged(machineId, msg.host);
							break;
						case 'credential.rotated':
							await registry.completeRotation(machineId);
							break;
						case 'heartbeat':
						case 'hello':
							break;
					}
				},
				onClose(_event, ws) {
					void registry.disconnect(machineId, ws);
				}
			};
		})
	);
