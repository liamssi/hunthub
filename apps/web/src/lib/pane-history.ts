// Pane history, fetched in the background and cached, so scrolling up opens
// it instantly. The runner keeps each pane's transcript (beyond Herdr's last
// 1000 lines); this keeps the latest copy per pane in the page.
import { consoleQuery } from './console';

export type History = { text: string; lines: number; readAt: number; fetchedAt: number };

const cache = new Map<string, History>();
const inflight = new Map<string, Promise<History | null>>();
/** A cached copy younger than this isn't fetched again for a prefetch. */
const FRESH_MS = 5000;

const key = (machineId: string, session: string, paneId: string) => `${machineId}\t${session}\t${paneId}`;

export const cachedHistory = (machineId: string, session: string, paneId: string) => cache.get(key(machineId, session, paneId)) ?? null;

/** Fetches a pane's history (one request at a time per pane). */
export function fetchHistory(machineId: string, session: string, paneId: string): Promise<History | null> {
	const k = key(machineId, session, paneId);
	const running = inflight.get(k);
	if (running) return running;
	const work = (async () => {
		const out = await consoleQuery(machineId, session, 'hunthub.pane.history', { pane_id: paneId });
		if (!out.ok) return null;
		const result = out.result as { lines?: string[]; readAt?: number };
		const lines = result.lines ?? [];
		const history: History = { text: lines.join('\r\n'), lines: lines.length, readAt: result.readAt ?? Date.now(), fetchedAt: Date.now() };
		cache.set(k, history);
		return history;
	})().finally(() => inflight.delete(k));
	inflight.set(k, work);
	return work;
}

/** Warms the cache in the background unless a fresh copy is already there. */
export function prefetchHistory(machineId: string, session: string, paneId: string) {
	const hit = cache.get(key(machineId, session, paneId));
	if (hit && Date.now() - hit.fetchedAt < FRESH_MS) return;
	void fetchHistory(machineId, session, paneId);
}
