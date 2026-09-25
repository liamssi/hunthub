import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';

/**
 * The client's IP. Behind Caddy (or Vite in dev) the proxy sets X-Forwarded-For
 * to the real address; direct connections fall back to the socket address.
 */
export function clientIp(c: Context): string | null {
	const forwarded = c.req.header('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0]!.trim();
	try {
		return getConnInfo(c).remote.address ?? null;
	} catch {
		return null;
	}
}
