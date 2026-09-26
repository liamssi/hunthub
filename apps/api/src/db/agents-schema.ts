import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth-schema';
import { machine } from './machines-schema';

/**
 * Agents HuntHub started, or adopted (an agent started elsewhere that someone
 * took over). Herdr stays the source of truth for what runs; a run only says
 * who started or adopted the agent with this Herdr name, which Herdr keeps
 * across its restarts. A run ends when its agent is gone from a running session.
 */
export const agentRun = pgTable(
	'agent_run',
	{
		/** Also given to the agent's pane as HUNTHUB_RUN_ID. */
		id: uuid('id').primaryKey(),
		machineId: uuid('machine_id')
			.notNull()
			.references(() => machine.id, { onDelete: 'cascade' }),
		session: text('session').notNull(),
		/** The agent's name in Herdr (its identity there). */
		name: text('name').notNull(),
		/** Herdr's agent kind (claude, codex, …), when known. */
		kind: text('kind'),
		/** started | adopted */
		origin: text('origin').notNull(),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		endedAt: timestamp('ended_at', { withTimezone: true })
	},
	(t) => [
		check('agent_run_origin_check', sql`${t.origin} in ('started', 'adopted')`),
		check('agent_run_name_length', sql`char_length(${t.name}) <= 64`),
		// Herdr names are unique among a session's live agents.
		uniqueIndex('agent_run_live_name_idx').on(t.machineId, t.session, t.name).where(sql`${t.endedAt} is null`),
		index('agent_run_user_idx').on(t.userId),
		index('agent_run_created_idx').on(t.createdAt)
	]
);

/**
 * When an agent started needing someone (it asks something) or finished its
 * work, for the notifications inbox. Kept for two weeks.
 */
export const attentionEvent = pgTable(
	'attention_event',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		machineId: uuid('machine_id')
			.notNull()
			.references(() => machine.id, { onDelete: 'cascade' }),
		session: text('session').notNull(),
		workspaceLabel: text('workspace_label').notNull(),
		paneId: text('pane_id').notNull(),
		agent: text('agent').notNull(),
		/** needs_you | finished */
		kind: text('kind').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
	},
	(t) => [
		check('attention_event_kind_check', sql`${t.kind} in ('needs_you', 'finished')`),
		index('attention_event_created_idx').on(t.createdAt),
		index('attention_event_machine_idx').on(t.machineId)
	]
);
