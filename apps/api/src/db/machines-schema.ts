import { sql } from 'drizzle-orm';
import {
	check,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';
import type { DiskStat, HostInfo } from '@hunthub/shared/runner-protocol';
import { user } from './auth-schema';

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
	timestamp('updated_at', { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull();

export const machine = pgTable(
	'machine',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
		status: text('status').notNull().default('active'),
		/** SHA-256 of the machine credential; the credential itself is never stored. */
		credentialHash: text('credential_hash').notNull().unique(),
		host: jsonb('host').$type<HostInfo>(),
		runnerVersion: text('runner_version'),
		publicIp: text('public_ip'),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		check('machine_status_check', sql`${t.status} in ('active', 'disabled')`),
		check('machine_name_length', sql`length(${t.name}) between 1 and 100`),
		index('machine_created_by_idx').on(t.createdBy)
	]
);

export const machineJoinToken = pgTable(
	'machine_join_token',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		/** SHA-256 of the one-time token. */
		tokenHash: text('token_hash').notNull().unique(),
		name: text('name').notNull(),
		tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		usedAt: timestamp('used_at', { withTimezone: true }),
		machineId: uuid('machine_id').references(() => machine.id, { onDelete: 'set null' }),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('machine_join_token_machine_idx').on(t.machineId), index('machine_join_token_created_by_idx').on(t.createdBy)]
);

// Stats tiers share one shape: averages and peaks per bucket.
const statsColumns = {
	machineId: uuid('machine_id')
		.notNull()
		.references(() => machine.id, { onDelete: 'cascade' }),
	bucket: timestamp('bucket', { withTimezone: true }).notNull(),
	samples: integer('samples').notNull(),
	cpuAvg: doublePrecision('cpu_avg').notNull(),
	cpuMax: doublePrecision('cpu_max').notNull(),
	memAvg: doublePrecision('mem_avg').notNull(),
	memMax: doublePrecision('mem_max').notNull(),
	memTotal: doublePrecision('mem_total').notNull(),
	rxBps: doublePrecision('rx_bps').notNull(),
	txBps: doublePrecision('tx_bps').notNull(),
	/** Latest per-mount usage in the bucket. */
	disks: jsonb('disks').$type<DiskStat[]>().notNull(),
	/** Agent count; filled from M2 (Herdr). */
	agents: integer('agents')
};

export const machineStatsMinute = pgTable('machine_stats_minute', statsColumns, (t) => [
	primaryKey({ columns: [t.machineId, t.bucket] })
]);

export const machineStatsHour = pgTable('machine_stats_hour', statsColumns, (t) => [
	primaryKey({ columns: [t.machineId, t.bucket] })
]);

export const appSetting = pgTable(
	'app_setting',
	{
		key: text('key').primaryKey(),
		value: jsonb('value').notNull(),
		updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
		updatedAt: updatedAt()
	},
	(t) => [index('app_setting_updated_by_idx').on(t.updatedBy)]
);
