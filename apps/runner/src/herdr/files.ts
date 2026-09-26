// Read-only file browsing for the hub's file explorer. Access is confined to
// a session's project folders, computed here from Herdr's own snapshot (never
// taken from the hub): each workspace's git checkout and each pane's working
// folder. Paths are resolved to real paths, so symlinks can't lead outside a
// root, and every operation has size and time limits.
import { spawn } from 'node:child_process';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Most entries returned for one folder. */
export const LIST_LIMIT = 2000;
/** Text previews are cut here (a notice says so). */
export const TEXT_LIMIT = 1024 * 1024;
/** Images larger than this aren't previewed (they must fit a runner message as base64). */
export const IMAGE_LIMIT = 2.5 * 1024 * 1024;
const OP_TIMEOUT_MS = 10_000;
const STAT_CONCURRENCY = 32;

export class FsError extends Error {
	constructor(
		readonly code: 'invalid_path' | 'invalid_root' | 'not_found' | 'forbidden' | 'outside_root' | 'not_a_directory' | 'not_a_file' | 'timeout' | 'failed',
		message: string
	) {
		super(message);
	}
}

export type FileRoot = { path: string; label: string; kind: 'checkout' | 'folder'; workspaceId: string | null };

type Snapshot = {
	workspaces?: { workspace_id?: string; label?: string; worktree?: { checkout_path?: string } | null }[];
	panes?: { workspace_id?: string; cwd?: string; foreground_cwd?: string }[];
};

/** The folders a session's file explorer may show: checkouts first, then pane folders. */
export function rootsFromSnapshot(snapshot: unknown): FileRoot[] {
	const s = (snapshot ?? {}) as Snapshot;
	const labels = new Map((s.workspaces ?? []).map((w) => [w.workspace_id, w.label || w.workspace_id || 'space']));
	const roots = new Map<string, FileRoot>();
	for (const w of s.workspaces ?? []) {
		const path = w.worktree?.checkout_path;
		if (path && isAbsolute(path) && !roots.has(path)) {
			roots.set(path, { path, label: w.label || basename(path), kind: 'checkout', workspaceId: w.workspace_id ?? null });
		}
	}
	for (const p of s.panes ?? []) {
		for (const path of [p.foreground_cwd, p.cwd]) {
			if (path && isAbsolute(path) && !roots.has(path)) {
				roots.set(path, { path, label: labels.get(p.workspace_id) ?? basename(path), kind: 'folder', workspaceId: p.workspace_id ?? null });
			}
		}
	}
	return [...roots.values()];
}

function mapError(err: unknown): FsError {
	if (err instanceof FsError) return err;
	const code = (err as NodeJS.ErrnoException)?.code;
	if (code === 'ENOENT' || code === 'ENOTDIR') return new FsError('not_found', 'It no longer exists.');
	if (code === 'EACCES' || code === 'EPERM') return new FsError('forbidden', "The runner isn't allowed to read it.");
	if (code === 'ELOOP') return new FsError('not_found', 'It is a symbolic link loop.');
	return new FsError('failed', err instanceof Error ? err.message : String(err));
}

async function withTimeout<T>(work: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new FsError('timeout', 'The machine took too long to answer.')), OP_TIMEOUT_MS);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** A path relative to a root: no absolute paths, no "..", no NUL. "" is the root itself. */
export function checkRelative(path: unknown): string {
	if (typeof path !== 'string' || path.length > 4096 || path.includes('\0')) throw new FsError('invalid_path', 'Invalid path.');
	const clean = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	if (isAbsolute(path) || clean.split('/').some((seg) => seg === '..')) throw new FsError('invalid_path', 'Paths must stay inside the folder.');
	return clean.split('/').filter((seg) => seg && seg !== '.').join('/');
}

const inside = (root: string, target: string) => {
	const rel = relative(root, target);
	return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

/** Resolves a relative path under an allowed root, following symlinks only if they stay inside it. */
async function resolveInside(roots: FileRoot[], rootPath: unknown, path: unknown) {
	const root = roots.find((r) => r.path === rootPath);
	if (!root) throw new FsError('invalid_root', 'That folder is not part of this session anymore.');
	const rel = checkRelative(path);
	let realRoot: string;
	try {
		realRoot = await realpath(root.path);
	} catch (err) {
		throw mapError(err);
	}
	let realTarget: string;
	try {
		realTarget = await realpath(resolve(realRoot, rel));
	} catch (err) {
		throw mapError(err);
	}
	if (!inside(realRoot, realTarget)) throw new FsError('outside_root', 'That link points outside the folder.');
	return { realRoot, realTarget, rel };
}

export type FileEntry = {
	name: string;
	/** Relative to the root. */
	path: string;
	type: 'directory' | 'file' | 'symlink' | 'other';
	/** For symlinks: what the link leads to (only followed inside the root). */
	target?: 'directory' | 'file' | 'broken' | 'outside';
	size: number;
	mtime: number;
	hidden: boolean;
	ignored?: boolean;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i]!);
			}
		})
	);
	return out;
}

/** Names git ignores in a folder (empty outside a repository or on any failure). */
function gitIgnored(dir: string, names: string[]): Promise<Set<string>> {
	return new Promise((resolveIgnored) => {
		if (!names.length) return resolveIgnored(new Set());
		let out = '';
		const child = spawn('git', ['check-ignore', '-z', '--stdin'], { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] });
		const timer = setTimeout(() => child.kill(), 2000);
		child.stdout.on('data', (d) => (out += d));
		child.on('error', () => resolveIgnored(new Set()));
		child.on('close', () => {
			clearTimeout(timer);
			resolveIgnored(new Set(out.split('\0').filter(Boolean)));
		});
		child.stdin.on('error', () => {});
		child.stdin.end(names.join('\0') + '\0');
	});
}

export async function listFolder(roots: FileRoot[], params: Record<string, unknown>) {
	return withTimeout(
		(async () => {
			const { realRoot, realTarget, rel } = await resolveInside(roots, params.root, params.path ?? '');
			try {
				if (!(await stat(realTarget)).isDirectory()) throw new FsError('not_a_directory', 'That is not a folder.');
				const dirents = await readdir(realTarget, { withFileTypes: true });
				// Folders first, then by name, the way file managers sort.
				const isDir = (d: (typeof dirents)[number]) => d.isDirectory();
				dirents.sort((a, b) => Number(isDir(b)) - Number(isDir(a)) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
				const shown = dirents.slice(0, LIST_LIMIT);
				const entries = await mapLimit(shown, STAT_CONCURRENCY, async (d): Promise<FileEntry> => {
					const full = resolve(realTarget, d.name);
					const entry: FileEntry = {
						name: d.name,
						path: rel ? `${rel}/${d.name}` : d.name,
						type: d.isDirectory() ? 'directory' : d.isFile() ? 'file' : d.isSymbolicLink() ? 'symlink' : 'other',
						size: 0,
						mtime: 0,
						hidden: d.name.startsWith('.')
					};
					try {
						const info = await lstat(full);
						entry.size = info.size;
						entry.mtime = info.mtimeMs;
						if (entry.type === 'symlink') {
							try {
								const real = await realpath(full);
								if (!inside(realRoot, real)) entry.target = 'outside';
								else entry.target = (await stat(real)).isDirectory() ? 'directory' : 'file';
							} catch {
								entry.target = 'broken';
							}
						}
					} catch {
						// Vanished or unreadable meanwhile: keep the name.
					}
					return entry;
				});
				const ignored = await gitIgnored(realTarget, entries.map((e) => e.name));
				for (const e of entries) if (ignored.has(e.name)) e.ignored = true;
				return { root: params.root, path: rel, entries, total: dirents.length, truncated: dirents.length > shown.length };
			} catch (err) {
				throw mapError(err);
			}
		})()
	);
}

const IMAGE_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.bmp': 'image/bmp',
	'.ico': 'image/x-icon',
	'.svg': 'image/svg+xml'
};

/** Drops a multibyte character cut off at the end of a truncated read. */
function trimIncompleteUtf8(bytes: Uint8Array): Uint8Array {
	let i = bytes.length - 1;
	let back = 0;
	while (i >= 0 && back < 4 && (bytes[i]! & 0xc0) === 0x80) {
		i--;
		back++;
	}
	if (i < 0) return bytes;
	const lead = bytes[i]!;
	const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
	return need > back + 1 ? bytes.subarray(0, i) : bytes;
}

export async function readFile(roots: FileRoot[], params: Record<string, unknown>) {
	return withTimeout(
		(async () => {
			const { realTarget, rel } = await resolveInside(roots, params.root, params.path);
			try {
				const info = await stat(realTarget);
				if (!info.isFile()) throw new FsError('not_a_file', info.isDirectory() ? 'That is a folder.' : 'Only regular files can be viewed.');
				const base = { root: params.root, path: rel, name: basename(rel), size: info.size, mtime: info.mtimeMs };
				const mime = IMAGE_TYPES[extname(rel).toLowerCase()];
				if (mime) {
					if (info.size > IMAGE_LIMIT) return { ...base, kind: 'image' as const, tooLarge: true };
					const data = Buffer.from(await Bun.file(realTarget).arrayBuffer()).toString('base64');
					return { ...base, kind: 'image' as const, mime, data };
				}
				// Read one byte past the limit to know whether the file was cut.
				const handle = await open(realTarget, 'r');
				let bytes: Uint8Array;
				try {
					const buffer = Buffer.alloc(Math.min(info.size, TEXT_LIMIT + 1));
					const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
					bytes = buffer.subarray(0, bytesRead);
				} finally {
					await handle.close();
				}
				const truncated = bytes.length > TEXT_LIMIT;
				if (truncated) bytes = trimIncompleteUtf8(bytes.subarray(0, TEXT_LIMIT));
				// NUL bytes or invalid UTF-8 mean binary; only UTF-8 text is shown.
				if (bytes.subarray(0, 8192).includes(0)) return { ...base, kind: 'binary' as const };
				try {
					const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
					return { ...base, kind: 'text' as const, text, truncated };
				} catch {
					return { ...base, kind: 'binary' as const };
				}
			} catch (err) {
				throw mapError(err);
			}
		})()
	);
}
