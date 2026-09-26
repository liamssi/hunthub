import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The single-session workspace moved to /workspace, which holds several sessions.
export const load: PageServerLoad = ({ params }) => {
	redirect(307, `/workspace?${new URLSearchParams({ open: `${params.id}:${params.session}` })}`);
};
