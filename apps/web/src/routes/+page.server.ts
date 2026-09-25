import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

type Health = { status: string; db: string };

export const load: PageServerLoad = async ({ fetch }) => {
	const apiUrl = env.API_URL ?? 'http://localhost:3000';
	try {
		const res = await fetch(`${apiUrl}/health`);
		const health: Health = await res.json();
		return { api: 'ok', health };
	} catch {
		return { api: 'unreachable', health: null };
	}
};
