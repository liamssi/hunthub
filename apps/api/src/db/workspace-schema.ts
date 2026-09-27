import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth-schema';
import type { Preferences } from '@hunthub/shared/preferences';
import { machine } from './machines-schema';

/**
 * Sessions and terminals a user pinned to their sidebar. A pin without a pane
 * is the whole session; with one, that pane (its id can disappear on the
 * machine, in which case the pin shows as gone).
 */
export const userPin = pgTable(
	'user_pin',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		machineId: uuid('machine_id')
			.notNull()
			.references(() => machine.id, { onDelete: 'cascade' }),
		session: text('session').notNull(),
		paneId: text('pane_id'),
		/** What it was called when pinned (shown when it's gone from the machine). */
		label: text('label').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		unique('user_pin_unique').on(t.userId, t.machineId, t.session, t.paneId).nullsNotDistinct(),
		index('user_pin_machine_idx').on(t.machineId),
		check('user_pin_label_length', sql`char_length(${t.label}) <= 200`)
	]
);

/** Each user's settings (theme, terminal, workspace choices), so they follow the user to any browser. */
export const userPreference = pgTable('user_preference', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	prefs: jsonb('prefs').$type<Preferences>().notNull().default({}),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});
