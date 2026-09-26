import { describe, expect, test } from 'bun:test';
import { GAP_MARKER, mergeLines } from './history';

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

	test('a cleared pane with little output replaces the transcript', () => {
		expect(mergeLines(range(1, 50), ['$ '])).toEqual(['$ ']);
	});
});
