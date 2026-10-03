import { expect, test } from 'bun:test';
import { HISTORY_LINES, PaneHistory } from './history';

// What Herdr hands out on the next pane.read.
let screen: string[] = [];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`);

test('the tail is numbered, so a browser can add it to the lines it has', async () => {
	const h = new PaneHistory(async () => screen.join('\n'));
	screen = range(1, 1000);
	const all = await h.get('s', 'w1:p1');
	expect(all).toMatchObject({ from: 0, total: 1000 });
	expect(all.lines).toHaveLength(1000);

	screen = range(501, 1500);
	const tail = await h.get('s', 'w1:p1', 200);
	expect(tail).toMatchObject({ from: 1300, total: 1500 });
	expect(tail.lines[0]).toBe('line 1301');

	// Lines dropped off the front keep their numbers.
	for (let end = 2000; end <= HISTORY_LINES + 2000; end += 1000) {
		screen = range(end - 999, end);
		await h.get('s', 'w1:p1', 1);
	}
	const last = await h.get('s', 'w1:p1', 10);
	expect(last).toMatchObject({ from: HISTORY_LINES + 1990, total: HISTORY_LINES + 2000 });
	expect(last.lines[0]).toBe(`line ${HISTORY_LINES + 1991}`);
	const everything = await h.get('s', 'w1:p1');
	expect(everything).toMatchObject({ from: 2000, total: HISTORY_LINES + 2000 });
	expect(everything.lines[0]).toBe('line 2001');
	h.stop();
});
