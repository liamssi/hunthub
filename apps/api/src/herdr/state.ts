// Latest Herdr state per connected machine, as reported by runners. In memory
// only: Herdr on each machine is the source of truth, and a reconnecting
// runner reports everything again.
import { compareSessions, type AgentView, type LiveTopic, type MachineHerdrView, type SessionView } from '@hunthub/shared/machines';
import type { HerdrSessionReport } from '@hunthub/shared/runner-protocol';
import { publish } from '../live/hub';
import { runFor, sweep } from './agent-runs';
import { detectAttention, raiseAttention } from './attention';
import { sessionView, sortAgents } from './view';

type MachineState = {
	name: string;
	/** Whether this runner reports Herdr at all (capability "herdr"). */
	supported: boolean;
	sessions: Map<string, SessionView>;
	/** Each session as last sent to browsers (JSON), so unchanged reports send nothing. */
	sent: Map<string, string>;
};

const machines = new Map<string, MachineState>();

export function trackMachine(machineId: string, name: string, supported: boolean) {
	machines.set(machineId, { name, supported, sessions: new Map(), sent: new Map() });
	broadcast(machineId);
}

export function forgetMachine(machineId: string) {
	if (!machines.delete(machineId)) return;
	publish(['agents'], { type: 'machine.herdr', machineId, herdr: { supported: false, sessions: [] } });
}

export function renameMachine(machineId: string, name: string) {
	const m = machines.get(machineId);
	if (!m) return;
	m.name = name;
	for (const [key, s] of m.sessions) {
		m.sessions.set(key, {
			...s,
			workspaces: s.workspaces.map((w) => ({ ...w, agents: w.agents.map((a) => ({ ...a, machineName: name })) }))
		});
	}
	broadcast(machineId);
}

export function applySession(machineId: string, report: HerdrSessionReport) {
	const m = machines.get(machineId);
	if (!m) return;
	const view = sessionView({ id: machineId, name: m.name }, report);
	const before = m.sessions.get(report.name);
	m.sessions.set(report.name, view);
	if (before) {
		void raiseAttention(detectAttention(machineId, m.name, before, view)).catch((e) => console.error('attention: failed to record', e));
	}
	// Agents of a stopped session come back with their names when it starts again.
	if (view.state === 'running') {
		const names = new Set(view.workspaces.flatMap((w) => w.agents.flatMap((a) => (a.herdrName ? [a.herdrName] : []))));
		sweep(machineId, report.name, names);
	}
	broadcastSession(machineId, report.name);
}

/** Marks the agents HuntHub started or adopted (runs can change without a report). */
function withRuns(machineId: string, s: SessionView): SessionView {
	return {
		...s,
		workspaces: s.workspaces.map((w) => ({
			...w,
			agents: w.agents.map((a) => {
				const run = runFor(machineId, s.name, a.herdrName);
				return run ? { ...a, origin: 'hunthub' as const, run: { id: run.id, adopted: run.adopted, by: run.by, at: run.at.toISOString() } } : a;
			})
		}))
	};
}

/** Sends a machine's Herdr view again (after its runs changed). */
export function refreshMachine(machineId: string) {
	if (machines.has(machineId)) broadcast(machineId);
}

export function removeSession(machineId: string, name: string) {
	const m = machines.get(machineId);
	if (!m?.sessions.delete(name)) return;
	m.sent.delete(name);
	publish(topicsFor(machineId), { type: 'machine.herdr.session.removed', machineId, session: name });
}

export function machineHerdr(machineId: string): MachineHerdrView {
	const m = machines.get(machineId);
	if (!m) return { supported: false, sessions: [] };
	return {
		supported: m.supported,
		sessions: [...m.sessions.values()].map((s) => withRuns(machineId, s)).sort(compareSessions)
	};
}

/** Every connected machine's Herdr view, by machine id. */
export function allHerdr(): Record<string, MachineHerdrView> {
	return Object.fromEntries([...machines.keys()].map((id) => [id, machineHerdr(id)]));
}

function agentsOf(machineId: string): AgentView[] {
	return machineHerdr(machineId).sessions.flatMap((s) => s.workspaces.flatMap((w) => w.agents));
}

export function agentCount(machineId: string): number | null {
	return machines.get(machineId)?.supported ? agentsOf(machineId).length : null;
}

export function allAgents(): AgentView[] {
	return sortAgents([...machines.keys()].flatMap(agentsOf));
}

/** The agent in a pane of a session, as HuntHub sees it now. */
export function findAgent(machineId: string, session: string, paneId: string): AgentView | null {
	const s = machineHerdr(machineId).sessions.find((x) => x.name === session);
	return s?.workspaces.flatMap((w) => w.agents).find((a) => a.paneId === paneId) ?? null;
}

const topicsFor = (machineId: string): LiveTopic[] => [`machine:${machineId}`, 'agents'];

/** Sends a machine's whole Herdr view (after it connected, was renamed or its runs changed). */
function broadcast(machineId: string) {
	const herdr = machineHerdr(machineId);
	const m = machines.get(machineId);
	if (m) m.sent = new Map(herdr.sessions.map((s) => [s.name, JSON.stringify(s)]));
	publish(topicsFor(machineId), { type: 'machine.herdr', machineId, herdr });
}

/** Sends one session after a report, unless browsers already have exactly that. */
function broadcastSession(machineId: string, name: string) {
	const m = machines.get(machineId);
	const s = m?.sessions.get(name);
	if (!m || !s) return;
	const session = withRuns(machineId, s);
	const json = JSON.stringify(session);
	if (m.sent.get(name) === json) return;
	m.sent.set(name, json);
	publish(topicsFor(machineId), { type: 'machine.herdr.session', machineId, session });
}
