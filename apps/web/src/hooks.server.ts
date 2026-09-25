import { error, redirect, type Handle } from '@sveltejs/kit';
import { apiUrl } from '$lib/server/api';

const publicPaths = ['/login'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	if (path.startsWith('/api/')) return resolve(event);

	const sessionRes = await fetch(`${apiUrl}/api/auth/get-session`, {
		headers: { cookie: event.request.headers.get('cookie') ?? '' }
	});
	const data: { user: App.Locals['user']; session: App.Locals['session'] } | null = sessionRes.ok
		? await sessionRes.json()
		: null;
	event.locals.user = data?.user ?? null;
	event.locals.session = data?.session ?? null;

	if (!event.locals.user && !publicPaths.includes(path)) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(path + event.url.search)}`);
	}
	if (event.locals.user && path === '/login') redirect(303, '/');
	if (path.startsWith('/admin') && event.locals.user?.role !== 'admin') error(403, 'Admins only');

	const response = await resolve(event);
	// Pass on refreshed session cookies from the API.
	for (const cookie of sessionRes.headers.getSetCookie()) response.headers.append('set-cookie', cookie);
	return response;
};
