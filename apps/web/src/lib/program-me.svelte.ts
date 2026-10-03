// Your own layer on programs (bookmarks, hidden, tags, notes, last seen).
// Edits show at once everywhere a program appears (cards, quick look, tabs)
// and are saved in the background; a failed save is undone.
import { toast } from 'svelte-sonner';
import type { ProgramMe, ProgramMePatch } from '@hunthub/shared/programs';

/** Edits made in this page, over what the server last sent. */
const edits = $state<Record<number, Partial<ProgramMe>>>({});

/** A program with your latest edits applied. */
const NO_LAYER: ProgramMe = { bookmarked: false, hidden: false, tags: [], hasNote: false, unseen: 0, viewedAt: null };

export function withMe<T extends { id: number; me: ProgramMe }>(p: T): T {
	const e = edits[p.id];
	// Data cached before the layer existed has none.
	if (!p.me) return { ...p, me: { ...NO_LAYER, ...e } };
	return e ? { ...p, me: { ...p.me, ...e } } : p;
}

/** Drops local edits once fresh data from the server includes them. */
export function forgetEdits() {
	for (const id of Object.keys(edits)) delete edits[Number(id)];
}

export async function updateMe(id: number, patch: ProgramMePatch, message?: string): Promise<boolean> {
	const before = edits[id];
	const { note, ...visible } = patch;
	edits[id] = { ...edits[id], ...visible, ...(note !== undefined ? { hasNote: note.trim() !== '' } : {}) };
	const res = await fetch(`/api/programs/${id}/me`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => null);
	if (!res?.ok) {
		if (before) edits[id] = before;
		else delete edits[id];
		toast.error("Couldn't save that change.");
		return false;
	}
	if (message) toast.success(message);
	return true;
}

export const toggleBookmark = (p: { id: number; name: string; me: ProgramMe }) =>
	updateMe(p.id, { bookmarked: !p.me.bookmarked }, p.me.bookmarked ? undefined : `Bookmarked ${p.name}`);

export async function toggleHidden(p: { id: number; name: string; me: ProgramMe }) {
	const hide = !p.me.hidden;
	const ok = await updateMe(p.id, { hidden: hide });
	if (ok && hide) toast.success(`Hid ${p.name}`, { action: { label: 'Undo', onClick: () => void updateMe(p.id, { hidden: false }) } });
}

/** You opened the program: its changes so far are seen. */
export async function markSeen(id: number) {
	edits[id] = { ...edits[id], unseen: 0, viewedAt: new Date().toISOString() };
	await fetch(`/api/programs/${id}/seen`, { method: 'POST' }).catch(() => null);
}

/** Tags you use across programs (suggested when tagging another one). */
export const knownTags = $state<{ list: string[] }>({ list: [] });

export function learnTags(tags: Iterable<string>) {
	const all = new Set([...knownTags.list, ...tags]);
	if (all.size !== knownTags.list.length) knownTags.list = [...all].sort();
}
