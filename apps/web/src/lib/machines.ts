import type { LiveServerMessage, Machine, MachineHerdrView } from '@hunthub/shared/machines';

export function countAgents(herdr: MachineHerdrView): number {
	return herdr.sessions.reduce((n, s) => n + s.workspaces.reduce((m, w) => m + w.agents.length, 0), 0);
}

/** Largest disk usage in percent, or null without stats. */
export function diskPercent(m: Machine): number | null {
	const disks = m.stats?.disks ?? [];
	if (disks.length === 0) return null;
	return Math.max(...disks.map((d) => (d.total ? (d.used / d.total) * 100 : 0)));
}

export function memPercent(m: Machine): number | null {
	return m.stats && m.stats.mem.total ? (m.stats.mem.used / m.stats.mem.total) * 100 : null;
}

/** Applies a live update to a machine; returns null when it was removed. */
export function applyLive(m: Machine, message: LiveServerMessage): Machine | null {
	switch (message.type) {
		case 'machine.updated':
			return message.machine.id === m.id ? message.machine : m;
		case 'machine.removed':
			return message.machineId === m.id ? null : m;
		case 'machine.connection':
			if (message.machineId !== m.id) return m;
			return {
				...m,
				connection: message.connection,
				lastSeenAt: message.lastSeenAt,
				stats: message.connection === 'offline' ? null : m.stats
			};
		case 'machine.herdr':
			if (message.machineId !== m.id) return m;
			return { ...m, agents: message.herdr.supported ? countAgents(message.herdr) : null };
		case 'machine.stats':
			return message.machineId === m.id ? { ...m, stats: message.sample, connection: 'online' } : m;
		default:
			return m;
	}
}
