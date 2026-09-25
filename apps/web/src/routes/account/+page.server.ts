import { error } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export type AccountSession = {
	id: string;
	token: string;
	createdAt: string;
	ipAddress?: string | null;
	userAgent?: string | null;
};

export const load: PageServerLoad = async (event) => {
	event.depends('app:sessions');
	const res = await apiFetch(event, '/api/auth/list-sessions');
	if (!res.ok) error(res.status, 'Could not load your sessions.');
	const sessions: AccountSession[] = await res.json();
	return { sessions };
};
