import { error } from '@sveltejs/kit';
import type { AgentView } from '@hunthub/shared/machines';
import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const res = await apiFetch(event, '/api/agents');
	if (!res.ok) error(res.status, 'Could not load agents.');
	const { agents }: { agents: AgentView[] } = await res.json();
	return { agents };
};
