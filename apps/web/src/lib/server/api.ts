import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

export const apiUrl = env.API_URL ?? 'http://localhost:3000';

/** Calls the API on behalf of the browser: forwards its auth cookie and IP. */
export function apiFetch(event: Pick<RequestEvent, 'request' | 'getClientAddress'>, path: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	headers.set('cookie', event.request.headers.get('cookie') ?? '');
	headers.set('x-forwarded-for', event.getClientAddress());
	return fetch(`${apiUrl}${path}`, { ...init, headers });
}
