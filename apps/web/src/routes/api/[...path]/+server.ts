// Forwards browser calls under /api/* to the API server, so auth cookies stay
// on the web app's origin.
import { apiUrl } from '$lib/server/api';
import type { RequestHandler } from './$types';

const forward: RequestHandler = async ({ request, params, url, getClientAddress }) => {
	const target = new URL(`/api/${params.path}${url.search}`, apiUrl);

	const headers = new Headers(request.headers);
	headers.delete('host');
	headers.delete('connection');
	headers.set('x-forwarded-for', getClientAddress());

	const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
	const res = await fetch(target, {
		method: request.method,
		headers,
		body: hasBody ? await request.arrayBuffer() : undefined,
		redirect: 'manual'
	});

	// fetch already decoded the body, so the original encoding headers no longer apply.
	const resHeaders = new Headers(res.headers);
	resHeaders.delete('content-encoding');
	resHeaders.delete('content-length');

	return new Response(res.body, { status: res.status, statusText: res.statusText, headers: resHeaders });
};

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
