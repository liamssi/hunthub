import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

type Health = { status: string; db: string };

export const load: PageServerLoad = async (event) => {
	try {
		const res = await apiFetch(event, '/api/health');
		const health: Health = await res.json();
		return { api: res.ok ? 'ok' : 'degraded', db: health.db };
	} catch {
		return { api: 'unreachable', db: 'unknown' };
	}
};
