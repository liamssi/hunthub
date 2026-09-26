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

type Transcript = { lines: string[]; readAt: number };

/**
 * Merges Herdr's latest lines into a transcript. The last kept line is the
 * live one (a prompt being typed on changes), so it's always replaced.
 * Returns the merged lines.
 */
export function mergeLines(kept: string[], latest: string[], max = HISTORY_LINES): string[] {
	if (!kept.length) return latest.slice(-max);
	if (!latest.length) return kept;
	const stable = kept.slice(0, -1);
	// The longest end of what's kept that the new lines start with.
	const limit = Math.min(stable.length, latest.length);
	let overlap = -1;
	for (let t = limit; t >= 1; t--) {
		if (stable[stable.length - t] !== latest[0]) continue;
		let same = true;
		for (let k = 1; k < t; k++) {
			if (stable[stable.length - t + k] !== latest[k]) {
				same = false;
				break;
			}
		}
		if (same) {
			overlap = t;
			break;
		}
	}
	let merged: string[];
	if (overlap > 0) merged = [...stable.slice(0, stable.length - overlap), ...latest];
	else if (latest.length < READ_LINES) merged = latest; // Herdr still has everything: nothing is lost.
	else merged = [...stable, GAP_MARKER, ...latest];
	return merged.length > max ? merged.slice(-max) : merged;
}

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
