import { error } from '@sveltejs/kit';
import type { Machine, MachineHerdrView } from '@hunthub/shared/machines';
import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const id = encodeURIComponent(event.params.id);
	const [machineRes, herdrRes] = await Promise.all([apiFetch(event, `/api/machines/${id}`), apiFetch(event, `/api/machines/${id}/herdr`)]);
	if (machineRes.status === 404) error(404, 'Machine not found.');
	if (!machineRes.ok) error(machineRes.status, 'Could not load the machine.');
	const { machine }: { machine: Machine } = await machineRes.json();
	const herdr: MachineHerdrView = herdrRes.ok ? await herdrRes.json() : { supported: false, sessions: [] };
	return { machine, herdr, sessionName: event.params.session };
};
