import { error } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export type AdminUser = {
	id: string;
	name: string;
	email: string;
	role?: string | null;
	banned?: boolean | null;
	createdAt: string;
};

export const load: PageServerLoad = async (event) => {
	event.depends('app:users');
	const res = await apiFetch(event, '/api/auth/admin/list-users?limit=500&sortBy=createdAt&sortDirection=asc');
	if (!res.ok) error(res.status, 'Could not load users.');
	const { users }: { users: AdminUser[] } = await res.json();
	return { users };
};
