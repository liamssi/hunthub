// Every machine and every Herdr session, kept live for the whole app: the
// explorer, the sidebar's pins and the multi-session workspace all read it.
import type { AgentView, Machine, MachineHerdrView, PaneView, SessionView, TabView, WorkspaceView } from '@hunthub/shared/machines';
import { subscribeLive } from './live';
import { applyLive } from './machines';

export const fleet = $state({
	machines: [] as Machine[],
	/** Herdr state by machine id (only connected machines report it). */
	herdr: {} as Record<string, MachineHerdrView>,
	loaded: false,
	error: null as string | null
});

let users = 0;
let stop: (() => void) | null = null;

async function load() {
	try {
		const [m, h] = await Promise.all([fetch('/api/machines'), fetch('/api/herdr')]);
		if (!m.ok || !h.ok) throw new Error(`HuntHub answered ${m.ok ? h.status : m.status}`);
		fleet.machines = (await m.json()).machines;
		fleet.herdr = (await h.json()).machines;
		fleet.error = null;
	} catch (err) {
		fleet.error = err instanceof Error ? err.message : 'Could not load machines.';
	} finally {
		fleet.loaded = true;
	}
}

/** Starts the live store while at least one component uses it; returns a release function. */
export function useFleet(): () => void {
	users++;
	if (users === 1) {
		void load();
		const offMachines = subscribeLive('machines', (message) => {
			if (message.type === 'machine.updated' && !fleet.machines.some((m) => m.id === message.machine.id)) {
				fleet.machines = [...fleet.machines, message.machine];
				return;
			}
			fleet.machines = fleet.machines.map((m) => applyLive(m, message)).filter((m): m is Machine => m !== null);
			if (message.type === 'machine.removed') delete fleet.herdr[message.machineId];
		});
		const offHerdr = subscribeLive('agents', (message) => {
			if (message.type === 'machine.herdr') fleet.herdr[message.machineId] = message.herdr;
		});
		stop = () => {
			offMachines();
			offHerdr();
		};
	}
	return () => {
		users--;
		if (users === 0) {
			stop?.();
			stop = null;
		}
	};
}

export const machineById = (id: string) => fleet.machines.find((m) => m.id === id);
export const sessionOf = (machineId: string, name: string): SessionView | undefined => fleet.herdr[machineId]?.sessions.find((s) => s.name === name);

/** Where a pane lives inside a session. */
export type PaneLocation = { space: WorkspaceView; tab: TabView; pane: PaneView };
export function findPane(session: SessionView | undefined, paneId: string): PaneLocation | undefined {
	for (const space of session?.workspaces ?? []) {
		for (const tab of space.tabs) {
			const pane = tab.panes.find((p) => p.id === paneId);
			if (pane) return { space, tab, pane };
		}
	}
	return undefined;
}

export const sessionAgents = (s: SessionView): AgentView[] => s.workspaces.flatMap((w) => w.agents);

/** Agents that need you (blocked) across a session. */
export const needsYouCount = (s: SessionView) => sessionAgents(s).filter((a) => a.status === 'blocked').length;

/** The workspace URL for a session, optionally jumping to a pane. */
export function workspaceHref(machineId: string, session: string, paneId?: string | null) {
	const q = new URLSearchParams({ open: `${machineId}:${session}` });
	if (paneId) q.set('pane', paneId);
	return `/workspace?${q}`;
}
