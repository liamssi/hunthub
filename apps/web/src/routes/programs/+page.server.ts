import { error } from '@sveltejs/kit';
import type { PlatformAccountView, ProgramSummary } from '@hunthub/shared/programs';
import { apiFetch } from '$lib/server/api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	event.depends('app:programs');
	const [p, a] = await Promise.all([apiFetch(event, '/api/programs'), apiFetch(event, '/api/platform-accounts')]);
	if (!p.ok || !a.ok) error(p.ok ? a.status : p.status, 'Could not load programs.');
	const { programs }: { programs: ProgramSummary[] } = await p.json();
	const { accounts }: { accounts: PlatformAccountView[] } = await a.json();
	return { programs, account: accounts.find((x) => x.platform === 'hackerone') ?? null };
};
