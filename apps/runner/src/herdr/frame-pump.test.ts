import { describe, expect, test } from 'bun:test';
import type { CellData, FrameData } from '../vendor/roamgate/thin-client';
import { encodeChanges, FramePump, render } from './frame-pump';

const cell = (symbol: string): CellData => ({ symbol, fg: 0, bg: 0, modifier: 0, skip: false, hyperlink: null });

/** A frame from lines of text (padded to the width). */
function frame(lines: string[], width = 10, cursor = { x: 0, y: 0 }): FrameData {
	const cells: CellData[] = [];
	for (const line of lines) for (let x = 0; x < width; x++) cells.push(cell(line[x] ?? ' '));
	return { cells, width, height: lines.length, cursor: { ...cursor, visible: true, shape: 1 }, hyperlinks: [] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (b: Buffer) => b.toString('utf8');

describe('frame changes', () => {
	test('only changed rows are sent; nothing when nothing changed; all after a size change', () => {
		const a = render(frame(['one', 'two', 'three']));
		const b = render(frame(['one', 'TWO', 'three']));
		expect(encodeChanges(a, a)).toBeNull();
		const change = encodeChanges(a, b)!;
		expect(change.full).toBe(false);
		expect(change.bytes).toContain('TWO');
		expect(change.bytes).not.toContain('one');
		expect(change.bytes).not.toContain('three');
		expect(encodeChanges(a, render(frame(['one', 'two', 'three'], 12)))!.full).toBe(true);
		expect(encodeChanges(null, a)!.full).toBe(true);
	});

	test('a moved cursor alone is still sent', () => {
		const a = render(frame(['one'], 10, { x: 0, y: 0 }));
		const b = render(frame(['one'], 10, { x: 3, y: 0 }));
		expect(encodeChanges(a, b)?.bytes).toContain('\x1b[1;4H');
	});
});

describe('frame pump', () => {
	test('a busy pane sends at most fps frames, always the newest', async () => {
		const sent: string[] = [];
		const pump = new FramePump((b) => sent.push(text(b)), { fps: 10 });
		for (let i = 0; i < 20; i++) {
			pump.push(frame([`frame ${i}`]));
			await sleep(5);
		}
		await sleep(150);
		pump.close();
		// The first goes at once, then one per 100 ms with the newest content.
		expect(sent.length).toBeLessThanOrEqual(3);
		expect(sent.at(-1)).toContain('frame 19');
	});

	test('nothing while paused; the first frame after repaints everything', async () => {
		const sent: { bytes: string; full: boolean }[] = [];
		const pump = new FramePump((b, full) => sent.push({ bytes: text(b), full }), { fps: 60 });
		pump.push(frame(['hello']));
		await sleep(30);
		pump.setPaused('hidden', true);
		pump.push(frame(['hidden!']));
		await sleep(40);
		expect(sent.map((s) => s.bytes).join()).not.toContain('hidden!');
		pump.setPaused('flow', true);
		pump.setPaused('hidden', false);
		await sleep(40);
		expect(sent).toHaveLength(1); // still held for the other reason
		pump.setPaused('flow', false);
		await sleep(40);
		pump.close();
		expect(sent.at(-1)).toMatchObject({ full: true });
		expect(sent.at(-1)!.bytes).toContain('hidden!');
	});

	test('while typing, frames skip the rate limit; a backed-up link holds the others', async () => {
		let congested = true;
		const sent: string[] = [];
		const pump = new FramePump((b) => sent.push(text(b)), { fps: 1, congested: () => congested });
		pump.push(frame(['held']));
		await sleep(80);
		expect(sent).toHaveLength(0); // the link is backed up
		pump.boost();
		pump.push(frame(['typed']));
		await sleep(30);
		expect(sent.at(-1)).toContain('typed');
		pump.push(frame(['echo']));
		await sleep(30);
		expect(sent.at(-1)).toContain('echo'); // no 1 s wait while boosted
		congested = false;
		pump.close();
	});
});
