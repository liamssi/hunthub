// Notices when an agent starts needing someone (Herdr reports it blocked: it
// asks something) or finishes (working, then done or idle), by comparing a
// session's consecutive views, and tells every signed-in browser. Events are
// kept for two weeks for the inbox.
import type { AgentStatus, AttentionEvent, AttentionKind, SessionView } from '@hunthub/shared/machines';
import { desc, eq, lt } from 'drizzle-orm';
import { db } from '../db';
import { attentionEvent, machine } from '../db/schema';
import { publish } from '../live/hub';

/** The same agent doesn't raise the same kind of event again this soon (status flapping). */
const COOLDOWN_MS = 60_000;
const KEEP_MS = 14 * 24 * 60 * 60_000;

type Detected = Omit<AttentionEvent, 'id' | 'at'>;

const lastRaised = new Map<string, number>();

/**
 * What changed between two views of a session that someone should hear about.
 * Only agents seen before count: a session's first report (after a reconnect)
 * raises nothing.
 */
export function detectAttention(machineId: string, machineName: string, before: SessionView, after: SessionView, now = Date.now()): Detected[] {
	const was = new Map<string, { status: AgentStatus; name: string }>();
	for (const w of before.workspaces) for (const a of w.agents) was.set(a.paneId, { status: a.status, name: a.name });
	const out: Detected[] = [];
	for (const w of after.workspaces) {
		for (const a of w.agents) {
			const prev = was.get(a.paneId);
			if (!prev) continue;
			let kind: AttentionKind | null = null;
			if (a.status === 'blocked' && prev.status !== 'blocked') kind = 'needs_you';
			else if (prev.status === 'working' && (a.status === 'done' || a.status === 'idle')) kind = 'finished';
			if (!kind) continue;
			const key = `${machineId}\t${after.name}\t${a.paneId}\t${kind}`;
			if (now - (lastRaised.get(key) ?? 0) < COOLDOWN_MS) continue;
			lastRaised.set(key, now);
			out.push({ machineId, machineName, session: after.name, workspaceLabel: w.label, paneId: a.paneId, agent: a.name, kind });
		}
	}
	return out;
}

/** Stores events and sends them to every signed-in browser. */
export async function raiseAttention(events: Detected[]) {
	if (!events.length) return;
	const rows = await db
		.insert(attentionEvent)
		.values(events.map((e) => ({ machineId: e.machineId, session: e.session, workspaceLabel: e.workspaceLabel, paneId: e.paneId, agent: e.agent, kind: e.kind })))
		.returning({ id: attentionEvent.id, createdAt: attentionEvent.createdAt });
	events.forEach((e, i) => publish(['agents'], { type: 'attention', event: { ...e, id: rows[i]!.id, at: rows[i]!.createdAt.toISOString() } }));
}

/** The most recent events, newest first. */
export async function recentAttention(limit = 50): Promise<AttentionEvent[]> {
	const rows = await db
		.select({ e: attentionEvent, machineName: machine.name })
		.from(attentionEvent)
		.innerJoin(machine, eq(machine.id, attentionEvent.machineId))
		.orderBy(desc(attentionEvent.createdAt))
		.limit(limit);
	return rows.map(({ e, machineName }) => ({
		id: e.id,
		machineId: e.machineId,
		machineName,
		session: e.session,
		workspaceLabel: e.workspaceLabel,
		paneId: e.paneId,
		agent: e.agent,
		kind: e.kind as AttentionKind,
		at: e.createdAt.toISOString()
	}));
}

export async function pruneAttention() {
	await db.delete(attentionEvent).where(lt(attentionEvent.createdAt, new Date(Date.now() - KEEP_MS)));
}
