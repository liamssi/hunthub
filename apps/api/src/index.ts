import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { sql } from 'drizzle-orm';
import { db } from './db';

const app = new Hono();

app.use(logger());

app.get('/health', async (c) => {
	try {
		await db.execute(sql`select 1`);
		return c.json({ status: 'ok', db: 'ok' });
	} catch (err) {
		console.error('health: db check failed', err);
		return c.json({ status: 'degraded', db: 'unreachable' }, 503);
	}
});

export default {
	port: Number(process.env.PORT ?? 3000),
	fetch: app.fetch
};
