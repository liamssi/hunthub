import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRelative, type FileRoot, FsError, listFolder, readFile, rootsFromSnapshot, TEXT_LIMIT } from './files';

let base: string;
let root: string;
let roots: FileRoot[];

beforeAll(() => {
	base = mkdtempSync(join(tmpdir(), 'hunthub-files-'));
	root = join(base, 'project');
	mkdirSync(join(root, 'src'), { recursive: true });
	mkdirSync(join(base, 'secret'));
	writeFileSync(join(base, 'secret', 'key.txt'), 'nope');
	writeFileSync(join(root, 'README.md'), '# Hello\nworld ✓\n');
	writeFileSync(join(root, '.env'), 'X=1');
	writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 1;');
	writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;');
	writeFileSync(join(root, 'blob.bin'), Buffer.from([1, 2, 0, 3]));
	writeFileSync(join(root, 'big.txt'), 'é'.repeat(TEXT_LIMIT)); // 2 bytes each: twice the limit
	writeFileSync(join(root, 'pixel.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
	symlinkSync(join(base, 'secret'), join(root, 'escape'));
	symlinkSync(join(root, 'src'), join(root, 'src-link'));
	symlinkSync(join(base, 'missing'), join(root, 'dangling'));
	roots = [{ path: root, label: 'project', kind: 'checkout', workspaceId: 'w1' }];
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const code = async (p: Promise<unknown>) => {
	try {
		await p;
		return 'ok';
	} catch (err) {
		return err instanceof FsError ? err.code : String(err);
	}
};

describe('file explorer (runner side)', () => {
	test('roots come from the snapshot: checkouts first, then pane folders, deduplicated', () => {
		const out = rootsFromSnapshot({
			workspaces: [{ workspace_id: 'w1', label: 'api', worktree: { checkout_path: '/src/api' } }, { workspace_id: 'w2', label: 'tmp' }],
			panes: [
				{ workspace_id: 'w1', cwd: '/src/api', foreground_cwd: '/src/api/web' },
				{ workspace_id: 'w2', cwd: 'relative/ignored' }
			]
		});
		expect(out).toEqual([
			{ path: '/src/api', label: 'api', kind: 'checkout', workspaceId: 'w1' },
			{ path: '/src/api/web', label: 'api', kind: 'folder', workspaceId: 'w1' }
		]);
		expect(rootsFromSnapshot(null)).toEqual([]);
	});

	test('paths must stay relative and inside', () => {
		expect(checkRelative('')).toBe('');
		expect(checkRelative('./src//a.ts/')).toBe('src/a.ts');
		for (const bad of ['../x', 'src/../../x', '/etc/passwd', 'a\0b', 42]) expect(() => checkRelative(bad)).toThrow(FsError);
	});

	test('lists folders first, sorted by name, with hidden, symlink and size details', async () => {
		const out = await listFolder(roots, { root, path: '' });
		expect(out.entries.map((e) => e.name)).toEqual([
			'src',
			'.env',
			'big.txt',
			'blob.bin',
			'dangling',
			'escape',
			'pixel.png',
			'README.md',
			'src-link'
		]);
		const byName = Object.fromEntries(out.entries.map((e) => [e.name, e]));
		expect(byName['.env']!.hidden).toBe(true);
		expect(byName['README.md']).toMatchObject({ type: 'file', path: 'README.md' });
		expect(byName['escape']).toMatchObject({ type: 'symlink', target: 'outside' });
		expect(byName['src-link']).toMatchObject({ type: 'symlink', target: 'directory' });
		expect(byName['dangling']).toMatchObject({ type: 'symlink', target: 'broken' });
		expect((await listFolder(roots, { root, path: 'src' })).entries.map((e) => e.path)).toEqual(['src/a.ts', 'src/b.ts']);
	});

	test('refuses anything outside the session folders', async () => {
		expect(await code(listFolder(roots, { root: base, path: '' }))).toBe('invalid_root');
		expect(await code(listFolder(roots, { root, path: '..' }))).toBe('invalid_path');
		expect(await code(listFolder(roots, { root, path: 'escape' }))).toBe('outside_root');
		expect(await code(readFile(roots, { root, path: 'escape/key.txt' }))).toBe('outside_root');
		expect(await code(readFile(roots, { root, path: 'nothing-here' }))).toBe('not_found');
		expect(await code(readFile(roots, { root, path: 'src' }))).toBe('not_a_file');
		expect(await code(listFolder(roots, { root, path: 'README.md' }))).toBe('not_a_directory');
	});

	test('reads text, detects binary, cuts large files cleanly and returns images', async () => {
		expect(await readFile(roots, { root, path: 'README.md' })).toMatchObject({ kind: 'text', text: '# Hello\nworld ✓\n', truncated: false });
		expect(await readFile(roots, { root, path: 'src-link/a.ts' })).toMatchObject({ kind: 'text', path: 'src-link/a.ts' });
		expect(await readFile(roots, { root, path: 'blob.bin' })).toMatchObject({ kind: 'binary' });
		const big = (await readFile(roots, { root, path: 'big.txt' })) as { kind: string; text: string; truncated: boolean };
		expect(big.truncated).toBe(true);
		// Cut on a character boundary: every character intact.
		expect(big.text.length).toBe(TEXT_LIMIT / 2);
		expect(/^é+$/.test(big.text)).toBe(true);
		expect(await readFile(roots, { root, path: 'pixel.png' })).toMatchObject({ kind: 'image', mime: 'image/png', data: 'iVBORw0KGgo=' });
	});
});
