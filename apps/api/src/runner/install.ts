// Serves the one-line installer and the runner binaries it downloads.
// `curl -fsSL <hub>/api/install.sh | sh -s -- <join-token>`
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';

// The script bundle (runs with Bun) is what the installer uses during development;
// compiled single-file binaries come later.
const targets = ['hunthub-runner.js', 'linux-x64', 'linux-arm64'] as const;
type Target = (typeof targets)[number];

/** Where compiled runner binaries live (built into the API image in production). */
const distDir = resolve(process.env.RUNNER_DIST_DIR ?? join(import.meta.dir, '../../../runner/dist'));

function binaryPath(target: Target) {
	return join(distDir, target === 'hunthub-runner.js' ? target : `hunthub-runner-${target}`);
}

const checksums = new Map<string, { mtimeMs: number; sha256: string }>();

/** SHA-256 of a binary, cached until the file changes. */
async function sha256(path: string): Promise<string> {
	const file = Bun.file(path);
	const mtimeMs = (await file.stat()).mtimeMs;
	const cached = checksums.get(path);
	if (cached?.mtimeMs === mtimeMs) return cached.sha256;
	const hash = createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex');
	checksums.set(path, { mtimeMs, sha256: hash });
	return hash;
}

function publicUrl(): string {
	return (process.env.BETTER_AUTH_URL ?? 'http://localhost:3001').replace(/\/$/, '');
}

// Read per request: it is tiny, and edits apply without a restart.
const scriptPath = join(import.meta.dir, 'install.sh');

export const installRoutes = new Hono()
	.get('/install.sh', (c) => {
		c.header('content-type', 'text/x-shellscript; charset=utf-8');
		c.header('cache-control', 'no-store');
		return c.body(readFileSync(scriptPath, 'utf8').replaceAll('__HUB_URL__', publicUrl()));
	})
	.get('/runner/download/:file', async (c) => {
		const file = c.req.param('file');
		const wantsChecksum = file.endsWith('.sha256');
		const target = file.replace(/\.sha256$/, '') as Target;
		if (!targets.includes(target)) return c.json({ error: 'unknown_target' }, 404);
		const path = binaryPath(target);
		if (!existsSync(path)) return c.json({ error: 'not_built', message: `No runner binary for ${target} on this hub.` }, 404);
		const hash = await sha256(path);
		if (wantsChecksum) return c.text(`${hash}  hunthub-runner\n`);
		c.header('content-type', 'application/octet-stream');
		c.header('x-sha256', hash);
		return c.body(Bun.file(path).stream());
	});
