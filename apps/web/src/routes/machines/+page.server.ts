import { error } from '@sveltejs/kit';
import type { Machine } from '@hunthub/shared/machines';
import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	event.depends('app:machines');
	const res = await apiFetch(event, '/api/machines');
	if (!res.ok) error(res.status, 'Could not load machines.');
	const { machines }: { machines: Machine[] } = await res.json();
	return { machines };
};
