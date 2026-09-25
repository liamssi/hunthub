// The HTTP API. Tests use it directly; index.ts serves it.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { auth } from './auth';
import { db } from './db';
import { liveRoutes } from './live/routes';
import { machineRoutes, settingsRoutes } from './machines/routes';
import { installRoutes } from './runner/install';
import { runnerRoutes } from './runner/routes';

export const app = new Hono().basePath('/api');

app.use(secureHeaders());
app.use(bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }));

app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw));
app.route('/machines', machineRoutes);
app.route('/settings', settingsRoutes);
app.route('/runner', runnerRoutes);
app.route('/', installRoutes);
app.route('/live', liveRoutes);

app.get('/health', async (c) => {
	try {
		await db.execute(sql`select 1`);
		return c.json({ status: 'ok', db: 'ok' });
	} catch (err) {
		console.error('health: db check failed', err);
		return c.json({ status: 'degraded', db: 'unreachable' }, 503);
	}
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
	console.error(err);
	return c.json({ error: 'internal_error' }, 500);
});
