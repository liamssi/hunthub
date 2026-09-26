import { error } from '@sveltejs/kit';
import type { Machine } from '@hunthub/shared/machines';
import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const res = await apiFetch(event, `/api/machines/${encodeURIComponent(event.params.id)}`);
	if (res.status === 404) error(404, 'Machine not found.');
	if (!res.ok) error(res.status, 'Could not load the machine.');
	const { machine }: { machine: Machine } = await res.json();
	return { machine, sessionName: event.params.session };
};
