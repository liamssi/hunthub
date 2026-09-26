import { expect, test } from 'bun:test';
import type { AgentStatus, SessionView } from '@hunthub/shared/machines';
import { detectAttention } from './attention';

const view = (statuses: Record<string, AgentStatus>): SessionView => ({
	name: 's',
	state: 'running',
	workspaces: [
		{
			id: 'w1',
			label: 'recon',
			worktree: null,
			status: 'idle',
			paneCount: 1,
			tabs: [],
			agents: Object.entries(statuses).map(([paneId, status]) => ({
				machineId: 'm',
				machineName: 'laptop',
				session: 's',
				workspaceId: 'w1',
				workspaceLabel: 'recon',
				paneId,
				name: `agent-${paneId}`,
				kind: 'claude',
				herdrName: null,
				status,
				cwd: null,
				origin: 'external',
				run: null
			}))
		}
	]
});

test('an agent that starts asking or finishes working raises an event; flapping does not', () => {
	const t = 1_000_000;
	const events = detectAttention('m', 'laptop', view({ p1: 'working', p2: 'working', p3: 'idle' }), view({ p1: 'blocked', p2: 'done', p3: 'idle', p4: 'blocked' }), t);
	// p4 is new (never seen before), so it raises nothing.
	expect(events.map((e) => [e.paneId, e.kind])).toEqual([
		['p1', 'needs_you'],
		['p2', 'finished']
	]);
	// Back to working and blocked again within a minute: no second event.
	expect(detectAttention('m', 'laptop', view({ p1: 'working' }), view({ p1: 'blocked' }), t + 10_000)).toEqual([]);
	expect(detectAttention('m', 'laptop', view({ p1: 'working' }), view({ p1: 'blocked' }), t + 70_000)).toHaveLength(1);
});
