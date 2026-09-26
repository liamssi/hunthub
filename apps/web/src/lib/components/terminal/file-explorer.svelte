<script lang="ts" module>
	export type OpenFile = { root: string; path: string };
</script>

<script lang="ts">
	// The session's project folders as a tree. Folders load when opened (only
	// what you look at is read), and everything is read-only.
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronsDownUpIcon from '@lucide/svelte/icons/chevrons-down-up';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import FileIcon from '@lucide/svelte/icons/file';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import FileImageIcon from '@lucide/svelte/icons/file-image';
	import FileJsonIcon from '@lucide/svelte/icons/file-json';
	import FileSymlinkIcon from '@lucide/svelte/icons/file-symlink';
	import FileTerminalIcon from '@lucide/svelte/icons/file-terminal';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import FolderSymlinkIcon from '@lucide/svelte/icons/folder-symlink';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import XIcon from '@lucide/svelte/icons/x';
	import { type Component, untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { copyText } from '$lib/clipboard';
	import { type FileEntry, type FileRoot, fileRoots, formatSize, isFolder, joinPath, listFolder } from '$lib/files';
	import { cn } from '$lib/utils.js';

	let {
		machineId,
		session,
		preferredRoot,
		selected,
		onopen,
		onterminal,
		onclose
	}: {
		machineId: string;
		session: string;
		/** A folder to start in (e.g. the current space's checkout or a pane's folder). */
		preferredRoot: string | null;
		/** The file open in the viewer, highlighted here. */
		selected: OpenFile | null;
		onopen: (file: OpenFile) => void;
		/** Open a terminal in this folder (absolute path). */
		onterminal: (path: string) => void;
		onclose: () => void;
	} = $props();

	type Folder = { entries: FileEntry[]; truncated: boolean; total: number; error: string | null; loading: boolean };

	let roots = $state<FileRoot[]>([]);
	let rootsError = $state<string | null>(null);
	let root = $state<string | null>(null);
	let folders = $state<Record<string, Folder>>({});
	let expanded = $state<Record<string, boolean>>({ '': true });
	let showHidden = $state(false);
	let filter = $state('');
	let focusedPath = $state<string | null>(null);
	let tree = $state<HTMLElement | null>(null);

	async function loadRoots() {
		const out = await fileRoots(machineId, session);
		if (!out.ok) {
			rootsError = out.message;
			return;
		}
		rootsError = null;
		roots = out.value.roots;
		if (!root || !roots.some((r) => r.path === root)) pickRoot(preferredRoot);
	}

	function pickRoot(preferred: string | null) {
		const next = (preferred && roots.find((r) => r.path === preferred)?.path) ?? roots[0]?.path ?? null;
		if (next === root) return;
		root = next;
		folders = {};
		expanded = { '': true };
		focusedPath = null;
		if (next) void load('');
	}

	async function load(path: string) {
		if (!root) return;
		const at = root;
		folders[path] = { entries: folders[path]?.entries ?? [], truncated: false, total: 0, error: null, loading: true };
		const out = await listFolder(machineId, session, at, path);
		if (root !== at) return; // Switched folders meanwhile.
		folders[path] = out.ok
			? { entries: out.value.entries, truncated: out.value.truncated, total: out.value.total, error: null, loading: false }
			: { entries: [], truncated: false, total: 0, error: out.message, loading: false };
	}

	/** Re-reads every open folder, keeping what's expanded. */
	function refresh() {
		void loadRoots();
		for (const path of Object.keys(expanded)) if (expanded[path]) void load(path);
	}

	$effect(() => {
		void session;
		untrack(() => void loadRoots());
	});
	// Follow the workspace: when the preferred folder changes (another space), switch to it.
	// Only that change counts; loading folders or picking one by hand must not undo the choice.
	$effect(() => {
		const p = preferredRoot;
		untrack(() => roots.length && pickRoot(p));
	});

	function toggle(entry: FileEntry) {
		if (expanded[entry.path]) {
			expanded[entry.path] = false;
			return;
		}
		expanded[entry.path] = true;
		if (!folders[entry.path] || folders[entry.path]!.error) void load(entry.path);
	}

	function activate(entry: FileEntry) {
		focusedPath = entry.path;
		if (isFolder(entry)) toggle(entry);
		else if (root && entry.type !== 'other' && entry.target !== 'broken' && entry.target !== 'outside') onopen({ root, path: entry.path });
	}

	type Row =
		| { kind: 'entry'; entry: FileEntry; depth: number }
		| { kind: 'status'; path: string; depth: number; text: string; loading?: boolean; error?: boolean };

	/** The visible rows: open folders expanded in order; a filter keeps matches and their folders. */
	const rows = $derived.by((): Row[] => {
		const out: Row[] = [];
		const needle = filter.trim().toLowerCase();
		const visible = (e: FileEntry) => showHidden || !e.hidden;
		const matches = (e: FileEntry): boolean => {
			if (!visible(e)) return false;
			if (!needle || e.name.toLowerCase().includes(needle)) return true;
			return isFolder(e) && !!folders[e.path]?.entries.some(matches);
		};
		const walk = (path: string, depth: number) => {
			const folder = folders[path];
			if (!folder) return;
			if (folder.error) out.push({ kind: 'status', path: `${path}#error`, depth, text: folder.error, error: true });
			if (folder.loading && !folder.entries.length) out.push({ kind: 'status', path: `${path}#loading`, depth, text: 'Loading…', loading: true });
			for (const entry of folder.entries) {
				if (!matches(entry)) continue;
				out.push({ kind: 'entry', entry, depth });
				if (isFolder(entry) && (expanded[entry.path] || (needle && folders[entry.path]))) walk(entry.path, depth + 1);
			}
			if (folder.truncated)
				out.push({ kind: 'status', path: `${path}#more`, depth, text: `Showing ${folder.entries.length} of ${folder.total} entries` });
		};
		walk('', 0);
		return out;
	});

	const entryRows = $derived(rows.filter((r): r is Extract<Row, { kind: 'entry' }> => r.kind === 'entry'));

	function focusRow(path: string) {
		focusedPath = path;
		queueMicrotask(() => tree?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus());
	}

	/** Tree keyboard: arrows move and open/close, Home/End jump, Enter opens. */
	function onTreeKey(e: KeyboardEvent) {
		const i = entryRows.findIndex((r) => r.entry.path === focusedPath);
		const row = entryRows[i];
		const go = (j: number) => {
			const next = entryRows[Math.max(0, Math.min(entryRows.length - 1, j))];
			if (next) focusRow(next.entry.path);
		};
		switch (e.key) {
			case 'ArrowDown':
				go(i + 1);
				break;
			case 'ArrowUp':
				go(i < 0 ? 0 : i - 1);
				break;
			case 'Home':
				go(0);
				break;
			case 'End':
				go(entryRows.length - 1);
				break;
			case 'ArrowRight':
				if (row && isFolder(row.entry)) {
					if (!expanded[row.entry.path]) toggle(row.entry);
					else go(i + 1);
				}
				break;
			case 'ArrowLeft':
				if (row && isFolder(row.entry) && expanded[row.entry.path]) toggle(row.entry);
				else if (row) {
					const parent = row.entry.path.split('/').slice(0, -1).join('/');
					if (parent) focusRow(parent);
				}
				break;
			case 'Enter':
			case ' ':
				if (row) activate(row.entry);
				break;
			default:
				return;
		}
		e.preventDefault();
	}

	const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|php|swift|scala|lua|sql|html|css|scss|less|xml|yaml|yml|toml|ini|conf)$/i;
	function iconFor(e: FileEntry, open: boolean): Component {
		if (e.type === 'symlink') return e.target === 'directory' ? FolderSymlinkIcon : FileSymlinkIcon;
		if (e.type === 'directory') return open ? FolderOpenIcon : FolderIcon;
		const name = e.name.toLowerCase();
		if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/.test(name)) return FileImageIcon;
		if (/\.json$/.test(name)) return FileJsonIcon;
		if (/\.(sh|bash|zsh|fish)$/.test(name)) return FileTerminalIcon;
		if (/\.(md|mdx|txt|rst|log)$/.test(name) || name === 'readme') return FileTextIcon;
		if (CODE.test(name)) return FileCodeIcon;
		return FileIcon;
	}

	const rootLabel = (r: FileRoot) => `${r.label} · ${r.path}`;
</script>

<div class="flex size-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
	<div class="flex h-10 shrink-0 items-center gap-1 border-b px-2">
		<span class="me-auto text-xs font-medium text-muted-foreground">Files</span>
		<Button size="icon-sm" variant="ghost" class="size-7" aria-label="Collapse all" title="Collapse all" onclick={() => (expanded = { '': true })}>
			<ChevronsDownUpIcon />
		</Button>
		<Button
			size="icon-sm"
			variant="ghost"
			class="size-7"
			aria-pressed={showHidden}
			aria-label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
			title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
			onclick={() => (showHidden = !showHidden)}
		>
			{#if showHidden}<EyeIcon />{:else}<EyeOffIcon />{/if}
		</Button>
		<Button size="icon-sm" variant="ghost" class="size-7" aria-label="Refresh" title="Refresh" onclick={refresh}><RefreshCwIcon /></Button>
		<Button size="icon-sm" variant="ghost" class="size-7" aria-label="Close files" title="Close files" onclick={onclose}><XIcon /></Button>
	</div>

	<div class="flex shrink-0 flex-col gap-1.5 border-b p-2">
		{#if roots.length > 1}
			<Select.Root type="single" value={root ?? undefined} onValueChange={(v) => pickRoot(v)}>
				<Select.Trigger size="sm" class="w-full min-w-0" aria-label="Folder">
					<span class="truncate">{roots.find((r) => r.path === root)?.label ?? 'Choose a folder'}</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each roots as r (r.path)}
							<Select.Item value={r.path} label={rootLabel(r)}>
								<span class="flex min-w-0 flex-col">
									<span class="truncate">{r.label}</span>
									<span class="truncate font-mono text-xs text-muted-foreground">{r.path}</span>
								</span>
							</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		{/if}
		{#if root}<p class="truncate font-mono text-xs text-muted-foreground" title={root}>{root}</p>{/if}
		<Input bind:value={filter} class="h-7 text-xs" placeholder="Filter open folders" aria-label="Filter files" />
	</div>

	{#if rootsError}
		<p class="p-3 text-sm text-muted-foreground">{rootsError}</p>
	{:else if !root}
		<p class="p-3 text-sm text-muted-foreground">No folders to show for this session yet.</p>
	{:else}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={tree}
			role="tree"
			aria-label="Files in {root}"
			tabindex="-1"
			class="min-h-0 flex-1 overflow-auto py-1 text-sm"
			onkeydown={onTreeKey}
		>
			{#each rows as row (row.kind === 'entry' ? row.entry.path : row.path)}
				{#if row.kind === 'status'}
					<div class={cn('flex items-center gap-2 py-1 pe-2 text-xs', row.error ? 'text-destructive' : 'text-muted-foreground')} style:padding-inline-start="{row.depth * 14 + 28}px">
						{#if row.loading}<Spinner class="size-3" />{/if}
						<span class="truncate">{row.text}</span>
					</div>
				{:else}
					{@const e = row.entry}
					{@const folder = isFolder(e)}
					{@const open = !!expanded[e.path]}
					{@const Icon = iconFor(e, open)}
					{@const current = !folder && selected?.root === root && selected.path === e.path}
					<ContextMenu.Root>
						<ContextMenu.Trigger>
							{#snippet child({ props })}
								<div
									{...props}
									role="treeitem"
									aria-level={row.depth + 1}
									aria-expanded={folder ? open : undefined}
									aria-selected={current}
									tabindex={focusedPath === e.path || (!focusedPath && row === entryRows[0]) ? 0 : -1}
									data-path={e.path}
									class={cn(
										'flex h-7 cursor-default items-center gap-1.5 pe-2 outline-none select-none hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-sidebar-ring',
										current && 'bg-sidebar-accent text-sidebar-accent-foreground',
										(e.ignored || e.hidden) && 'text-muted-foreground'
									)}
									style:padding-inline-start="{row.depth * 14 + 8}px"
									title={e.target === 'outside' ? 'This link points outside the folder' : e.target === 'broken' ? 'Broken link' : e.name}
									onclick={() => activate(e)}
									onfocus={() => (focusedPath = e.path)}
									onkeydown={() => {
										// Keys are handled by the tree (arrows, Enter), which moves focus between items.
									}}
								>
									<ChevronRightIcon
										class={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !folder && 'invisible', open && 'rotate-90')}
										aria-hidden="true"
									/>
									<Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
									<span class={cn('truncate', e.type === 'symlink' && 'italic', (e.target === 'broken' || e.target === 'outside') && 'line-through')}>{e.name}</span>
									{#if folders[e.path]?.loading}<Spinner class="ms-auto size-3" />{:else if !folder && e.type === 'file'}<span class="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatSize(e.size)}</span>{/if}
								</div>
							{/snippet}
						</ContextMenu.Trigger>
						<ContextMenu.Content class="w-56">
							<ContextMenu.Group>
								{#if folder}
									<ContextMenu.Item onSelect={() => toggle(e)}>{open ? 'Collapse' : 'Expand'}</ContextMenu.Item>
									<ContextMenu.Item onSelect={() => root && onterminal(joinPath(root, e.path))}><SquareTerminalIcon />Open terminal here</ContextMenu.Item>
									<ContextMenu.Item onSelect={() => load(e.path)}><RefreshCwIcon />Refresh</ContextMenu.Item>
								{:else}
									<ContextMenu.Item onSelect={() => activate(e)}>Open</ContextMenu.Item>
								{/if}
							</ContextMenu.Group>
							<ContextMenu.Separator />
							<ContextMenu.Group>
								<ContextMenu.Item onSelect={() => root && copyText(joinPath(root, e.path))}><CopyIcon />Copy path</ContextMenu.Item>
								<ContextMenu.Item onSelect={() => copyText(e.path)}><CopyIcon />Copy relative path</ContextMenu.Item>
							</ContextMenu.Group>
						</ContextMenu.Content>
					</ContextMenu.Root>
				{/if}
			{:else}
				{#if !folders['']?.loading}<p class="px-3 py-2 text-sm text-muted-foreground">{filter ? 'Nothing matches in the open folders.' : 'This folder is empty.'}</p>{/if}
			{/each}
		</div>
	{/if}
</div>
