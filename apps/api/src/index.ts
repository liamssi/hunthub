import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { auth } from './auth';
import { client, db } from './db';

const app = new Hono().basePath('/api');

app.use(logger());
app.use(secureHeaders());
app.use(bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }));

app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw));

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

const server = Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: app.fetch });
console.log(`api listening on :${server.port}`);

async function shutdown() {
	await server.stop();
	await client.end({ timeout: 5 });
	process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
