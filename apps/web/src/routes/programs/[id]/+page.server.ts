import { error } from '@sveltejs/kit';
import type { ProgramDetail } from '@hunthub/shared/programs';
import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const res = await apiFetch(event, `/api/programs/${encodeURIComponent(event.params.id)}`);
	if (res.status === 404) error(404, 'Program not found.');
	if (!res.ok) error(res.status, 'Could not load the program.');
	const { program }: { program: ProgramDetail } = await res.json();
	return { program };
};
