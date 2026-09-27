import { error } from '@sveltejs/kit';
import type { Preferences } from '@hunthub/shared/preferences';
import { SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants.js';
import { apiFetch } from '$lib/server/api';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const { locals, cookies } = event;
	if (!locals.apiAvailable) error(503, 'HuntHub is temporarily unavailable: the API cannot be reached.');
	// The user's settings come with the page, so it draws with them from the start.
	let preferences: Preferences = {};
	if (locals.user) {
		const res = await apiFetch(event, '/api/preferences').catch(() => null);
		if (res?.ok) preferences = ((await res.json()) as { prefs: Preferences }).prefs;
	}
	return {
		preferences,
		user: locals.user,
		session: locals.session,
		// Restores the collapsed/expanded sidebar without a flash on load.
		sidebarOpen: cookies.get(SIDEBAR_COOKIE_NAME) !== 'false'
	};
};
