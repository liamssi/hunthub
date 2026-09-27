// The explorer and workspace across machines: every machine's Herdr state at
// once, and each user's pinned sessions and terminals.
import { and, asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { validateSessionName } from '@hunthub/shared/console';
import { type Preferences, preferencesSchema } from '@hunthub/shared/preferences';
import type { Pin } from '@hunthub/shared/machines';
import { db } from '../db';
import { machine, userPin, userPreference } from '../db/schema';
import { recentAttention } from '../herdr/attention';
import { allHerdr } from '../herdr/state';
import { type AuthVariables, requireUser } from '../lib/auth-guard';

/** Herdr state of every connected machine, by machine id (live updates arrive on the "agents" topic). */
export const herdrRoutes = new Hono<{ Variables: AuthVariables }>().use(requireUser).get('/', (c) => c.json({ machines: allHerdr() }));

/** Recent attention events (agents that needed someone or finished), newest first. */
export const attentionRoutes = new Hono<{ Variables: AuthVariables }>()
	.use(requireUser)
	.get('/', async (c) => c.json({ events: await recentAttention(60) }));

const toPin = (row: typeof userPin.$inferSelect): Pin => ({
	id: row.id,
	machineId: row.machineId,
	session: row.session,
	paneId: row.paneId,
	label: row.label,
	createdAt: row.createdAt.toISOString()
});

const pinBody = z.object({
	machineId: z.string().uuid(),
	session: z.string().max(128),
	paneId: z
		.string()
		.regex(/^[A-Za-z0-9:_.-]{1,64}$/)
		.nullish(),
	label: z.string().trim().min(1).max(200)
});

export const pinRoutes = new Hono<{ Variables: AuthVariables }>()
	.use(requireUser)
	.get('/', async (c) => {
		const rows = await db.select().from(userPin).where(eq(userPin.userId, c.get('user').id)).orderBy(asc(userPin.createdAt), asc(userPin.id));
		return c.json({ pins: rows.map(toPin) });
	})
	// Pinning is idempotent: pinning the same thing again returns the existing pin.
	.post('/', async (c) => {
		const body = pinBody.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body' }, 400);
		const invalid = validateSessionName(body.data.session);
		if (invalid) return c.json({ error: 'invalid_name', message: invalid }, 400);
		const [known] = await db.select({ id: machine.id }).from(machine).where(eq(machine.id, body.data.machineId));
		if (!known) return c.json({ error: 'not_found' }, 404);
		const values = {
			userId: c.get('user').id,
			machineId: body.data.machineId,
			session: body.data.session,
			paneId: body.data.paneId ?? null,
			label: body.data.label
		};
		const [created] = await db.insert(userPin).values(values).onConflictDoNothing().returning();
		if (created) return c.json({ pin: toPin(created) }, 201);
		const [existing] = await db
			.select()
			.from(userPin)
			.where(
				and(
					eq(userPin.userId, values.userId),
					eq(userPin.machineId, values.machineId),
					eq(userPin.session, values.session),
					values.paneId === null ? sql`${userPin.paneId} is null` : eq(userPin.paneId, values.paneId)
				)
			);
		return c.json({ pin: toPin(existing!) }, 200);
	})
	.delete('/:id', async (c) => {
		const id = Number(c.req.param('id'));
		if (!Number.isSafeInteger(id)) return c.json({ error: 'not_found' }, 404);
		const [removed] = await db
			.delete(userPin)
			.where(and(eq(userPin.id, id), eq(userPin.userId, c.get('user').id)))
			.returning({ id: userPin.id });
		return removed ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
	});

async function preferencesOf(userId: string): Promise<Preferences> {
	const [row] = await db.select({ prefs: userPreference.prefs }).from(userPreference).where(eq(userPreference.userId, userId));
	// Anything no longer valid is dropped rather than failing.
	const parsed = preferencesSchema.safeParse(row?.prefs ?? {});
	return parsed.success ? parsed.data : {};
}

/** The signed-in user's settings; a PATCH merges what it sends (terminal settings field by field). */
export const preferenceRoutes = new Hono<{ Variables: AuthVariables }>()
	.use(requireUser)
	.get('/', async (c) => c.json({ prefs: await preferencesOf(c.get('user').id) }))
	.patch('/', async (c) => {
		const body = preferencesSchema.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body', issues: body.error.issues }, 400);
		const userId = c.get('user').id;
		const current = await preferencesOf(userId);
		const prefs: Preferences = {
			...current,
			...body.data,
			...(body.data.terminal && { terminal: { ...current.terminal, ...body.data.terminal } })
		};
		await db
			.insert(userPreference)
			.values({ userId, prefs })
			.onConflictDoUpdate({ target: userPreference.userId, set: { prefs, updatedAt: new Date() } });
		return c.json({ prefs });
	});
