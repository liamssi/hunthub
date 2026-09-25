import { error } from '@sveltejs/kit';
import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	if (!locals.apiAvailable) error(503, 'HuntHub is temporarily unavailable: the API cannot be reached.');
	return {
		user: locals.user,
		session: locals.session,
		// Restores the collapsed/expanded sidebar without a flash on load.
		sidebarOpen: cookies.get(SIDEBAR_COOKIE_NAME) !== 'false'
	};
};
