// A rolling transcript per pane, so HuntHub can show more history than
// Herdr's pane.read gives out (it returns at most the last 1000 lines) and
// show it instantly. Whenever a pane produces output (or history is asked
// for), its last 1000 lines are read and merged into what's kept. History
// only grows while HuntHub is watching the pane; older output that Herdr
// never handed out isn't available.
import { request, socketPathFor } from './client';

/** Lines kept per pane. */
export const HISTORY_LINES = 10_000;
/** Panes kept in memory (least recently used go first). */
const MAX_PANES = 64;
/** How much Herdr hands out per read. */
const READ_LINES = 1000;
/** After output, wait this long before reading (bursts of output coalesce). */
const ACTIVITY_DEBOUNCE_MS = 1500;
/** Marks where output may be missing (more arrived between reads than Herdr hands out). */
export const GAP_MARKER = '\x1b[2m⋯ earlier output was not captured ⋯\x1b[0m';
/** Marks where the pane's scrollback was cleared (e.g. \`clear\`, or an agent redrawing after a resize). */
export const CLEARED_MARKER = '\x1b[2m⋯ the screen was cleared ⋯\x1b[0m';

type Transcript = { lines: string[]; readAt: number };

/**
 * Merges Herdr's latest lines into a transcript. Herdr's lines are the truth for
 * everything they cover, including the bottom of the screen, which programs
 * (agents especially) keep redrawing; the transcript only adds what's older.
 * The join is found through Herdr's oldest lines, which no longer change: where
 * they appear in the transcript, it continues with Herdr's lines from there.
 */
export function mergeLines(kept: string[], latest: string[], max = HISTORY_LINES): string[] {
	if (!kept.length) return latest.slice(-max);
	if (!latest.length) return kept;
	let merged: string[];
	const from = kept[0] === latest[0] ? 0 : lastStart(kept, latest);
	if (from >= 0) merged = [...kept.slice(0, from), ...latest];
	else {
		// Nothing in common. The kept lines' last one was still changing (a prompt being typed).
		const earlier = withoutMarkerAtEnd(kept.slice(0, -1));
		// Herdr has less than it hands out, so its scrollback was cleared (\`clear\`, or an agent
		// reprinting on resize); or it has more, and more arrived between reads than fits.
		merged = [...earlier, latest.length < READ_LINES ? CLEARED_MARKER : GAP_MARKER, ...latest];
	}
	return merged.length > max ? merged.slice(-max) : merged;
}

/** How many of Herdr's oldest lines identify where they join the transcript. */
const ANCHOR_LINES = 3;

/**
 * Where Herdr's oldest lines appear in the kept lines (the last place, so a
 * repeated passage duplicates rather than loses output); -1 when they don't.
 */
function lastStart(kept: string[], latest: string[]): number {
	const n = Math.min(ANCHOR_LINES, latest.length);
	// Blank lines alone match anywhere.
	if (!latest.slice(0, n).some((l) => l.trim())) return -1;
	for (let k = kept.length - n; k >= 0; k--) {
		let same = true;
		for (let i = 0; i < n && same; i++) same = kept[k + i] === latest[i];
		if (same) return k;
	}
	return -1;
}

/** Repeated clears leave one marker, not a stack of them. */
const withoutMarkerAtEnd = (lines: string[]) => {
	let end = lines.length;
	while (end > 0 && (lines[end - 1] === CLEARED_MARKER || lines[end - 1].trim() === '')) end--;
	return lines.slice(0, end);
};

export class PaneHistory {
	private transcripts = new Map<string, Transcript>();
	private pending = new Map<string, ReturnType<typeof setTimeout>>();
	private reading = new Map<string, Promise<Transcript>>();

	private key = (session: string, paneId: string) => `${session}\t${paneId}`;

	/** Output happened in a pane someone is watching: read it soon. */
	noteActivity(session: string, paneId: string) {
		const key = this.key(session, paneId);
		if (this.pending.has(key)) return;
		this.pending.set(
			key,
			setTimeout(() => {
				this.pending.delete(key);
				void this.refresh(session, paneId).catch(() => {});
			}, ACTIVITY_DEBOUNCE_MS)
		);
	}

	/** Reads the pane's latest lines and merges them (one read at a time per pane). */
	refresh(session: string, paneId: string): Promise<Transcript> {
		const key = this.key(session, paneId);
		const running = this.reading.get(key);
		if (running) return running;
		const work = (async () => {
			const result = await request<{ read?: { text?: string } }>(socketPathFor(session), 'pane.read', {
				pane_id: paneId,
				source: 'recent_unwrapped',
				format: 'ansi',
				lines: READ_LINES
			});
			const latest = (result.read?.text ?? '').split(/\r?\n/);
			// A trailing newline leaves an empty last element that isn't a line.
			if (latest.length > 1 && latest.at(-1) === '') latest.pop();
			const previous = this.transcripts.get(key);
			const next: Transcript = { lines: mergeLines(previous?.lines ?? [], latest), readAt: Date.now() };
			this.transcripts.delete(key); // Re-insert as most recently used.
			this.transcripts.set(key, next);
			while (this.transcripts.size > MAX_PANES) this.transcripts.delete(this.transcripts.keys().next().value!);
			return next;
		})().finally(() => this.reading.delete(key));
		this.reading.set(key, work);
		return work;
	}

	/** The pane's history, freshly merged: every kept line, oldest first. */
	async get(session: string, paneId: string) {
		const t = await this.refresh(session, paneId);
		return { lines: t.lines, readAt: t.readAt, limit: HISTORY_LINES };
	}

	/** Forgets panes of a session (it stopped or went away). */
	forgetSession(session: string) {
		for (const key of [...this.transcripts.keys()]) if (key.startsWith(`${session}\t`)) this.transcripts.delete(key);
	}

	stop() {
		for (const t of this.pending.values()) clearTimeout(t);
		this.pending.clear();
	}
}
