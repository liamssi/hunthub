// The file explorer's view of a session's project folders (read-only; the
// runner confines access to the session's own folders).
import { consoleQuery } from './console';

export type FileRoot = { path: string; label: string; kind: 'checkout' | 'folder'; workspaceId: string | null };

export type FileEntry = {
	name: string;
	/** Relative to the root. */
	path: string;
	type: 'directory' | 'file' | 'symlink' | 'other';
	target?: 'directory' | 'file' | 'broken' | 'outside';
	size: number;
	mtime: number;
	hidden: boolean;
	ignored?: boolean;
};

export type FileListing = { root: string; path: string; entries: FileEntry[]; total: number; truncated: boolean };

type Base = { root: string; path: string; name: string; size: number; mtime: number };
export type FileContent =
	| (Base & { kind: 'text'; text: string; truncated: boolean })
	| (Base & { kind: 'image'; mime?: string; data?: string; tooLarge?: boolean })
	| (Base & { kind: 'binary' });

export type FileResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

async function query<T>(machineId: string, session: string, method: string, params: Record<string, unknown>): Promise<FileResult<T>> {
	const out = await consoleQuery(machineId, session, method, params);
	return out.ok ? { ok: true, value: out.result as T } : { ok: false, code: out.code, message: out.message };
}

export const fileRoots = (machineId: string, session: string) =>
	query<{ roots: FileRoot[] }>(machineId, session, 'hunthub.fs.roots', {});

export const listFolder = (machineId: string, session: string, root: string, path: string) =>
	query<FileListing>(machineId, session, 'hunthub.fs.list', { root, path });

export const readFile = (machineId: string, session: string, root: string, path: string) =>
	query<FileContent>(machineId, session, 'hunthub.fs.read', { root, path });

/** Whether a folder-like entry can be opened as a folder. */
export const isFolder = (e: FileEntry) => e.type === 'directory' || (e.type === 'symlink' && e.target === 'directory');

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let n = bytes / 1024;
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export const joinPath = (root: string, rel: string) => (rel ? `${root.replace(/\/+$/, '')}/${rel}` : root);
