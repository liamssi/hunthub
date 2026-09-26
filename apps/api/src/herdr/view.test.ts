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
		{
			id: 'w1:t1',
			label: '1',
			panes: [{ id: 'w1:p1', cwd: '/tmp', agent: { name: 'test-bot', status: 'working' } }],
			layout: { zoomed: false, focusedPaneId: 'w1:p1', panes: [{ paneId: 'w1:p1', x: 0, y: 0, width: 1, height: 1 }], splits: [] }
		}
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

test('tab layouts become fractions of the tab area; a broken layout is ignored', () => {
	const split = {
		...snapshot,
		layouts: [
			{
				tab_id: 'w1:t1',
				area: { x: 0, y: 1, width: 100, height: 40 },
				panes: [
					{ pane_id: 'w1:p1', rect: { x: 0, y: 1, width: 50, height: 40 } },
					{ pane_id: 'w1:p2', rect: { x: 50, y: 21, width: 50, height: 20 } }
				],
				splits: [
					{ id: 'split_0_root', direction: 'right', ratio: 0.5, rect: { x: 0, y: 1, width: 100, height: 40 } },
					{ id: 'split_1_1', direction: 'down', ratio: 0.5, rect: { x: 50, y: 1, width: 50, height: 40 } },
					{ id: 'weird', direction: 'down', ratio: 0.5, rect: { x: 0, y: 1, width: 1, height: 1 } }
				]
			}
		]
	};
	expect(sessionView(machine, { name: 't', state: 'running', snapshot: split }).workspaces[0]!.tabs[0]!.layout).toEqual({
		zoomed: false,
		focusedPaneId: null,
		panes: [
			{ paneId: 'w1:p1', x: 0, y: 0, width: 0.5, height: 1 },
			{ paneId: 'w1:p2', x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
		],
		splits: [
			{ path: [], direction: 'right', ratio: 0.5, x: 0, y: 0, width: 1, height: 1 },
			{ path: [true], direction: 'down', ratio: 0.5, x: 0.5, y: 0, width: 0.5, height: 1 }
		]
	});
	const broken = sessionView(machine, { name: 't', state: 'running', snapshot: { ...snapshot, layouts: 'nope' } });
	expect(broken.workspaces[0]!.tabs[0]).toMatchObject({ id: 'w1:t1', layout: null });
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
