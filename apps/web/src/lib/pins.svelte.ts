// The signed-in user's pinned sessions and terminals (stored on the hub, so
// they follow you across browsers).
import type { Pin } from '@hunthub/shared/machines';
import { toast } from 'svelte-sonner';

export const pins = $state({ list: [] as Pin[], loaded: false });

export async function loadPins() {
	try {
		const res = await fetch('/api/pins');
		if (res.ok) pins.list = (await res.json()).pins;
	} finally {
		pins.loaded = true;
	}
}

export const findPin = (machineId: string, session: string, paneId: string | null = null) =>
	pins.list.find((p) => p.machineId === machineId && p.session === session && (p.paneId ?? null) === paneId);

export async function pin(machineId: string, session: string, paneId: string | null, label: string) {
	const res = await fetch('/api/pins', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ machineId, session, paneId, label: label.slice(0, 200) })
	});
	if (!res.ok) {
		toast.error('Pin failed', { description: (await res.json().catch(() => ({}))).message ?? `HuntHub answered ${res.status}` });
		return;
	}
	const { pin: created } = (await res.json()) as { pin: Pin };
	if (!pins.list.some((p) => p.id === created.id)) pins.list = [...pins.list, created];
}

export async function unpin(id: number) {
	const before = pins.list;
	pins.list = pins.list.filter((p) => p.id !== id);
	const res = await fetch(`/api/pins/${id}`, { method: 'DELETE' });
	if (!res.ok && res.status !== 404) {
		pins.list = before;
		toast.error('Unpin failed');
	}
}

export async function togglePin(machineId: string, session: string, paneId: string | null, label: string) {
	const existing = findPin(machineId, session, paneId);
	if (existing) await unpin(existing.id);
	else await pin(machineId, session, paneId, label);
}
