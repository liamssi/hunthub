import { Hono } from 'hono';
import { websocket } from 'hono/bun';
import { logger } from 'hono/logger';
import { app } from './app';
import { client } from './db';
import { loadRuns } from './herdr/agent-runs';
import { pruneAttention } from './herdr/attention';
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
await loadRuns();
await pruneAttention().catch((e) => console.error('attention: prune failed', e));
const server = Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: root.fetch,
	// Compression with a dedicated 32 KB window per connection: consecutive terminal
	// frames and state updates are alike, so remembering earlier ones shrinks them a lot.
	websocket: { ...websocket, perMessageDeflate: { compress: '32KB', decompress: true } }
});
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
