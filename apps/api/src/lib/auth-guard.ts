import { createMiddleware } from 'hono/factory';
import { auth } from '../auth';

type SessionData = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export type AuthVariables = {
	user: SessionData['user'];
	session: SessionData['session'];
};

/** Requires a signed-in user; exposes it as `c.get('user')`. */
export const requireUser = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
	const data = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!data) return c.json({ error: 'unauthorized' }, 401);
	c.set('user', data.user);
	c.set('session', data.session);
	await next();
});

/** Requires an admin; use after `requireUser`. */
export const requireAdmin = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
	if (c.get('user').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
	await next();
});
