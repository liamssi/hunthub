// Programs a user can hunt on (from their platform accounts) and the accounts
// themselves. Every user sees only the programs their own account can access.
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { type Platform, type PlatformAccountView, type ProgramDetail, type ProgramEvent, type ProgramEventKind, type ProgramMine, type ProgramSummary, programUrl } from '@hunthub/shared/programs';
import { db } from '../db';
import { platformAccount, program, programAccess, programEvent, programScope } from '../db/schema';
import { type AuthVariables, requireUser } from '../lib/auth-guard';
import { encryptCredential } from '../lib/credentials';
import { HackerOneAuthError, verifyCredentials } from './hackerone';
import { deleteUnseenPrograms, fetchScopeNow, syncAccount, syncProgress } from './sync';

const toAccount = (row: typeof platformAccount.$inferSelect): PlatformAccountView => ({
	platform: row.platform as Platform,
	username: row.username,
	status: row.status as PlatformAccountView['status'],
	lastError: row.lastError,
	lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
	sync: syncProgress(row.id)
});

/** How long a program page waits for a scope that hasn't been fetched yet. */
const SCOPE_WAIT_MS = 5000;

const accountBody = z.object({
	username: z.string().trim().min(1).max(100),
	token: z.string().trim().min(8).max(500)
});

const accountOf = (userId: string, platform: Platform) =>
	db
		.select()
		.from(platformAccount)
		.where(and(eq(platformAccount.userId, userId), eq(platformAccount.platform, platform)))
		.then((rows) => rows[0] ?? null);

export const platformAccountRoutes = new Hono<{ Variables: AuthVariables }>()
	.use(requireUser)
	.get('/', async (c) => {
		const rows = await db.select().from(platformAccount).where(eq(platformAccount.userId, c.get('user').id)).orderBy(asc(platformAccount.platform));
		return c.json({ accounts: rows.map(toAccount) });
	})
	// Connects (or reconnects) HackerOne: the token is checked with HackerOne first, then the programs sync.
	.put('/hackerone', async (c) => {
		const body = accountBody.safeParse(await c.req.json().catch(() => null));
		if (!body.success) return c.json({ error: 'invalid_body', message: 'Enter your HackerOne username and API token.' }, 400);
		const { username, token } = body.data;
		try {
			await verifyCredentials({ username, token });
		} catch (e) {
			if (e instanceof HackerOneAuthError) return c.json({ error: 'invalid_token', message: 'HackerOne refused this username and API token.' }, 400);
			return c.json({ error: 'platform_unreachable', message: `Couldn't reach HackerOne: ${(e as Error).message}` }, 502);
		}
		const values = { userId: c.get('user').id, platform: 'hackerone', username, tokenEnc: encryptCredential(token), status: 'ok', lastError: null, updatedAt: new Date() };
		const [row] = await db
			.insert(platformAccount)
			.values(values)
			.onConflictDoUpdate({ target: [platformAccount.userId, platformAccount.platform], set: values })
			.returning();
		void syncAccount(row!.id);
		return c.json({ account: toAccount(row!) });
	})
	.post('/hackerone/sync', async (c) => {
		const account = await accountOf(c.get('user').id, 'hackerone');
		if (!account) return c.json({ error: 'not_found' }, 404);
		// A manual refresh also fetches every program's scope again.
		void syncAccount(account.id, { full: true });
		return c.json({ account: { ...toAccount(account), sync: syncProgress(account.id) } }, 202);
	})
	// Disconnecting removes the token and the user's programs (private ones nobody else sees are deleted).
	.delete('/hackerone', async (c) => {
		const userId = c.get('user').id;
		await db.delete(platformAccount).where(and(eq(platformAccount.userId, userId), eq(platformAccount.platform, 'hackerone')));
		await db
			.delete(programAccess)
			.where(and(eq(programAccess.userId, userId), sql`${programAccess.programId} in (select ${program.id} from ${program} where ${program.platform} = 'hackerone')`));
		await deleteUnseenPrograms();
		return c.body(null, 204);
	});

const summaryColumns = {
	id: program.id,
	platform: program.platform,
	handle: program.handle,
	name: program.name,
	public: program.public,
	offersBounties: program.offersBounties,
	submissionState: program.submissionState,
	scopesFetchedAt: program.scopesFetchedAt,
	mine: programAccess.mine,
	inScope: sql<number>`(select count(*)::int from ${programScope} s where s.program_id = ${program.id} and s.eligible_for_submission)`,
	bountyAssets: sql<number>`(select count(*)::int from ${programScope} s where s.program_id = ${program.id} and s.eligible_for_submission and s.eligible_for_bounty)`,
	lastChangeAt: sql<string | null>`(select max(e.at) from ${programEvent} e where e.program_id = ${program.id})`,
	assetTypes: sql<string[]>`coalesce((select array_agg(distinct s.asset_type order by s.asset_type) from ${programScope} s where s.program_id = ${program.id} and s.eligible_for_submission), '{}')`
};

type SummaryRow = { [K in keyof typeof summaryColumns]: unknown };

function toSummary(r: SummaryRow): ProgramSummary {
	const platform = r.platform as Platform;
	return {
		id: r.id as number,
		platform,
		handle: r.handle as string,
		name: r.name as string,
		public: r.public as boolean,
		offersBounties: r.offersBounties as boolean,
		submissionState: r.submissionState as string,
		inScope: r.inScope as number,
		bountyAssets: r.bountyAssets as number,
		assetTypes: r.assetTypes as string[],
		scopesFetchedAt: (r.scopesFetchedAt as Date | null)?.toISOString() ?? null,
		mine: r.mine as ProgramMine,
		url: programUrl(platform, r.handle as string),
		lastChangeAt: r.lastChangeAt ? new Date(r.lastChangeAt as string).toISOString() : null
	};
}

/** Recorded changes on the programs a user can see (one program, or all of them), newest first. */
async function eventsFor(userId: string, opts: { programId?: number; limit: number; before?: number }): Promise<ProgramEvent[]> {
	const rows = await db
		.select({ id: programEvent.id, programId: programEvent.programId, kind: programEvent.kind, detail: programEvent.detail, at: programEvent.at, programName: program.name, programHandle: program.handle })
		.from(programEvent)
		.innerJoin(program, eq(program.id, programEvent.programId))
		.innerJoin(programAccess, and(eq(programAccess.programId, program.id), eq(programAccess.userId, userId)))
		.where(
			and(
				opts.programId === undefined ? undefined : eq(programEvent.programId, opts.programId),
				opts.before === undefined ? undefined : sql`${programEvent.id} < ${opts.before}`
			)
		)
		.orderBy(desc(programEvent.at), desc(programEvent.id))
		.limit(opts.limit);
	return rows.map((r) => ({ ...r, kind: r.kind as ProgramEventKind, detail: r.detail as Record<string, unknown>, at: r.at.toISOString() }));
}

export const programRoutes = new Hono<{ Variables: AuthVariables }>()
	.use(requireUser)
	.get('/', async (c) => {
		const rows = await db
			.select(summaryColumns)
			.from(program)
			.innerJoin(programAccess, and(eq(programAccess.programId, program.id), eq(programAccess.userId, c.get('user').id)))
			.orderBy(asc(program.name));
		return c.json({ programs: rows.map(toSummary) });
	})
	// Recent changes across all your programs (pages with ?before=<last id>).
	.get('/changes', async (c) => {
		const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 100));
		const before = Number(c.req.query('before')) || undefined;
		return c.json({ events: await eventsFor(c.get('user').id, { limit, before }) });
	})
	.get('/:id{[0-9]+}', async (c) => {
		const userId = c.get('user').id;
		const id = Number(c.req.param('id'));
		const find = () =>
			db
				.select({ ...summaryColumns, policy: program.policy, updatedAt: program.updatedAt })
				.from(program)
				.innerJoin(programAccess, and(eq(programAccess.programId, program.id), eq(programAccess.userId, userId)))
				.where(eq(program.id, id))
				.then((rows) => rows[0] ?? null);
		let row = await find();
		if (!row) return c.json({ error: 'not_found' }, 404);
		// Opened before the background sync reached it: fetch its scope now, but don't keep the page
		// waiting on HackerOne (the sync stores it anyway; the page shows it on the next visit).
		if (!row.scopesFetchedAt) {
			const handle = row.handle;
			const fetching = fetchScopeNow(userId, id).catch((e) => {
				console.error(`programs: scope of ${handle} failed: ${(e as Error).message}`);
				return false;
			});
			if (await Promise.race([fetching, Bun.sleep(SCOPE_WAIT_MS).then(() => false)])) row = (await find()) ?? row;
		}
		const scopes = await db
			.select({
				assetType: programScope.assetType,
				identifier: programScope.identifier,
				eligibleForBounty: programScope.eligibleForBounty,
				eligibleForSubmission: programScope.eligibleForSubmission,
				maxSeverity: programScope.maxSeverity,
				instruction: programScope.instruction
			})
			.from(programScope)
			.where(eq(programScope.programId, id))
			.orderBy(sql`${programScope.eligibleForSubmission} desc`, asc(programScope.assetType), asc(programScope.identifier));
		const events = await eventsFor(userId, { programId: id, limit: 200 });
		const detail: ProgramDetail = { ...toSummary(row), policy: row.policy, scopes, updatedAt: row.updatedAt.toISOString(), events };
		return c.json({ program: detail });
	});
