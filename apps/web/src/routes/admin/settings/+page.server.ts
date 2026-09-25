import { error } from '@sveltejs/kit';
import type { MachineConnectionSettings, MachineRetentionSettings } from '@hunthub/shared/machines';
import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const res = await apiFetch(event, '/api/settings/machines');
	if (!res.ok) error(res.status, 'Could not load settings.');
	const settings: { retention: MachineRetentionSettings; connection: MachineConnectionSettings } = await res.json();
	return settings;
};
