import { Hono } from 'hono';
import { websocket } from 'hono/bun';
import { logger } from 'hono/logger';
import { app } from './app';
import { client } from './db';
import { loadConnectionSettings } from './machines/connection-settings';
import { startOfflineSweep, stopOfflineSweep } from './machines/registry';
import { startStatsJobs, stopStatsJobs } from './machines/stats';

const root = new Hono();
root.use(logger());
root.route('/', app);
// Handlers on a mounted app don't apply at the root, so repeat them here.
root.notFound((c) => c.json({ error: 'not_found' }, 404));
root.onError((err, c) => {
	console.error(err);
	return c.json({ error: 'internal_error' }, 500);
});

await loadConnectionSettings();
const server = Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: root.fetch, websocket });
startStatsJobs();
startOfflineSweep();
console.log(`api listening on :${server.port}`);

async function shutdown() {
	stopOfflineSweep();
	await stopStatsJobs();
	await server.stop();
	await client.end({ timeout: 5 });
	process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
