import { expect, test } from 'bun:test';
import type { AgentView } from '@hunthub/shared/machines';
import snapshot from './fixtures/snapshot-one-agent.json';
import { sessionView, sortAgents } from './view';

const machine = { id: 'm1', name: 'laptop' };

test('interprets a real Herdr snapshot', () => {
	const view = sessionView(machine, { name: 'test', state: 'running', snapshot });
	expect(view.workspaces).toHaveLength(1);
	const ws = view.workspaces[0]!;
	expect(ws).toMatchObject({ id: 'w1', label: 'demo-ws', status: 'working', paneCount: 1 });
	expect(ws.tabs).toEqual([
		{ id: 'w1:t1', label: '1', panes: [{ id: 'w1:p1', cwd: '/tmp', agent: { name: 'test-bot', status: 'working' } }] }
	]);
	expect(ws.agents).toEqual([
		{
			machineId: 'm1',
			machineName: 'laptop',
			session: 'test',
			workspaceId: 'w1',
			workspaceLabel: 'demo-ws',
			paneId: 'w1:p1',
			name: 'test-bot',
			status: 'working',
			cwd: '/tmp',
			origin: 'external'
		}
	]);
});

test('tolerates unknown fields, unknown statuses and bad snapshots', () => {
	const future = {
		...snapshot,
		new_field: true,
		agents: snapshot.agents.map((a) => ({ ...a, agent_status: 'thinking-hard', extra: 1 }))
	};
	expect(sessionView(machine, { name: 't', state: 'running', snapshot: future }).workspaces[0]!.agents[0]!.status).toBe('unknown');
	expect(sessionView(machine, { name: 't', state: 'running', snapshot: 'garbage' }).workspaces).toEqual([]);
	expect(sessionView(machine, { name: 't', state: 'stopped', snapshot: null })).toEqual({ name: 't', state: 'stopped', workspaces: [] });
});

test('agents needing attention come first', () => {
	const agent = (status: AgentView['status'], paneId: string): AgentView => ({
		machineId: 'm',
		machineName: 'm',
		session: 's',
		workspaceId: 'w',
		workspaceLabel: 'w',
		paneId,
		name: 'a',
		status,
		cwd: null,
		origin: 'external'
	});
	const sorted = sortAgents([agent('idle', '1'), agent('working', '2'), agent('blocked', '3'), agent('done', '4')]);
	expect(sorted.map((a) => a.status)).toEqual(['blocked', 'working', 'done', 'idle']);
});
