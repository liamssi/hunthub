import { describe, expect, test } from 'bun:test';
import { parseLaunch } from './agents';

const runId = '0e18802e-9483-446c-8c0b-0703bce4deb9';

describe('agent launch requests', () => {
	test('a new tab needs a space, and the name defaults to kind plus run', () => {
		expect(parseLaunch({ run_id: runId, kind: 'claude', workspace_id: 'w1' })).toMatchObject({ placement: 'tab', name: 'claude-0e18', workspaceId: 'w1', args: [] });
		expect(() => parseLaunch({ run_id: runId, kind: 'claude' })).toThrow('space');
	});

	test('splitting needs a pane', () => {
		expect(parseLaunch({ run_id: runId, kind: 'codex', placement: 'split', pane_id: 'w1:p2', direction: 'down' })).toMatchObject({ paneId: 'w1:p2', direction: 'down' });
		expect(() => parseLaunch({ run_id: runId, kind: 'codex', placement: 'split' })).toThrow('pane');
	});

	test('refuses unknown kinds, bad names, relative folders and control characters', () => {
		expect(() => parseLaunch({ run_id: runId, kind: 'bash', workspace_id: 'w1' })).toThrow('kind');
		expect(() => parseLaunch({ run_id: runId, kind: 'claude', name: 'Bad Name', workspace_id: 'w1' })).toThrow('lowercase');
		expect(() => parseLaunch({ run_id: runId, kind: 'claude', cwd: 'relative/dir', workspace_id: 'w1' })).toThrow('absolute');
		expect(() => parseLaunch({ run_id: runId, kind: 'claude', args: ['--x\n'], workspace_id: 'w1' })).toThrow('arguments');
		expect(() => parseLaunch({ run_id: 'nope', kind: 'claude', workspace_id: 'w1' })).toThrow('run id');
	});
});
