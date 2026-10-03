// Program details fetched in the browser (for the quick look), cached briefly
// so stepping back and forth between programs is instant.
import type { ProgramDetail } from '@hunthub/shared/programs';

const cache = new Map<number, { at: number; detail: ProgramDetail }>();
const inflight = new Map<number, Promise<ProgramDetail | null>>();
const FRESH_MS = 60_000;

export function programDetail(id: number): Promise<ProgramDetail | null> {
	const hit = cache.get(id);
	if (hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.detail);
	const running = inflight.get(id);
	if (running) return running;
	const work = (async () => {
		const res = await fetch(`/api/programs/${id}`).catch(() => null);
		if (!res?.ok) return null;
		const { program }: { program: ProgramDetail } = await res.json();
		cache.set(id, { at: Date.now(), detail: program });
		return program;
	})().finally(() => inflight.delete(id));
	inflight.set(id, work);
	return work;
}

export const cachedProgramDetail = (id: number) => cache.get(id)?.detail ?? null;

/** Keeps a cached program in step with an edit made here (e.g. its notes). */
export function patchCachedDetail(id: number, patch: Partial<ProgramDetail>) {
	const hit = cache.get(id);
	if (hit) hit.detail = { ...hit.detail, ...patch };
}
