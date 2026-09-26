// Agents HuntHub started or adopted (the agent_run table), matched to the live
// agents runners report by their Herdr name. Live runs are cached in memory so
// every state update can be annotated without a query.
import { eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { agentRun, user } from '../db/schema';

export type Run = {
	id: string;
	machineId: string;
	session: string;
	name: string;
	kind: string | null;
	adopted: boolean;
	by: string | null;
	at: Date;
};

/** A run whose agent hasn't shown up (or is gone) this long after it began is over. */
const GRACE_MS = 3 * 60_000;

const live = new Map<string, Run>();
const key = (machineId: string, session: string, name: string) => `${machineId}\t${session}\t${name}`;

export async function loadRuns() {
	const rows = await db
		.select({ run: agentRun, by: user.name })
		.from(agentRun)
		.leftJoin(user, eq(user.id, agentRun.userId))
		.where(isNull(agentRun.endedAt));
	live.clear();
	for (const { run, by } of rows) {
		live.set(key(run.machineId, run.session, run.name), {
			id: run.id,
			machineId: run.machineId,
			session: run.session,
			name: run.name,
			kind: run.kind,
			adopted: run.origin === 'adopted',
			by,
			at: run.createdAt
		});
	}
}

export function runFor(machineId: string, session: string, name: string | null): Run | null {
	return name ? (live.get(key(machineId, session, name)) ?? null) : null;
}

export async function recordRun(run: Omit<Run, 'at' | 'by'> & { userId: string; userName: string }) {
	// Herdr names are unique among live agents, so a live run with this name is stale.
	const stale = live.get(key(run.machineId, run.session, run.name));
	if (stale) await endRun(stale);
	await db.insert(agentRun).values({
		id: run.id,
		machineId: run.machineId,
		session: run.session,
		name: run.name,
		kind: run.kind,
		origin: run.adopted ? 'adopted' : 'started',
		userId: run.userId
	});
	live.set(key(run.machineId, run.session, run.name), { ...run, by: run.userName, at: new Date() });
}

export async function endRun(run: Run) {
	live.delete(key(run.machineId, run.session, run.name));
	await db.update(agentRun).set({ endedAt: new Date() }).where(eq(agentRun.id, run.id));
}

/**
 * Ends the runs of a running session whose agent is gone (past the grace a
 * starting agent gets). Returns whether any ended.
 */
export function sweep(machineId: string, session: string, names: ReadonlySet<string>): boolean {
	let ended = false;
	for (const run of [...live.values()]) {
		if (run.machineId !== machineId || run.session !== session || names.has(run.name)) continue;
		if (Date.now() - run.at.getTime() < GRACE_MS) continue;
		ended = true;
		void endRun(run).catch((e) => console.error('agents: failed to end run', e));
	}
	return ended;
}
