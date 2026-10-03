import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

/**
 * A user's account on a bug bounty platform (HackerOne for now), used to read
 * the programs they can hunt on. The API token is stored encrypted (see
 * lib/credentials.ts) and never sent back to the browser.
 */
export const platformAccount = pgTable(
	'platform_account',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		platform: text('platform').notNull(),
		username: text('username').notNull(),
		tokenEnc: text('token_enc').notNull(),
		/** ok, invalid (the platform refused the token) or error (the last sync failed otherwise). */
		status: text('status').notNull().default('ok'),
		lastError: text('last_error'),
		lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		unique('platform_account_user_platform').on(t.userId, t.platform),
		check('platform_account_platform', sql`${t.platform} in ('hackerone')`),
		check('platform_account_status', sql`${t.status} in ('ok', 'invalid', 'error')`)
	]
);

/** A program on a platform (a target is a program). Stored once, however many users can see it. */
export const program = pgTable(
	'program',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		platform: text('platform').notNull(),
		handle: text('handle').notNull(),
		name: text('name').notNull(),
		/** Public, or private (invitation only). */
		public: boolean('public').notNull(),
		offersBounties: boolean('offers_bounties').notNull(),
		/** Whether it takes reports now (open, paused, ...). */
		submissionState: text('submission_state').notNull(),
		policy: text('policy').notNull().default(''),
		/** The platform's own fields, as last fetched (new fields aren't lost). */
		raw: jsonb('raw').notNull(),
		scopesFetchedAt: timestamp('scopes_fetched_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [unique('program_platform_handle').on(t.platform, t.handle)]
);

/** Which users can see which programs (private ones differ per hacker), with their own numbers on it. */
export const programAccess = pgTable(
	'program_access',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		programId: bigint('program_id', { mode: 'number' })
			.notNull()
			.references(() => program.id, { onDelete: 'cascade' }),
		/** The user's own figures on the program (reports, bounties earned, bookmarked). */
		mine: jsonb('mine').notNull().default({}),
		firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.programId] }), index('program_access_program_idx').on(t.programId)]
);

/** A program's assets: what's in scope (and what's explicitly not). */
export const programScope = pgTable(
	'program_scope',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		programId: bigint('program_id', { mode: 'number' })
			.notNull()
			.references(() => program.id, { onDelete: 'cascade' }),
		/** The platform's id for this asset. */
		externalId: text('external_id').notNull(),
		assetType: text('asset_type').notNull(),
		identifier: text('identifier').notNull(),
		eligibleForBounty: boolean('eligible_for_bounty').notNull(),
		eligibleForSubmission: boolean('eligible_for_submission').notNull(),
		maxSeverity: text('max_severity'),
		instruction: text('instruction').notNull().default(''),
		raw: jsonb('raw').notNull()
	},
	(t) => [unique('program_scope_external').on(t.programId, t.externalId), index('program_scope_type_idx').on(t.assetType)]
);

/**
 * What changed on a program, as seen by successive syncs: scope assets added,
 * removed or changed, policy edits, and changes to rewards or submissions. A
 * program's first sync records nothing (there's nothing to compare with).
 */
export const programEvent = pgTable(
	'program_event',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		programId: bigint('program_id', { mode: 'number' })
			.notNull()
			.references(() => program.id, { onDelete: 'cascade' }),
		/** added (a new program), scope_added, scope_removed, scope_changed, policy_changed, details_changed. */
		kind: text('kind').notNull(),
		/** What changed: the asset, or the fields with their old and new values. */
		detail: jsonb('detail').notNull().default({}),
		at: timestamp('at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		index('program_event_program_at_idx').on(t.programId, t.at),
		index('program_event_at_idx').on(t.at),
		check('program_event_kind', sql`${t.kind} in ('added', 'scope_added', 'scope_removed', 'scope_changed', 'policy_changed', 'details_changed')`)
	]
);
