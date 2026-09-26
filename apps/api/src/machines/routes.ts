import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { JoinTokenCreated, Machine, StatsRange } from '@hunthub/shared/machines';
import { RUNNER_CLOSE } from '@hunthub/shared/runner-protocol';
import { db } from '../db';
import { machine, machineJoinToken } from '../db/schema';
import { type AuthVariables, requireAdmin, requireUser } from '../lib/auth-guard';
import { generateSecret, hashSecret } from '../lib/secrets';
import { publish } from '../live/hub';
import { callHerdr, HerdrCallError } from '../herdr/calls';
import { agentCount, machineHerdr, renameMachine } from '../herdr/state';
import { connectionSettings, connectionSettingsSchema, saveConnectionSettings } from './connection-settings';
import { broadcastSettings, isOnline, kick, latestStats, startRotation } from './registry';
import { getRetention, querySeries, setRetention } from './stats';

export const JOIN_TOKEN_TTL_MS = 60 * 60 * 1000;

const tagsSchema = z.array(z.string().trim().min(1).max(32)).max(20);
const nameSchema = z.string().trim().min(1).max(100);

export function toMachineDto(row: typeof machine.$inferSelect): Machine {
	return {
		id: row.id,
		name: row.name,
		tags: row.tags,
		status: row.status as Machine['status'],
		connection: isOnline(row.id) ? 'online' : 'offline',
		host: row.host ?? null,
		runnerVersion: row.runnerVersion,
		publicIp: row.publicIp,
		lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		stats: latestStats(row.id),
		agents: agentCount(row.id)
	};
}

/** Public base URL of HuntHub (what browsers and runners use). */
function publicUrl(): string {
	return (process.env.BETTER_AUTH_URL ?? 'http://localhost:3001').replace(/\/$/, '');
}

async function findMachine(id: string) {
	if (!z.uuid().safeParse(id).success) return null;
	const rows = await db.select().from(machine).where(eq(machine.id, id));
	return rows[0] ?? null;
}

function broadcastUpdated(row: typeof machine.$inferSelect) {
	publish(['machines', `machine:${row.id}`], { type: 'machine.updated', machine: toMachineDto(row) });
}

export const machineRoutes = new Hono<{ Variables: AuthVariables }>()
	.use(requireUser)

	// Viewing: every signed-in user.
	.get('/', async (c) => {
		const rows = await db.select().from(machine).orderBy(desc(machine.createdAt));
		return c.json({ machines: rows.map(toMachineDto) });
	})
	.get('/:id', async (c) => {
		const row = await findMachine(c.req.param('id'));
		if (!row) return c.json({ error: 'not_found' }, 404);
		return c.json({ machine: toMachineDto(row) });
	})
	.get('/:id/herdr', async (c) => {
		const row = await findMachine(c.req.param('id'));
		if (!row) return c.json({ error: 'not_found' }, 404);
		return c.json(machineHerdr(row.id));
	})
	// Recent output of a pane (read-only), fetched live from the machine.
	.get('/:id/sessions/:session/panes/:pane/output', async (c) => {
		const row = await findMachine(c.req.param('id'));
		if (!row) return c.json({ error: 'not_found' }, 404);
		const lines = Math.min(Math.max(Number(c.req.query('lines') ?? 80) || 80, 1), 500);
		try {
			const result = await callHerdr<{ text?: string; read?: { text?: string } }>(row.id, c.req.param('session'), 'pane.read', {
				pane_id: c.req.param('pane'),
				source: 'recent_unwrapped',
				lines
			});
			return c.json({ text: result.text ?? result.read?.text ?? '' });
		} catch (err) {
			if (err instanceof HerdrCallError) {
				const status = err.code === 'offline' ? 409 : err.code === 'timeout' ? 504 : 400;
				return c.json({ error: err.code, message: err.message }, status);
			}
			throw err;
		}
	})
	.get('/:id/stats', async (c) => {
		const range = z.enum(['1h', '24h', '7d', '30d', '1y']).safeParse(c.req.query('range') ?? '1h');
		if (!range.success) return c.json({ error: 'invalid_range' }, 400);
		const row = await findMachine(c.req.param('id'));
		if (!row) return c.json({ error: 'not_found' }, 404);
		return c.json(await querySeries(row.id, range.data as StatsRange));
	})

	// Managing: admins only.
	.post('/join-tokens', requireAdmin, async (c) => {
		const body = z.object({ name: nameSchema, tags: tagsSchema.default([]) }).safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
		const token = generateSecret('hh_join_');
		const expiresAt = new Date(Date.now() + JOIN_TOKEN_TTL_MS);
		const [row] = await db
			.insert(machineJoinToken)
			.values({ tokenHash: hashSecret(token), name: body.data.name, tags: body.data.tags, expiresAt, createdBy: c.get('user').id })
			.returning({ id: machineJoinToken.id });
		const result: JoinTokenCreated = {
			tokenId: row!.id,
			token,
			installCommand: `curl -fsSL ${publicUrl()}/api/install.sh | sh -s -- ${token}`,
			expiresAt: expiresAt.toISOString()
		};
		return c.json(result, 201);
	})
	.patch('/:id', requireAdmin, async (c) => {
		const body = z
			.object({ name: nameSchema.optional(), tags: tagsSchema.optional() })
			.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
		const existing = await findMachine(c.req.param('id'));
		if (!existing) return c.json({ error: 'not_found' }, 404);
		const [row] = await db.update(machine).set(body.data).where(eq(machine.id, existing.id)).returning();
		if (body.data.name) renameMachine(row!.id, row!.name);
		broadcastUpdated(row!);
		return c.json({ machine: toMachineDto(row!) });
	})
	.post('/:id/disable', requireAdmin, async (c) => {
		const existing = await findMachine(c.req.param('id'));
		if (!existing) return c.json({ error: 'not_found' }, 404);
		const [row] = await db.update(machine).set({ status: 'disabled' }).where(eq(machine.id, existing.id)).returning();
		kick(existing.id, RUNNER_CLOSE.disabled, 'machine disabled', {
			type: 'error',
			code: 'disabled',
			message: 'This machine was disabled in HuntHub.'
		});
		broadcastUpdated(row!);
		return c.json({ machine: toMachineDto(row!) });
	})
	.post('/:id/enable', requireAdmin, async (c) => {
		const existing = await findMachine(c.req.param('id'));
		if (!existing) return c.json({ error: 'not_found' }, 404);
		const [row] = await db.update(machine).set({ status: 'active' }).where(eq(machine.id, existing.id)).returning();
		broadcastUpdated(row!);
		return c.json({ machine: toMachineDto(row!) });
	})
	.post('/:id/rotate-credential', requireAdmin, async (c) => {
		const existing = await findMachine(c.req.param('id'));
		if (!existing) return c.json({ error: 'not_found' }, 404);
		const credential = generateSecret('hh_mc_');
		if (!startRotation(existing.id, credential, hashSecret(credential))) {
			return c.json({ error: 'offline', message: 'The machine must be online to rotate its credential.' }, 409);
		}
		return c.json({ ok: true });
	})
	.delete('/:id', requireAdmin, async (c) => {
		const existing = await findMachine(c.req.param('id'));
		if (!existing) return c.json({ error: 'not_found' }, 404);
		await db.delete(machine).where(eq(machine.id, existing.id));
		kick(existing.id, RUNNER_CLOSE.revoked, 'machine removed', {
			type: 'error',
			code: 'revoked',
			message: 'This machine was removed from HuntHub.'
		});
		publish(['machines', `machine:${existing.id}`], { type: 'machine.removed', machineId: existing.id });
		return c.json({ ok: true });
	});

export const settingsRoutes = new Hono<{ Variables: AuthVariables }>()
	.use(requireUser, requireAdmin)
	.get('/machines', async (c) => c.json({ retention: await getRetention(), connection: connectionSettings() }))
	.put('/machines/retention', async (c) => {
		const body = z
			.object({
				minuteRetentionDays: z.number().int().min(1).max(365),
				hourRetentionDays: z.number().int().min(1).max(36500).nullable()
			})
			.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
		await setRetention(body.data, c.get('user').id);
		return c.json(body.data);
	})
	.put('/machines/connection', async (c) => {
		const body = connectionSettingsSchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues, message: body.error.issues[0]?.message }, 400);
		await saveConnectionSettings(body.data, c.get('user').id);
		broadcastSettings();
		return c.json(body.data);
	});
