import { error, redirect, type Handle } from '@sveltejs/kit';
import { apiFetch } from '$lib/server/api';

const publicPaths = ['/login'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	if (path.startsWith('/api/')) return resolve(event);

	let sessionRes: Response | null = null;
	try {
		sessionRes = await apiFetch(event, '/api/auth/get-session');
	} catch (err) {
		console.error('session lookup failed: API unreachable', err);
	}
	const data: { user: App.Locals['user']; session: App.Locals['session'] } | null = sessionRes?.ok
		? await sessionRes.json()
		: null;
	event.locals.user = data?.user ?? null;
	event.locals.session = data?.session ?? null;
	event.locals.apiAvailable = sessionRes !== null;

	if (event.locals.apiAvailable && !event.locals.user && !publicPaths.includes(path)) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(path + event.url.search)}`);
	}
	if (event.locals.user && path === '/login') redirect(303, '/');
	if (path.startsWith('/admin') && event.locals.user && event.locals.user.role !== 'admin') {
		error(403, 'Admins only');
	}

	const response = await resolve(event);
	// Pass on refreshed session cookies from the API.
	for (const cookie of sessionRes?.headers.getSetCookie() ?? []) response.headers.append('set-cookie', cookie);
	return response;
};
