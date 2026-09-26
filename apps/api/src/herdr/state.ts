// Latest Herdr state per connected machine, as reported by runners. In memory
// only: Herdr on each machine is the source of truth, and a reconnecting
// runner reports everything again.
import type { AgentView, MachineHerdrView, SessionView } from '@hunthub/shared/machines';
import type { HerdrSessionReport } from '@hunthub/shared/runner-protocol';
import { publish } from '../live/hub';
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
	m.sessions.set(report.name, sessionView({ id: machineId, name: m.name }, report));
	broadcast(machineId);
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
		sessions: [...m.sessions.values()].sort((a, b) => (a.name === 'default' ? -1 : b.name === 'default' ? 1 : a.name.localeCompare(b.name)))
	};
}

function agentsOf(m: MachineState): AgentView[] {
	return [...m.sessions.values()].flatMap((s) => s.workspaces.flatMap((w) => w.agents));
}

export function agentCount(machineId: string): number | null {
	const m = machines.get(machineId);
	return m?.supported ? agentsOf(m).length : null;
}

export function allAgents(): AgentView[] {
	return sortAgents([...machines.values()].flatMap(agentsOf));
}

function broadcast(machineId: string) {
	publish([`machine:${machineId}`, 'agents'], { type: 'machine.herdr', machineId, herdr: machineHerdr(machineId) });
}
