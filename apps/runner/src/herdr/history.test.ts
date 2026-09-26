import { describe, expect, test } from 'bun:test';
import { CLEARED_MARKER, GAP_MARKER, mergeLines } from './history';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`);

describe('pane history transcript', () => {
	test('appends only what is new, replacing the live last line', () => {
		const kept = [...range(1, 5), '$ ech'];
		const latest = [...range(3, 5), '$ echo hi', 'hi', '$ '];
		expect(mergeLines(kept, latest)).toEqual([...range(1, 5), '$ echo hi', 'hi', '$ ']);
	});

	test('grows past what Herdr hands out in one read', () => {
		let kept: string[] = [];
		for (let end = 1000; end <= 5000; end += 800) kept = mergeLines(kept, [...range(end - 999, end), '$ ']);
		expect(kept.length).toBe(5001);
		expect(kept[0]).toBe('line 1');
		expect(kept.at(-2)).toBe('line 5000');
	});

	test('marks a gap when more arrived between reads than Herdr hands out', () => {
		const kept = [...range(1, 1000), '$ '];
		const latest = [...range(3001, 4000)];
		const merged = mergeLines(kept, latest);
		expect(merged).toContain(GAP_MARKER);
		expect(merged.at(-1)).toBe('line 4000');
		expect(merged.indexOf(GAP_MARKER)).toBe(1000);
	});

	test('keeps at most the limit, dropping the oldest', () => {
		expect(mergeLines(range(1, 90), range(80, 120), 50)).toEqual(range(71, 120));
	});

	test('a cleared pane keeps what came before, marking the clear', () => {
		expect(mergeLines([...range(1, 50), '$ clear'], ['', '$ '])).toEqual([...range(1, 50), CLEARED_MARKER, '', '$ ']);
	});

	test('each clear keeps the screen before it', () => {
		let kept = [...range(1, 20), '$ '];
		kept = mergeLines(kept, ['', 'screen a', '> ']);
		kept = mergeLines(kept, ['', 'screen b', '> ']);
		expect(kept.filter((l) => l === CLEARED_MARKER).length).toBe(2);
		expect(kept.slice(0, 20)).toEqual(range(1, 20));
		expect(kept.at(-2)).toBe('screen b');
	});

	test('an agent clearing and reprinting its conversation is kept once', () => {
		const conversation = ['╭ Claude ╮', '> hello', '● hi there', ...range(1, 40)];
		let kept = [...range(900, 910), '$ claude', ...conversation, '> '];
		// Resized: the agent clears the scrollback and prints the conversation again.
		kept = mergeLines(kept, [...conversation, '● more', '> ']);
		kept = mergeLines(kept, [...conversation, '● more', '● and more', '> ']);
		expect(kept).toEqual([...range(900, 910), '$ claude', ...conversation, '● more', '● and more', '> ']);
	});

	test('an agent redrawing the bottom of a long pane adds nothing twice', () => {
		// Herdr hands out its last 1000 lines; the last few (spinner, input box) keep changing.
		const screen = (tick: number) => [`✻ Thinking… (${tick}s)`, '╭──────╮', '│ >    │', '╰──────╯'];
		let kept = [...range(1, 996), ...screen(1)];
		for (let tick = 2; tick <= 20; tick++) kept = mergeLines(kept, [...range(1 + tick, 996), ...range(997, 996 + tick), ...screen(tick)].slice(-1000));
		expect(kept).toEqual([...range(1, 1016), ...screen(20)]);
		expect(kept).not.toContain(GAP_MARKER);
	});

	test('a program redrawing its screen (Herdr still has everything) replaces the tail', () => {
		const kept = [...range(1, 30), '╭ box ╮', '│ old │', '╰─────╯'];
		const latest = [...range(1, 30), '╭ box ╮', '│ new │', '╰─────╯'];
		expect(mergeLines(kept, latest)).toEqual(latest);
	});
});
