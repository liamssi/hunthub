import { describe, expect, test } from 'bun:test';
import { policyAllows, policyNeeded, stricterPolicy, TERMINAL_CONTROL } from '@hunthub/shared/console';

describe('console access', () => {
	test('each method needs its level, and levels include the ones before', () => {
		expect(policyNeeded('session.snapshot')).toBe('read');
		expect(policyNeeded('hunthub.fs.read')).toBe('read');
		expect(policyNeeded('pane.split')).toBe('manage');
		expect(policyNeeded('hunthub.session.stop')).toBe('manage');
		expect(policyNeeded('agent.prompt')).toBe('agents');
		expect(policyNeeded('hunthub.agent.launch')).toBe('agents');
		expect(policyNeeded('integration.install')).toBe('agents');
		expect(policyNeeded(TERMINAL_CONTROL)).toBe('full');
		expect(policyAllows('agents', 'pane.split')).toBe(true);
		expect(policyAllows('manage', 'agent.start')).toBe(false);
		expect(policyAllows('read', 'integration.list')).toBe(true);
	});

	test('unknown methods need full access; the stricter of two policies wins', () => {
		expect(policyNeeded('server.live_handoff')).toBe('full');
		expect(stricterPolicy('full', 'read')).toBe('read');
		expect(stricterPolicy('manage', 'agents')).toBe('manage');
	});
});
