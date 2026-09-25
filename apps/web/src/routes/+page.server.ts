import { apiUrl } from '$lib/server/api';
import type { PageServerLoad } from './$types';

type Health = { status: string; db: string };

export const load: PageServerLoad = async ({ fetch }) => {
	try {
		const res = await fetch(`${apiUrl}/api/health`);
		const health: Health = await res.json();
		return { api: 'ok', health };
	} catch {
		return { api: 'unreachable', health: null };
	}
};
