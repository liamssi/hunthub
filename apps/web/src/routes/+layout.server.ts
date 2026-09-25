import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.apiAvailable) error(503, 'HuntHub is temporarily unavailable: the API cannot be reached.');
	return { user: locals.user, session: locals.session };
};
