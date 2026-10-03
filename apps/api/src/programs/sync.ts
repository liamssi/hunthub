// Keeps each user's HackerOne programs in the database: the program list every
// hour (or on request), then each program's scope in the background (the scope
// needs one request per program, so it's refreshed at most daily).
import { and, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { ProgramMine, SyncProgress } from '@hunthub/shared/programs';
import { db } from '../db';
import { platformAccount, program, programAccess, programEvent, programScope } from '../db/schema';
import { decryptCredential } from '../lib/credentials';
import { type H1Program, type H1Scope, type HackerOneCredentials, HackerOneAuthError, listPrograms, listScopes } from './hackerone';

/** Program lists are fetched again after this long. */
export const PROGRAMS_EVERY_MS = 60 * 60 * 1000;
/** A program's scope is fetched again after this long (a manual refresh fetches every scope). */
export const SCOPES_EVERY_MS = 6 * 60 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;

type Account = typeof platformAccount.$inferSelect;

/** Syncs in progress, by account id. */
const running = new Map<number, SyncProgress>();

export const syncProgress = (accountId: number) => running.get(accountId) ?? null;

/** The account's decrypted credentials; null when they can't be read (the account is marked invalid). */
async function credentialsOf(account: Account): Promise<HackerOneCredentials | null> {
	const token = decryptCredential(account.tokenEnc);
	if (token) return { username: account.username, token };
	await db
		.update(platformAccount)
		.set({ status: 'invalid', lastError: 'The stored token can no longer be read; connect again.', updatedAt: new Date() })
		.where(eq(platformAccount.id, account.id));
	return null;
}

const mineOf = (a: H1Program['attributes']): ProgramMine => ({
	reports: a.number_of_reports_for_user ?? 0,
	validReports: a.number_of_valid_reports_for_user ?? 0,
	bountyEarned: Number(a.bounty_earned_for_user ?? 0),
	bookmarked: a.bookmarked === true
});

/** The program's shared fields (the per-user ones go to program_access). */
function sharedRaw(a: H1Program['attributes']) {
	const { number_of_reports_for_user, number_of_valid_reports_for_user, bounty_earned_for_user, bookmarked, last_invitation_accepted_at_for_user, ...rest } = a;
	return rest;
}

type EventRow = typeof programEvent.$inferInsert;

/** Program fields whose changes are recorded (besides the policy). */
const TRACKED = ['name', 'public', 'offersBounties', 'submissionState'] as const;

/**
 * Stores the programs an account can see; returns their ids. Changes to
 * programs already known are recorded; new ones only once the account has
 * synced before (its first sync would make everything "new").
 */
async function storePrograms(userId: string, programs: H1Program[], firstSync: boolean): Promise<number[]> {
	const ids: number[] = [];
	for (let i = 0; i < programs.length; i += 200) {
		const chunk = programs.slice(i, i + 200);
		const before = new Map(
			(
				await db
					.select({ id: program.id, handle: program.handle, name: program.name, public: program.public, offersBounties: program.offersBounties, submissionState: program.submissionState, policy: program.policy })
					.from(program)
					.where(and(eq(program.platform, 'hackerone'), inArray(program.handle, chunk.map((p) => p.attributes.handle))))
			).map((r) => [r.handle, r])
		);
		const rows = await db
			.insert(program)
			.values(
				chunk.map(({ attributes: a }) => ({
					platform: 'hackerone',
					handle: a.handle,
					name: (a.name || a.handle).trim(),
					public: a.state === 'public_mode',
					offersBounties: a.offers_bounties === true,
					submissionState: a.submission_state ?? 'unknown',
					policy: a.policy ?? '',
					raw: sharedRaw(a)
				}))
			)
			.onConflictDoUpdate({
				target: [program.platform, program.handle],
				set: {
					name: sql`excluded.name`,
					public: sql`excluded.public`,
					offersBounties: sql`excluded.offers_bounties`,
					submissionState: sql`excluded.submission_state`,
					policy: sql`excluded.policy`,
					raw: sql`excluded.raw`,
					updatedAt: new Date()
				}
			})
			.returning({ id: program.id, handle: program.handle, name: program.name, public: program.public, offersBounties: program.offersBounties, submissionState: program.submissionState, policy: program.policy });
		const idOf = new Map(rows.map((r) => [r.handle, r.id]));
		const events: EventRow[] = [];
		for (const now of rows) {
			const old = before.get(now.handle);
			if (!old) {
				if (!firstSync) events.push({ programId: now.id, kind: 'added', detail: { name: now.name } });
				continue;
			}
			const changes = Object.fromEntries(TRACKED.filter((k) => old[k] !== now[k]).map((k) => [k, { before: old[k], after: now[k] }]));
			if (Object.keys(changes).length) events.push({ programId: now.id, kind: 'details_changed', detail: changes });
			if (old.policy !== now.policy) events.push({ programId: now.id, kind: 'policy_changed', detail: { before: old.policy, after: now.policy } });
		}
		if (events.length) await db.insert(programEvent).values(events);
		await db
			.insert(programAccess)
			.values(chunk.map(({ attributes: a }) => ({ userId, programId: idOf.get(a.handle)!, mine: mineOf(a) })))
			.onConflictDoUpdate({
				target: [programAccess.userId, programAccess.programId],
				set: { mine: sql`excluded.mine`, lastSeenAt: new Date() }
			});
		ids.push(...rows.map((r) => r.id));
	}
	// Programs the account no longer sees (an invitation ended) leave the user's list.
	const gone = db.select({ id: program.id }).from(program).where(eq(program.platform, 'hackerone'));
	await db
		.delete(programAccess)
		.where(
			and(
				eq(programAccess.userId, userId),
				inArray(programAccess.programId, gone),
				ids.length ? notInArray(programAccess.programId, ids) : sql`true`
			)
		);
	await deleteUnseenPrograms();
	return ids;
}

/** Programs nobody can see anymore are deleted (private programs' details don't linger). */
export async function deleteUnseenPrograms() {
	await db.delete(program).where(sql`not exists (select 1 from ${programAccess} where ${programAccess.programId} = ${program.id})`);
}

type ScopeRow = typeof programScope.$inferSelect;
/** Scope fields whose changes are recorded. */
const SCOPE_TRACKED = ['eligibleForBounty', 'eligibleForSubmission', 'maxSeverity', 'instruction', 'assetType', 'identifier'] as const;
const assetOf = (s: Pick<ScopeRow, 'assetType' | 'identifier' | 'eligibleForSubmission' | 'eligibleForBounty'>) => ({
	assetType: s.assetType,
	identifier: s.identifier,
	inScope: s.eligibleForSubmission,
	bounty: s.eligibleForBounty
});

/** What changed between the stored scope and HackerOne's current one. */
export function diffScopes(programId: number, old: ScopeRow[], now: Omit<ScopeRow, 'id' | 'raw' | 'programId'>[]): EventRow[] {
	const events: EventRow[] = [];
	const oldById = new Map(old.map((s) => [s.externalId, s]));
	const nowIds = new Set(now.map((s) => s.externalId));
	for (const s of now) {
		const o = oldById.get(s.externalId);
		if (!o) {
			events.push({ programId, kind: 'scope_added', detail: assetOf(s) });
			continue;
		}
		const changes = Object.fromEntries(SCOPE_TRACKED.filter((k) => (o[k] ?? null) !== (s[k] ?? null)).map((k) => [k, { before: o[k], after: s[k] }]));
		if (Object.keys(changes).length) events.push({ programId, kind: 'scope_changed', detail: { ...assetOf(s), changes } });
	}
	for (const o of old) if (!nowIds.has(o.externalId)) events.push({ programId, kind: 'scope_removed', detail: assetOf(o) });
	return events;
}

/** Replaces a program's scope with what HackerOne lists now, recording what changed since the last fetch. */
async function storeScopes(programId: number, scopes: H1Scope[]) {
	const rows = scopes.map(({ id, attributes: a }) => ({
		externalId: String(id),
		assetType: a.asset_type,
		identifier: a.asset_identifier,
		eligibleForBounty: a.eligible_for_bounty === true,
		eligibleForSubmission: a.eligible_for_submission !== false,
		maxSeverity: a.max_severity ?? null,
		instruction: a.instruction ?? ''
	}));
	await db.transaction(async (tx) => {
		const [p] = await tx.select({ fetchedAt: program.scopesFetchedAt }).from(program).where(eq(program.id, programId));
		// The first fetch has nothing to compare with.
		if (p?.fetchedAt) {
			const old = await tx.select().from(programScope).where(eq(programScope.programId, programId));
			const events = diffScopes(programId, old, rows);
			if (events.length) await tx.insert(programEvent).values(events);
		}
		await tx.delete(programScope).where(eq(programScope.programId, programId));
		if (scopes.length) {
			await tx.insert(programScope).values(rows.map((r, i) => ({ ...r, programId, raw: scopes[i]!.attributes })));
		}
		await tx.update(program).set({ scopesFetchedAt: new Date() }).where(eq(program.id, programId));
	});
}

/** Fetches one program's scope now (e.g. its page was opened before the background sync got to it). */
export async function fetchScopeNow(userId: string, programId: number): Promise<boolean> {
	const [account] = await db.select().from(platformAccount).where(and(eq(platformAccount.userId, userId), eq(platformAccount.platform, 'hackerone')));
	const [row] = await db.select({ handle: program.handle }).from(program).where(eq(program.id, programId));
	if (!account || !row) return false;
	const creds = await credentialsOf(account);
	if (!creds) return false;
	await storeScopes(programId, await listScopes(creds, row.handle));
	return true;
}

/** Syncs an account (once at a time per account); resolves when done. `full` fetches every scope, however fresh. */
export function syncAccount(accountId: number, opts: { full?: boolean } = {}): Promise<void> {
	if (running.has(accountId)) return Promise.resolve();
	const progress: SyncProgress = { phase: 'programs', programs: 0, scopesDone: 0, scopesTotal: 0 };
	running.set(accountId, progress);
	return run(accountId, progress, opts.full === true)
		.catch((e) => console.error(`programs: sync of account ${accountId} failed`, e))
		.finally(() => running.delete(accountId));
}

async function run(accountId: number, progress: SyncProgress, full: boolean) {
	const [account] = await db.select().from(platformAccount).where(eq(platformAccount.id, accountId));
	if (!account) return;
	const creds = await credentialsOf(account);
	if (!creds) return;
	const fail = (status: 'invalid' | 'error', message: string) =>
		db.update(platformAccount).set({ status, lastError: message, updatedAt: new Date() }).where(eq(platformAccount.id, accountId));
	try {
		const programs = await listPrograms(creds);
		progress.programs = programs.length;
		const ids = await storePrograms(account.userId, programs, account.lastSyncAt === null);
		await db.update(platformAccount).set({ status: 'ok', lastError: null, lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(platformAccount.id, accountId));

		// Scopes not fetched yet, or not for a while (all of them on a manual refresh).
		const staleBefore = full ? new Date() : new Date(Date.now() - SCOPES_EVERY_MS);
		const stale = ids.length
			? await db
					.select({ id: program.id, handle: program.handle })
					.from(program)
					.where(and(inArray(program.id, ids), or(isNull(program.scopesFetchedAt), lt(program.scopesFetchedAt, staleBefore))))
			: [];
		progress.phase = 'scopes';
		progress.scopesTotal = stale.length;
		for (const p of stale) {
			try {
				await storeScopes(p.id, await listScopes(creds, p.handle));
			} catch (e) {
				if (e instanceof HackerOneAuthError) throw e;
				// One program failing (e.g. it just closed) doesn't stop the others.
				console.error(`programs: scope of ${p.handle} failed: ${(e as Error).message}`);
			}
			progress.scopesDone++;
		}
	} catch (e) {
		if (e instanceof HackerOneAuthError) await fail('invalid', e.message);
		else await fail('error', (e as Error).message);
		throw e;
	}
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Every few minutes, syncs accounts whose programs are older than an hour, or
 * that have programs whose scope was never fetched (a sync was interrupted).
 */
export function startProgramSync() {
	const sweep = async () => {
		const missingScopes = sql`exists (select 1 from ${programAccess} a join ${program} p on p.id = a.program_id where a.user_id = ${platformAccount.userId} and p.scopes_fetched_at is null)`;
		const due = await db
			.select({ id: platformAccount.id })
			.from(platformAccount)
			.where(and(eq(platformAccount.status, 'ok'), or(isNull(platformAccount.lastSyncAt), lt(platformAccount.lastSyncAt, new Date(Date.now() - PROGRAMS_EVERY_MS)), missingScopes)));
		for (const a of due) await syncAccount(a.id);
	};
	sweepTimer = setInterval(() => void sweep().catch((e) => console.error('programs: sweep failed', e)), SWEEP_MS);
	void sweep().catch((e) => console.error('programs: sweep failed', e));
}

export function stopProgramSync() {
	if (sweepTimer) clearInterval(sweepTimer);
	sweepTimer = null;
}
