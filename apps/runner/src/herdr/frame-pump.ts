// Turns a native terminal's frames (whole cell grids from Herdr, as fast as the
// pane changes) into what's worth sending:
// - only the rows that changed since the last frame sent (a full repaint after
//   a size change or a pause), nothing at all when nothing visible changed;
// - at most `fps` frames a second, always the newest (frames in between are
//   skipped, so a busy pane can't build up a backlog on a slow link);
// - held while the terminal is hidden or the browser can't keep up;
// - sent at once while someone is typing in it (input and its echo come first).
import { cursorToAnsi, rowToAnsi } from '../vendor/roamgate/frame-to-ansi';
import type { FrameData } from '../vendor/roamgate/thin-client';

const RESET = '\x1b[0m';
/** Synchronized output: the browser paints a frame's rows at once, without tearing. */
const SYNC_START = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';
/** Frames sent straight away after input in the terminal, for this long. */
const BOOST_MS = 600;
/** While the link to the hub is backed up, check again this often. */
const CONGESTED_RETRY_MS = 50;
export const DEFAULT_FPS = 30;

export type Rendered = { width: number; height: number; rows: string[]; cursor: string };

export function render(frame: FrameData): Rendered {
	const rows: string[] = [];
	for (let y = 0; y < frame.height; y++) rows.push(rowToAnsi(frame, y, frame.width));
	return { width: frame.width, height: frame.height, rows, cursor: cursorToAnsi(frame, frame.width, frame.height) };
}

/** A whole screen: cleared, then every row. */
export function encodeFull(r: Rendered): string {
	let out = `${SYNC_START}${RESET}\x1b[H\x1b[2J\x1b[?7l`;
	r.rows.forEach((row, y) => {
		if (y > 0) out += `\x1b[${y + 1};1H`;
		out += row;
	});
	return `${out}\x1b[?7h${r.cursor}${SYNC_END}`;
}

/**
 * What to send to go from `prev` to `next`: changed rows only (each cleared and
 * redrawn), the whole screen when there's nothing to build on, or null when
 * nothing visible changed.
 */
export function encodeChanges(prev: Rendered | null, next: Rendered): { bytes: string; full: boolean } | null {
	if (!prev || prev.width !== next.width || prev.height !== next.height) return { bytes: encodeFull(next), full: true };
	let out = '';
	next.rows.forEach((row, y) => {
		if (row !== prev.rows[y]) out += `\x1b[${y + 1};1H${RESET}\x1b[2K${row}`;
	});
	if (!out && next.cursor === prev.cursor) return null;
	return { bytes: `${SYNC_START}\x1b[?25l\x1b[?7l${out}\x1b[?7h${RESET}${next.cursor}${SYNC_END}`, full: false };
}

export type PumpOptions = {
	fps?: number;
	/** Whether the link to the hub is backed up (frames wait, except while typing). */
	congested?: () => boolean;
	now?: () => number;
};

export class FramePump {
	private latest: FrameData | null = null;
	/** Bytes that must go out before the next frame (e.g. mouse mode changes). */
	private prefix = '';
	private sent: Rendered | null = null;
	private lastSentAt = -Infinity;
	private boostUntil = 0;
	private fps: number;
	private readonly paused = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private closed = false;
	private readonly congested: () => boolean;
	private readonly now: () => number;

	constructor(
		private readonly emit: (bytes: Buffer, full: boolean, width: number, height: number) => void,
		opts: PumpOptions = {}
	) {
		this.fps = opts.fps ?? DEFAULT_FPS;
		this.congested = opts.congested ?? (() => false);
		this.now = opts.now ?? Date.now;
	}

	/** The pane's newest frame (replaces one not sent yet). */
	push(frame: FrameData, prefix = '') {
		if (this.closed) return;
		this.latest = frame;
		this.prefix += prefix;
		this.schedule();
	}

	/** Holds frames for a reason (hidden, flow) until every reason is lifted. */
	setPaused(reason: string, paused: boolean) {
		const was = this.paused.size > 0;
		if (paused) this.paused.add(reason);
		else this.paused.delete(reason);
		if (this.paused.size > 0) {
			this.clearTimer();
			return;
		}
		// The browser kept an older picture while paused: the next frame repaints all of it.
		if (was) this.sent = null;
		this.schedule();
	}

	setFps(fps: number) {
		this.fps = Math.min(60, Math.max(1, Math.round(fps)));
	}

	/** Someone typed in this terminal: send its frames at once for a moment. */
	boost() {
		this.boostUntil = this.now() + BOOST_MS;
		if (this.timer) {
			this.clearTimer();
			this.schedule();
		}
	}

	close() {
		this.closed = true;
		this.clearTimer();
	}

	private get boosted() {
		return this.now() < this.boostUntil;
	}

	private clearTimer() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	private schedule() {
		if (this.closed || this.paused.size || this.timer || (!this.latest && !this.prefix)) return;
		const wait = this.boosted ? 0 : Math.max(0, this.lastSentAt + 1000 / this.fps - this.now());
		this.timer = setTimeout(() => this.flush(), wait);
	}

	private flush() {
		this.timer = null;
		if (this.closed || this.paused.size) return;
		if (!this.boosted && this.congested()) {
			this.timer = setTimeout(() => this.flush(), CONGESTED_RETRY_MS);
			return;
		}
		const frame = this.latest;
		this.latest = null;
		const next = frame ? render(frame) : null;
		const change = next ? encodeChanges(this.sent, next) : null;
		if (!change && !this.prefix) return;
		const bytes = this.prefix + (change?.bytes ?? '');
		this.prefix = '';
		const shape = next ?? this.sent;
		this.emit(Buffer.from(bytes, 'utf8'), change?.full ?? false, shape?.width ?? 0, shape?.height ?? 0);
		if (next) this.sent = next;
		this.lastSentAt = this.now();
		// A frame that arrived meanwhile goes out on the next tick.
		this.schedule();
	}
}
