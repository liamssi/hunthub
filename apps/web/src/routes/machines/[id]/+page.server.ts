import { error } from '@sveltejs/kit';
import type { Machine, StatsSeries } from '@hunthub/shared/machines';
import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	event.depends('app:machine');
	const id = encodeURIComponent(event.params.id);
	const [machineRes, statsRes] = await Promise.all([
		apiFetch(event, `/api/machines/${id}`),
		apiFetch(event, `/api/machines/${id}/stats?range=1h`)
	]);
	if (machineRes.status === 404) error(404, 'Machine not found.');
	if (!machineRes.ok) error(machineRes.status, 'Could not load the machine.');
	const { machine }: { machine: Machine } = await machineRes.json();
	const series: StatsSeries | null = statsRes.ok ? await statsRes.json() : null;
	return { machine, series };
};
