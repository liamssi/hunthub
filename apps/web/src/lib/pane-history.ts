// Pane history, fetched in the background and cached, so scrolling up opens
// it instantly. The runner keeps each pane's transcript (beyond Herdr's last
// 1000 lines); this keeps the latest copy per pane in the page.
//
// Transcripts can be long (10,000 lines), so little is fetched at a time:
// - in the background, only the last few screens (enough to open on);
// - when the history opens, everything once;
// - after that, only the newest lines, added to what's here. The runner numbers
//   its lines, and only the last 1000 can still change, so the newest 1200 are
//   asked for and their first 200 must match what's here (or everything is
//   fetched again).
import { consoleQuery } from './console';

export type History = {
	text: string;
	lines: number;
	readAt: number;
	fetchedAt: number;
	/** Holds everything the runner keeps, not just the newest lines. */
	complete: boolean;
};

type Entry = History & { all: string[]; /** The runner's number for all[0]. */ first: number };
type Reply = { lines: string[]; from?: number; readAt?: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<History | null>>();
/** A cached copy younger than this isn't fetched again for a prefetch. */
const FRESH_MS = 5000;
/** Lines fetched in the background: a few screens. */
const TAIL_LINES = 300;
/** Lines fetched to update a complete copy: what can still change (1000) and some that can't, to line them up. */
const SYNC_LINES = 1200;
const OVERLAP = 200;
/** Lines the runner keeps per pane. */
const LIMIT = 10_000;

const key = (machineId: string, session: string, paneId: string) => `${machineId}\t${session}\t${paneId}`;

export const cachedHistory = (machineId: string, session: string, paneId: string): History | null => cache.get(key(machineId, session, paneId)) ?? null;

async function query(machineId: string, session: string, paneId: string, tail?: number): Promise<Reply | null> {
	const out = await consoleQuery(machineId, session, 'hunthub.pane.history', tail ? { pane_id: paneId, tail } : { pane_id: paneId });
	if (!out.ok) return null;
	const result = out.result as { lines?: string[]; from?: number; readAt?: number };
	return { lines: result.lines ?? [], from: result.from, readAt: result.readAt };
}

function entry(all: string[], first: number, readAt: number | undefined, complete: boolean): Entry {
	const cut = Math.max(0, all.length - LIMIT);
	if (cut) all = all.slice(cut);
	return { all, first: first + cut, text: all.join('\r\n'), lines: all.length, readAt: readAt ?? Date.now(), fetchedAt: Date.now(), complete };
}

/** The cached lines with the newest ones in place of their old copies; null when they don't line up. */
export function splice(all: string[], first: number, newest: string[], from: number): string[] | null {
	const at = from - first;
	if (at < 0) return null;
	const need = Math.min(OVERLAP, newest.length);
	if (all.length - at < need) return null; // more arrived than was asked for
	for (let i = 0; i < need; i++) if (all[at + i] !== newest[i]) return null;
	return all.slice(0, at).concat(newest);
}

async function fetchAll(machineId: string, session: string, paneId: string): Promise<Entry | null> {
	const r = await query(machineId, session, paneId);
	return r && entry(r.lines, r.from ?? 0, r.readAt, true);
}

/**
 * Fetches a pane's history (one request at a time per pane): just the newest
 * lines for `tail`, otherwise all of it (or only what's new, once all of it is here).
 */
export function fetchHistory(machineId: string, session: string, paneId: string, opts: { tail?: boolean } = {}): Promise<History | null> {
	const k = key(machineId, session, paneId);
	const running = inflight.get(k);
	if (running) return running;
	const work = (async () => {
		const cached = cache.get(k);
		let next: Entry | null;
		if (cached?.complete) {
			const r = await query(machineId, session, paneId, SYNC_LINES);
			if (!r) return null;
			// Older runners send everything (no line numbers).
			const lines = r.from === undefined ? null : splice(cached.all, cached.first, r.lines, r.from);
			next = r.from === undefined ? entry(r.lines, 0, r.readAt, true) : lines ? entry(lines, cached.first, r.readAt, true) : await fetchAll(machineId, session, paneId);
		} else if (opts.tail) {
			const r = await query(machineId, session, paneId, TAIL_LINES);
			if (!r) return null;
			next = entry(r.lines, r.from ?? 0, r.readAt, r.from === undefined || r.lines.length < TAIL_LINES);
		} else {
			next = await fetchAll(machineId, session, paneId);
		}
		if (next) cache.set(k, next);
		return next;
	})().finally(() => inflight.delete(k));
	inflight.set(k, work);
	return work;
}

/** Warms the cache in the background unless a fresh copy is already there. */
export function prefetchHistory(machineId: string, session: string, paneId: string) {
	const hit = cache.get(key(machineId, session, paneId));
	if (hit && Date.now() - hit.fetchedAt < FRESH_MS) return;
	void fetchHistory(machineId, session, paneId, { tail: true });
}
