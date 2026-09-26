// Latest Herdr state per connected machine, as reported by runners. In memory
// only: Herdr on each machine is the source of truth, and a reconnecting
// runner reports everything again.
import type { AgentView, MachineHerdrView, SessionView } from '@hunthub/shared/machines';
import type { HerdrSessionReport } from '@hunthub/shared/runner-protocol';
import { publish } from '../live/hub';
import { runFor, sweep } from './agent-runs';
import { sessionView, sortAgents } from './view';

type MachineState = {
	name: string;
	/** Whether this runner reports Herdr at all (capability "herdr"). */
	supported: boolean;
	sessions: Map<string, SessionView>;
};

const machines = new Map<string, MachineState>();

export function trackMachine(machineId: string, name: string, supported: boolean) {
	machines.set(machineId, { name, supported, sessions: new Map() });
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
	m.sessions.set(report.name, view);
	// Agents of a stopped session come back with their names when it starts again.
	if (view.state === 'running') {
		const names = new Set(view.workspaces.flatMap((w) => w.agents.flatMap((a) => (a.herdrName ? [a.herdrName] : []))));
		sweep(machineId, report.name, names);
	}
	broadcast(machineId);
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
	if (m?.sessions.delete(name)) broadcast(machineId);
}

export function machineHerdr(machineId: string): MachineHerdrView {
	const m = machines.get(machineId);
	if (!m) return { supported: false, sessions: [] };
	return {
		supported: m.supported,
		sessions: [...m.sessions.values()].map((s) => withRuns(machineId, s)).sort((a, b) => (a.name === 'default' ? -1 : b.name === 'default' ? 1 : a.name.localeCompare(b.name)))
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

function broadcast(machineId: string) {
	publish([`machine:${machineId}`, 'agents'], { type: 'machine.herdr', machineId, herdr: machineHerdr(machineId) });
}
