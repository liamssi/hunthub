<script lang="ts">
	// A session as a web workspace, laid out like Herdr's own UI: a sidebar with
	// the session's spaces (workspaces) and agents, a tab bar for the selected
	// space, and its panes framed the way Herdr splits them, each a live
	// terminal. Recently visited tabs stay connected so switching is instant.
	// Dividers can be dragged (the ratio is applied in Herdr); maximizing a pane
	// only changes this view.
	import type { Component, Snippet } from 'svelte';
	import { tick, untrack } from 'svelte';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import FileCodeIcon from '@lucide/svelte/icons/file-code';
	import FolderTreeIcon from '@lucide/svelte/icons/folder-tree';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { toast } from 'svelte-sonner';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PinIcon from '@lucide/svelte/icons/pin';
	import PinOffIcon from '@lucide/svelte/icons/pin-off';
	import SquareSplitHorizontalIcon from '@lucide/svelte/icons/square-split-horizontal';
	import SquareSplitVerticalIcon from '@lucide/svelte/icons/square-split-vertical';
	import XIcon from '@lucide/svelte/icons/x';
	import BotIcon from '@lucide/svelte/icons/bot';
	import Columns2Icon from '@lucide/svelte/icons/columns-2';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import KeyboardIcon from '@lucide/svelte/icons/keyboard';
	import ListTreeIcon from '@lucide/svelte/icons/list-tree';
	import Rows2Icon from '@lucide/svelte/icons/rows-2';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import Minimize2Icon from '@lucide/svelte/icons/minimize-2';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import type { AgentStatus, AgentView, PaneRect, SessionView, SplitView, TabView, WorkspaceView } from '@hunthub/shared/machines';
	import StatusBadge from '$lib/components/agents/status-badge.svelte';
	import ConfirmDialog from '$lib/components/console/confirm-dialog.svelte';
	import FormDialog, { type FormField } from '$lib/components/console/form-dialog.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { consoleCall, consoleRequest } from '$lib/console';
	import { prefetchHistory } from '$lib/pane-history';
	import { appearance, themeColors, workspaceVars } from '$lib/terminal-appearance.svelte';
	import { cn } from '$lib/utils.js';
	import FileExplorer, { type OpenFile } from './file-explorer.svelte';
	import FileViewer from './file-viewer.svelte';
	import HistoryPanel from './history-panel.svelte';
	import TerminalView, { type TerminalMode, type TerminalState, type TerminalTransport } from './terminal-view.svelte';

	let {
		machineId,
		session,
		mode,
		transport,
		header,
		controls,
		active = true,
		jump = null
	}: {
		machineId: string;
		session: SessionView;
		mode: TerminalMode;
		transport: TerminalTransport;
		/** Top of the sidebar (session name, navigation). */
		header?: Snippet;
		/** Right end of the tab bar (view switch, menus). */
		controls?: Snippet;
		/** Whether this session is the one shown (hidden ones stay connected but ignore shortcuts). */
		active?: boolean;
		/** Go to a pane (a new object each time asks again). */
		jump?: { paneId: string } | null;
	} = $props();

	// The workspace takes the terminal theme's colors (set inline: the .dark class would override inherited ones).
	const themeStyle = $derived(
		Object.entries(workspaceVars(appearance.theme))
			.map(([k, v]) => `${k}: ${v}`)
			.join('; ')
	);

	/** How many tabs stay connected in the background. */
	const KEEP_ALIVE = 6;
	const call = (label: string, method: string, params: Record<string, unknown>) =>
		consoleCall(machineId, session.name, label, method, params);

	// --- Selection: a space, and a remembered tab per space ---------------------
	let selectedSpaceId = $state<string | null>(null);
	let tabBySpace = $state<Record<string, string>>({});
	const space = $derived<WorkspaceView | undefined>(
		session.workspaces.find((w) => w.id === selectedSpaceId) ?? session.workspaces[0]
	);
	const tab = $derived<TabView | undefined>(space?.tabs.find((t) => t.id === tabBySpace[space.id]) ?? space?.tabs[0]);
	const tabs = $derived(session.workspaces.flatMap((w) => w.tabs));

	let visited = $state<string[]>([]);
	$effect(() => {
		const id = tab?.id;
		if (!id) return;
		const known = new Set(tabs.map((t) => t.id));
		// Reads its own previous value untracked, or it would re-run itself forever.
		const previous = untrack(() => visited);
		const next = [id, ...previous.filter((v) => v !== id && known.has(v))].slice(0, KEEP_ALIVE);
		if (next.join() !== previous.join()) visited = next;
	});
	// Rendered in a stable order so switching never remounts (reconnects) a terminal.
	const alive = $derived(tabs.filter((t) => visited.includes(t.id)));

	// --- Sidebar ----------------------------------------------------------------
	const SIDEBAR_KEY = 'hunthub.workspace.sidebar';
	const SIDEBAR_WIDTH_KEY = 'hunthub.workspace.sidebarWidth';
	const SIDEBAR_LIST_KEY = 'hunthub.workspace.sidebarList';
	const DEFAULT_WIDTH = 240;
	const clampWidth = (w: number) => Math.min(480, Math.max(180, Math.round(w)));
	let sidebarOpen = $state(true);
	let sidebarWidth = $state(DEFAULT_WIDTH);
	/** "separate": spaces and agents in two lists, as in Herdr; "nested": each space's agents under it. */
	let sidebarList = $state<'separate' | 'nested'>('separate');
	$effect(() => {
		try {
			sidebarWidth = clampWidth(Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || DEFAULT_WIDTH);
			sidebarList = localStorage.getItem(SIDEBAR_LIST_KEY) === 'nested' ? 'nested' : 'separate';
		} catch {
			// Only a convenience.
		}
	});
	const remember = (key: string, value: string) => {
		try {
			localStorage.setItem(key, value);
		} catch {
			// Only a convenience.
		}
	};
	function setSidebarWidth(w: number) {
		sidebarWidth = clampWidth(w);
		remember(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
	}
	function startSidebarResize(e: PointerEvent) {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const startX = e.clientX;
		const startWidth = sidebarWidth;
		const move = (ev: PointerEvent) => (sidebarWidth = clampWidth(startWidth + ev.clientX - startX));
		const end = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', end);
			el.removeEventListener('pointercancel', end);
			setSidebarWidth(sidebarWidth);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', end);
		el.addEventListener('pointercancel', end);
	}
	function sidebarResizeKey(e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		setSidebarWidth(sidebarWidth + (e.key === 'ArrowRight' ? 16 : -16));
	}
	$effect(() => {
		try {
			sidebarOpen = localStorage.getItem(SIDEBAR_KEY) !== 'closed';
		} catch {
			// Only a convenience.
		}
	});
	function setSidebar(open: boolean) {
		sidebarOpen = open;
		try {
			localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed');
		} catch {
			// Only a convenience.
		}
	}

	/** Agents that need attention first. */
	const order: Record<AgentStatus, number> = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 };
	const byAttention = (a: AgentView, b: AgentView) => order[a.status] - order[b.status] || a.name.localeCompare(b.name);
	const agents = $derived(session.workspaces.flatMap((w) => w.agents).sort(byAttention));

	// --- Panes ------------------------------------------------------------------
	let activePane = $state<Record<string, string>>({});
	let maximized = $state<Record<string, string | null>>({});
	let states = $state<Record<string, TerminalState>>({});
	let attempts = $state<Record<string, number>>({});
	// Pinned prompt: scrolling up opens the pane's history above the live terminal,
	// so its bottom (the prompt, or an agent's input box) stays in view.
	const PIN_KEY = 'hunthub.workspace.pinPrompt';
	let pinDefault = $state(true);
	$effect(() => {
		try {
			pinDefault = localStorage.getItem(PIN_KEY) !== 'off';
		} catch {
			// Only a convenience.
		}
	});
	let pinned = $state<Record<string, boolean>>({});
	let historyOpen = $state<Record<string, boolean>>({});
	/** Panes whose history opened for searching (focuses the search box). */
	let historySearch = $state<Record<string, boolean>>({});
	const isPinned = (paneId: string) => pinned[paneId] ?? pinDefault;
	function togglePin(paneId: string) {
		const next = !isPinned(paneId);
		pinned[paneId] = next;
		pinDefault = next;
		try {
			localStorage.setItem(PIN_KEY, next ? 'on' : 'off');
		} catch {
			// Only a convenience.
		}
		if (!next) historyOpen[paneId] = false;
	}
	// History is fetched in the background for the panes on screen, so scrolling up is instant.
	const shownPaneIds = $derived(tab ? tab.panes.map((p) => p.id).join(',') : '');
	$effect(() => {
		if (!active || !shownPaneIds) return;
		const paneIds = shownPaneIds.split(',');
		const warm = () => paneIds.forEach((id, i) => setTimeout(() => prefetchHistory(machineId, session.name, id), i * 150));
		warm();
		const timer = setInterval(warm, 15_000);
		return () => clearInterval(timer);
	});

	function closeHistory(paneId: string) {
		historyOpen[paneId] = false;
		historySearch[paneId] = false;
		document.querySelector<HTMLTextAreaElement>(`[data-pane="${CSS.escape(paneId)}"] textarea`)?.focus();
	}
	/** Live rows left visible under the history panel. */
	const LIVE_ROWS = 6;
	/** Each pane's live terminal (the history panel reads the rows still visible under it). */
	let views = $state<Record<string, TerminalView | undefined>>({});
	/** The pinned history panel ends exactly where the live rows below it begin. */
	function historyHeight(paneId: string): string {
		void appearance.size; // Re-measured when the font size changes.
		const top = views[paneId]?.bottomRowsTop(LIVE_ROWS);
		return top ? `${top}px` : `calc(100% - ${Math.round(appearance.size * 1.1 * LIVE_ROWS) + 18}px)`;
	}

	/** Per pane: watch instead of control, or take control over from its current controller. */
	let paneMode = $state<Record<string, 'watch' | 'takeover'>>({});

	/** Herdr allows one controller per pane (CLI transport); this is how it refuses a second. */
	const isLocked = (st: TerminalState | undefined) => st?.phase === 'closed' && /already has an attached client/.test(st.reason ?? '');
	const setPaneMode = (paneId: string, m: 'watch' | 'takeover' | null) => {
		if (m) paneMode[paneId] = m;
		else delete paneMode[paneId];
		reconnect(paneId);
	};

	function selectTab(spaceId: string, tabId: string) {
		activeFile = null;
		selectedSpaceId = spaceId;
		tabBySpace[spaceId] = tabId;
	}

	async function focusPane(tabId: string, paneId: string) {
		activePane[tabId] = paneId;
		await tick();
		document.querySelector<HTMLTextAreaElement>(`[data-pane="${CSS.escape(paneId)}"] textarea`)?.focus();
	}

	function jumpToAgent(agent: AgentView) {
		const w = session.workspaces.find((x) => x.id === agent.workspaceId);
		const t = w?.tabs.find((x) => x.panes.some((p) => p.id === agent.paneId));
		if (!w || !t) return;
		selectTab(w.id, t.id);
		if (maximized[t.id] && maximized[t.id] !== agent.paneId) maximized[t.id] = null;
		void focusPane(t.id, agent.paneId);
	}

	// Going to a pane from outside (a pin, the explorer): its space and tab, then the keyboard.
	$effect(() => {
		const target = jump;
		if (!target) return;
		untrack(() => {
			for (const w of session.workspaces) {
				const t = w.tabs.find((x) => x.panes.some((p) => p.id === target.paneId));
				if (!t) continue;
				selectTab(w.id, t.id);
				if (maximized[t.id] && maximized[t.id] !== target.paneId) maximized[t.id] = null;
				void focusWhenReady(t.id, target.paneId);
				return;
			}
		});
	});

	/** Pane rectangles for a tab: Herdr's layout, or a plain vertical stack if it isn't known. */
	function rectsFor(t: TabView): PaneRect[] {
		const layout = t.layout;
		if (layout?.zoomed) {
			const zoomed = layout.focusedPaneId ?? t.panes[0]?.id;
			return zoomed ? [{ paneId: zoomed, x: 0, y: 0, width: 1, height: 1 }] : [];
		}
		const known = new Set(t.panes.map((p) => p.id));
		if (layout && layout.panes.length && layout.panes.every((r) => known.has(r.paneId))) return layout.panes;
		const n = t.panes.length;
		return t.panes.map((p, i) => ({ paneId: p.id, x: 0, y: i / n, width: 1, height: 1 / n }));
	}

	const tabAgent = (t: TabView) => t.panes.find((p) => p.agent)?.agent ?? null;
	const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
	const folder = (cwd: string | null) => (cwd ? cwd.replace(/\/+$/, '').split('/').pop() || '/' : '');
	const reconnect = (paneId: string) => (attempts[paneId] = (attempts[paneId] ?? 0) + 1);
	const toggleMaximize = (tabId: string, paneId: string) =>
		(maximized[tabId] = maximized[tabId] === paneId ? null : paneId);

	// --- Actions in place -------------------------------------------------------
	// Everything here asks Herdr for a change; the new state arrives through live updates.
	type Action = { label: string; icon?: Component; shortcut?: string; destructive?: boolean; run: () => void };

	let form = $state<{ open: boolean; title: string; description?: string; fields: FormField[]; submitLabel: string; onSubmit: (v: Record<string, string>) => Promise<boolean> }>({
		open: false,
		title: '',
		fields: [],
		submitLabel: '',
		onSubmit: async () => true
	});
	let confirm = $state<{ open: boolean; title: string; description: string; confirmLabel: string; onConfirm: () => void }>({
		open: false,
		title: '',
		description: '',
		confirmLabel: '',
		onConfirm: () => {}
	});
	const openForm = (f: Omit<typeof form, 'open'>) => (form = { ...f, open: true });
	const openConfirm = (c: Omit<typeof confirm, 'open'>) => (confirm = { ...c, open: true });
	let shortcutsOpen = $state(false);

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	/** Workspace shortcuts use Alt+Shift, which terminal programs rarely need. */
	const keys = (k: string) => (isMac ? `⌥⇧${k}` : `Alt+Shift+${k}`);

	/** Focuses a pane once its terminal exists (a new pane appears with the next live update). */
	async function focusWhenReady(tabId: string, paneId: string) {
		for (let i = 0; i < 30; i++) {
			const el = document.querySelector<HTMLTextAreaElement>(`[data-pane="${CSS.escape(paneId)}"] textarea`);
			if (el) {
				activePane[tabId] = paneId;
				el.focus();
				return;
			}
			await new Promise((r) => setTimeout(r, 100));
		}
	}

	async function splitPane(tabId: string, paneId: string, direction: 'right' | 'down') {
		const out = await consoleRequest(machineId, session.name, 'Split pane', 'pane.split', { target_pane_id: paneId, direction });
		const created = out.ok ? (out.result as { pane?: { pane_id?: string } } | null)?.pane?.pane_id : undefined;
		maximized[tabId] = null;
		if (created) void focusWhenReady(tabId, created);
	}

	const paneName = (t: TabView, paneId: string) => t.panes.find((p) => p.id === paneId)?.agent?.name ?? 'this shell';
	const closePane = (t: TabView, paneId: string) =>
		openConfirm({
			title: 'Close pane?',
			description: `Closing it stops ${paneName(t, paneId)} and anything else running in it.`,
			confirmLabel: 'Close pane',
			onConfirm: () => void call('Close pane', 'pane.close', { pane_id: paneId })
		});

	async function newTab(spaceId: string) {
		const out = await consoleRequest(machineId, session.name, 'New tab', 'tab.create', { workspace_id: spaceId });
		const created = out.ok ? (out.result as { tab?: { tab_id?: string } } | null)?.tab?.tab_id : undefined;
		if (created) selectTab(spaceId, created);
	}
	const renameTab = (t: TabView) =>
		openForm({
			title: 'Rename tab',
			fields: [{ name: 'label', label: 'Name', value: t.label, required: true }],
			submitLabel: 'Rename',
			onSubmit: (v) => call('Rename tab', 'tab.rename', { tab_id: t.id, label: v.label })
		});
	const closeTab = (t: TabView) =>
		openConfirm({
			title: `Close tab ${t.label}?`,
			description: 'Its panes are closed, and anything running in them (including agents) is stopped.',
			confirmLabel: 'Close tab',
			onConfirm: () => void call('Close tab', 'tab.close', { tab_id: t.id })
		});

	const newSpace = () =>
		openForm({
			title: 'New space',
			description: 'A space is a Herdr workspace: its own tabs and panes, usually for one project.',
			fields: [
				{ name: 'label', label: 'Name', placeholder: 'recon' },
				{ name: 'cwd', label: 'Folder', placeholder: '/home/you/project', description: 'Where its first pane starts. Empty: Herdr default.' }
			],
			submitLabel: 'Create',
			onSubmit: async (v) => {
				const out = await consoleRequest(machineId, session.name, 'New space', 'workspace.create', {
					...(v.label && { label: v.label }),
					...(v.cwd && { cwd: v.cwd })
				});
				const created = out.ok ? (out.result as { workspace?: { workspace_id?: string } } | null)?.workspace?.workspace_id : undefined;
				if (created) selectedSpaceId = created;
				return out.ok;
			}
		});
	const renameSpace = (w: WorkspaceView) =>
		openForm({
			title: 'Rename space',
			fields: [{ name: 'label', label: 'Name', value: w.label, required: true }],
			submitLabel: 'Rename',
			onSubmit: (v) => call('Rename space', 'workspace.rename', { workspace_id: w.id, label: v.label })
		});
	const newWorktree = (w: WorkspaceView) =>
		openForm({
			title: `New worktree of ${w.worktree?.repoName ?? w.label}`,
			description: 'Creates a git worktree on a new or existing branch and opens it as a space.',
			fields: [
				{ name: 'branch', label: 'Branch', placeholder: 'feature-x', required: true },
				{ name: 'base', label: 'Start from', placeholder: 'main', description: 'For a new branch; empty: the current HEAD.' }
			],
			submitLabel: 'Create worktree',
			onSubmit: (v) =>
				call('New worktree', 'worktree.create', { cwd: w.worktree!.repoRoot, branch: v.branch, ...(v.base && { base: v.base }) })
		});
	const removeWorktree = (w: WorkspaceView, force = false) =>
		openConfirm({
			title: force ? `Remove worktree ${w.label} anyway?` : `Remove worktree ${w.label}?`,
			description: force
				? 'Uncommitted changes in it are lost. The branch itself is kept.'
				: 'Its space is closed and the checkout is removed from disk. The branch is kept.',
			confirmLabel: force ? 'Remove anyway' : 'Remove worktree',
			onConfirm: async () => {
				const ok = await call('Remove worktree', 'worktree.remove', { workspace_id: w.id, ...(force && { force: true }) });
				// A dirty checkout is refused; offer to force it.
				if (!ok && !force) removeWorktree(w, true);
			}
		});
	const closeSpace = (w: WorkspaceView) =>
		openConfirm({
			title: `Close space ${w.label}?`,
			description: 'Its tabs and panes are closed, and anything running in them (including agents) is stopped.',
			confirmLabel: 'Close space',
			onConfirm: () => void call('Close space', 'workspace.close', { workspace_id: w.id })
		});

	// Menus are lists of groups, shared by right-click and ⋯ menus.
	function paneActions(t: TabView, paneId: string): Action[][] {
		const max = maximized[t.id] === paneId;
		return [
			[
				{ label: 'Split right', icon: SquareSplitHorizontalIcon, shortcut: keys('\\'), run: () => void splitPane(t.id, paneId, 'right') },
				{ label: 'Split down', icon: SquareSplitVerticalIcon, shortcut: keys('-'), run: () => void splitPane(t.id, paneId, 'down') },
				{ label: 'Show history', icon: HistoryIcon, shortcut: keys('H'), run: () => (historyOpen[paneId] = true) },
				{ label: 'Browse files here', icon: FolderTreeIcon, run: () => browseHere(paneId) },
				{
					label: 'Search in history',
					icon: SearchIcon,
					shortcut: keys('F'),
					run: () => {
						historySearch[paneId] = true;
						historyOpen[paneId] = true;
					}
				},
				...(rectsFor(t).length > 1
					? [{ label: max ? 'Restore layout' : 'Maximize', icon: max ? Minimize2Icon : Maximize2Icon, shortcut: keys('Z'), run: () => toggleMaximize(t.id, paneId) }]
					: [])
			],
			[{ label: 'Close pane', icon: XIcon, shortcut: keys('X'), destructive: true, run: () => closePane(t, paneId) }]
		];
	}
	function tabActions(w: WorkspaceView, t: TabView): Action[][] {
		return [
			[
				{ label: 'New tab', icon: PlusIcon, shortcut: keys('T'), run: () => void newTab(w.id) },
				{ label: 'Rename tab', icon: PencilIcon, run: () => renameTab(t) }
			],
			[{ label: 'Close tab', icon: XIcon, destructive: true, run: () => closeTab(t) }]
		];
	}
	function spaceActions(w: WorkspaceView): Action[][] {
		return [
			[
				{ label: 'New tab', icon: PlusIcon, run: () => void newTab(w.id) },
				{ label: 'Rename space', icon: PencilIcon, run: () => renameSpace(w) },
				...(w.worktree ? [{ label: 'New worktree', icon: GitBranchIcon, run: () => newWorktree(w) }] : [])
			],
			[
				...(w.worktree?.linked ? [{ label: 'Remove worktree', icon: GitBranchIcon, destructive: true, run: () => removeWorktree(w) }] : []),
				{ label: 'Close space', icon: XIcon, destructive: true, run: () => closeSpace(w) }
			]
		];
	}

	// --- Files: a read-only explorer on the right, files open over the panes ----
	const FILES_KEY = 'hunthub.workspace.files';
	const FILES_WIDTH_KEY = 'hunthub.workspace.filesWidth';
	let filesOpen = $state(false);
	let filesWidth = $state(300);
	const clampFilesWidth = (w: number) => Math.min(640, Math.max(220, Math.round(w)));
	$effect(() => {
		try {
			filesOpen = localStorage.getItem(FILES_KEY) === 'open';
			filesWidth = clampFilesWidth(Number(localStorage.getItem(FILES_WIDTH_KEY)) || 300);
		} catch {
			// Only a convenience.
		}
	});
	function setFilesOpen(open: boolean) {
		filesOpen = open;
		remember(FILES_KEY, open ? 'open' : 'closed');
	}
	// Open files are tabs next to the terminal tabs (remembered per session in this browser).
	const fileKey = (f: OpenFile) => `${f.root}\n${f.path}`;
	const FILE_TABS_KEY = $derived(`hunthub.workspace.fileTabs:${machineId}:${session.name}`);
	let fileTabs = $state<OpenFile[]>([]);
	let activeFile = $state<string | null>(null);
	const openFile = $derived(fileTabs.find((f) => fileKey(f) === activeFile) ?? null);
	$effect(() => {
		const key = FILE_TABS_KEY;
		untrack(() => {
			try {
				const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
				fileTabs = Array.isArray(saved) ? saved.filter((f) => typeof f?.root === 'string' && typeof f?.path === 'string') : [];
			} catch {
				fileTabs = [];
			}
			activeFile = null;
		});
	});
	/** Shows a file tab and gives its viewer the keyboard (Esc, Ctrl+F). */
	async function showFile(key: string) {
		activeFile = key;
		await tick();
		document.querySelector<HTMLElement>(`[data-file-tab="${CSS.escape(key)}"] [role=region]`)?.focus({ preventScroll: true });
	}
	function saveFileTabs() {
		remember(FILE_TABS_KEY, JSON.stringify(fileTabs));
	}
	function openFileTab(f: OpenFile) {
		if (!fileTabs.some((x) => fileKey(x) === fileKey(f))) {
			fileTabs = [...fileTabs, f];
			saveFileTabs();
		}
		void showFile(fileKey(f));
	}
	function closeFileTab(f: OpenFile) {
		const i = fileTabs.findIndex((x) => fileKey(x) === fileKey(f));
		if (i < 0) return;
		fileTabs = fileTabs.filter((_, j) => j !== i);
		saveFileTabs();
		if (activeFile === fileKey(f)) {
			// Show the neighbouring file, or go back to the terminals.
			const next = fileTabs[i] ?? fileTabs[i - 1];
			activeFile = next ? fileKey(next) : null;
			if (!next) backToTerminals();
		}
	}
	function backToTerminals() {
		activeFile = null;
		const paneId = tab ? activePane[tab.id] : undefined;
		if (tab && paneId) void focusPane(tab.id, paneId);
	}
	/** A folder asked for explicitly ("Browse files here"); otherwise the explorer follows the space. */
	let browseRoot = $state<string | null>(null);
	const preferredRoot = $derived.by(() => {
		if (browseRoot) return browseRoot;
		if (space?.worktree) return space.worktree.checkoutPath;
		const paneId = tab ? activePane[tab.id] : undefined;
		const pane = tab?.panes.find((p) => p.id === paneId) ?? space?.tabs[0]?.panes[0];
		return pane?.cwd ?? null;
	});
	// Moving to another space follows it again.
	$effect(() => {
		void space?.id;
		browseRoot = null;
	});
	function browseHere(paneId: string) {
		const cwd = tabs.flatMap((t) => t.panes).find((p) => p.id === paneId)?.cwd;
		browseRoot = cwd ?? null;
		setFilesOpen(true);
	}
	async function terminalIn(path: string) {
		if (!space) return;
		const out = await consoleRequest(machineId, session.name, 'Open terminal', 'tab.create', { workspace_id: space.id, cwd: path });
		const created = out.ok ? (out.result as { tab?: { tab_id?: string } } | null)?.tab?.tab_id : undefined;
		if (created) selectTab(space.id, created);
	}
	function startFilesResize(e: PointerEvent) {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const startX = e.clientX;
		const startWidth = filesWidth;
		const move = (ev: PointerEvent) => (filesWidth = clampFilesWidth(startWidth - (ev.clientX - startX)));
		const end = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', end);
			el.removeEventListener('pointercancel', end);
			remember(FILES_WIDTH_KEY, String(filesWidth));
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', end);
		el.addEventListener('pointercancel', end);
	}

	// --- Attention: agents that need you, or finished --------------------------
	const needsYou = $derived(agents.filter((a) => a.status === 'blocked'));
	const finished = $derived(agents.filter((a) => a.status === 'done'));

	/** Cycles through agents that need you first, then finished ones. */
	function nextAttention() {
		const list = [...needsYou, ...finished];
		if (!list.length) return;
		const current = tab ? activePane[tab.id] : undefined;
		const i = list.findIndex((a) => a.paneId === current);
		jumpToAgent(list[(i + 1) % list.length]!);
	}

	/** Whether you are looking at this pane right now. */
	const watching = (paneId: string) =>
		document.hasFocus() && !!tab && tab.panes.some((p) => p.id === paneId) && activePane[tab.id] === paneId;

	// A toast when an agent starts needing you or finishes, unless you're looking at it.
	const lastStatus = new Map<string, AgentStatus>();
	let primed = false;
	$effect(() => {
		const list = agents;
		untrack(() => {
			for (const a of list) {
				const previous = lastStatus.get(a.paneId);
				lastStatus.set(a.paneId, a.status);
				if (!primed || !previous || previous === a.status || watching(a.paneId)) continue;
				const action = { label: 'Go', onClick: () => jumpToAgent(a) };
				if (a.status === 'blocked') toast.warning(`${a.name} needs you`, { description: a.workspaceLabel, action });
				else if (a.status === 'done') toast.success(`${a.name} finished`, { description: a.workspaceLabel, action });
			}
			primed = true;
		});
	});

	// --- Go to… switcher ---------------------------------------------------------
	let switcherOpen = $state(false);
	const go = (fn: () => void) => {
		switcherOpen = false;
		fn();
	};
	function openTab(w: WorkspaceView, t: TabView) {
		selectTab(w.id, t.id);
		const paneId = activePane[t.id] ?? rectsFor(t)[0]?.paneId;
		if (paneId) void focusWhenReady(t.id, paneId);
	}
	function openPane(w: WorkspaceView, t: TabView, paneId: string) {
		selectTab(w.id, t.id);
		if (maximized[t.id] && maximized[t.id] !== paneId) maximized[t.id] = null;
		void focusWhenReady(t.id, paneId);
	}
	const paneLabel = (p: TabView['panes'][number]) => p.agent?.name ?? 'Shell';

	// --- Keyboard: Alt+Shift shortcuts, taken before the terminal sees them -------
	function paneInDirection(t: TabView, from: string, dir: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') {
		const rects = rectsFor(t);
		const a = rects.find((r) => r.paneId === from);
		if (!a) return rects[0]?.paneId;
		const eps = 0.001;
		const cx = a.x + a.width / 2;
		const cy = a.y + a.height / 2;
		let best: { id: string; score: number } | null = null;
		for (const r of rects) {
			if (r.paneId === from) continue;
			const gap =
				dir === 'ArrowRight' ? r.x - (a.x + a.width) : dir === 'ArrowLeft' ? a.x - (r.x + r.width) : dir === 'ArrowDown' ? r.y - (a.y + a.height) : a.y - (r.y + r.height);
			if (gap < -eps) continue;
			// Nearest in the direction first, then best aligned.
			const offset = dir === 'ArrowLeft' || dir === 'ArrowRight' ? Math.abs(r.y + r.height / 2 - cy) : Math.abs(r.x + r.width / 2 - cx);
			const score = gap * 10 + offset;
			if (!best || score < best.score) best = { id: r.paneId, score };
		}
		return best?.id;
	}

	function onKeydown(e: KeyboardEvent) {
		if (!active) return;
		// Ctrl/Cmd+K opens the switcher, except in a terminal (where Ctrl+K deletes to the end of the line).
		if (e.code === 'KeyK' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
			if (e.target instanceof Element && e.target.closest('.xterm')) return;
			e.preventDefault();
			switcherOpen = !switcherOpen;
			return;
		}
		if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || form.open || confirm.open) return;
		if (e.code === 'KeyK') {
			e.preventDefault();
			e.stopPropagation();
			switcherOpen = !switcherOpen;
			return;
		}
		if (switcherOpen) return;
		const w = space;
		const t = tab;
		if (!w || !t) return;
		const paneId = activePane[t.id] ?? rectsFor(t)[0]?.paneId;
		const tabIndex = w.tabs.findIndex((x) => x.id === t.id);
		const code = e.code;
		if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown') {
			const next = paneId && paneInDirection(t, paneId, code);
			if (next) void focusPane(t.id, next);
		} else if (code === 'Backslash' && paneId) void splitPane(t.id, paneId, 'right');
		else if (code === 'Minus' && paneId) void splitPane(t.id, paneId, 'down');
		else if (code === 'KeyZ' && paneId && rectsFor(t).length > 1) toggleMaximize(t.id, paneId);
		else if (code === 'KeyX' && paneId) closePane(t, paneId);
		else if (code === 'KeyF' && paneId) {
			historySearch[paneId] = true;
			historyOpen[paneId] = true;
		} else if (code === 'KeyH' && paneId) {
			if (historyOpen[paneId]) closeHistory(paneId);
			else historyOpen[paneId] = true;
		}
		else if (code === 'KeyT') void newTab(w.id);
		else if (code === 'KeyN') newSpace();
		else if (code === 'KeyJ') nextAttention();
		else if (code === 'KeyE') setFilesOpen(!filesOpen);
		else if (code === 'BracketLeft' || code === 'BracketRight') {
			const next = w.tabs[(tabIndex + (code === 'BracketRight' ? 1 : -1) + w.tabs.length) % w.tabs.length];
			if (next) selectTab(w.id, next.id);
		} else if (/^Digit[1-9]$/.test(code)) {
			const next = w.tabs[Number(code.slice(5)) - 1];
			if (next) selectTab(w.id, next.id);
		} else if (code === 'Slash') shortcutsOpen = true;
		else return;
		e.preventDefault();
		e.stopPropagation();
	}

	const shortcutList = [
		['Go to… (space, tab, pane, agent)', 'K'],
		['Next agent that needs you', 'J'],
		['Move between panes', '←↑→↓'],
		['Split right', '\\'],
		['Split down', '-'],
		['Maximize or restore pane', 'Z'],
		['Close pane', 'X'],
		['Show or hide history', 'H'],
		['Show or hide files', 'E'],
		['Search in history', 'F'],
		['New tab', 'T'],
		['Previous / next tab', '[ ]'],
		['Go to tab 1–9', '1…9'],
		['New space', 'N'],
		['Show shortcuts', '/']
	] as const;

	// --- Dividers: a preview line follows the pointer; the ratio is sent on release.
	let drag = $state<{ tabId: string; key: string; ratio: number } | null>(null);
	const splitKey = (sp: SplitView) => sp.path.map((b) => (b ? 1 : 0)).join('') || 'root';
	const clampRatio = (r: number) => Math.min(0.95, Math.max(0.05, r));

	function ratioAt(e: PointerEvent, area: DOMRect, sp: SplitView) {
		return sp.direction === 'right'
			? clampRatio((e.clientX - area.left - sp.x * area.width) / (sp.width * area.width))
			: clampRatio((e.clientY - area.top - sp.y * area.height) / (sp.height * area.height));
	}

	function setRatio(tabId: string, sp: SplitView, ratio: number) {
		if (Math.abs(ratio - sp.ratio) < 0.005) return;
		void call('Resize panes', 'layout.set_split_ratio', { tab_id: tabId, path: sp.path, ratio });
	}

	function startDrag(e: PointerEvent, tabId: string, sp: SplitView) {
		const el = e.currentTarget as HTMLElement;
		const area = el.closest('[data-tab-area]')!.getBoundingClientRect();
		el.setPointerCapture(e.pointerId);
		drag = { tabId, key: splitKey(sp), ratio: sp.ratio };
		const move = (ev: PointerEvent) => drag && (drag.ratio = ratioAt(ev, area, sp));
		const end = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', end);
			el.removeEventListener('pointercancel', end);
			if (drag) setRatio(tabId, sp, drag.ratio);
			drag = null;
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', end);
		el.addEventListener('pointercancel', end);
	}

	function dividerKey(e: KeyboardEvent, tabId: string, sp: SplitView) {
		const back = sp.direction === 'right' ? 'ArrowLeft' : 'ArrowUp';
		const forward = sp.direction === 'right' ? 'ArrowRight' : 'ArrowDown';
		if (e.key !== back && e.key !== forward) return;
		e.preventDefault();
		setRatio(tabId, sp, clampRatio(sp.ratio + (e.key === forward ? 0.05 : -0.05)));
	}

	/** A divider sits in the gap on the split's boundary, across its region. */
	function dividerStyle(sp: SplitView, ratio: number) {
		return sp.direction === 'right'
			? `left:${pct(sp.x + sp.width * ratio)};top:${pct(sp.y)};height:${pct(sp.height)}`
			: `top:${pct(sp.y + sp.height * ratio)};left:${pct(sp.x)};width:${pct(sp.width)}`;
	}
</script>

<svelte:window onkeydowncapture={onKeydown} />

{#snippet dropdownItems(groups: Action[][])}
	{#each groups.filter((g) => g.length) as group, i (i)}
		{#if i > 0}<DropdownMenu.Separator />{/if}
		<DropdownMenu.Group>
			{#each group as a (a.label)}
				<DropdownMenu.Item variant={a.destructive ? 'destructive' : 'default'} onSelect={a.run}>
					{#if a.icon}<a.icon />{/if}
					{a.label}
					{#if a.shortcut}<DropdownMenu.Shortcut>{a.shortcut}</DropdownMenu.Shortcut>{/if}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Group>
	{/each}
{/snippet}

{#snippet contextItems(groups: Action[][])}
	{#each groups.filter((g) => g.length) as group, i (i)}
		{#if i > 0}<ContextMenu.Separator />{/if}
		<ContextMenu.Group>
			{#each group as a (a.label)}
				<ContextMenu.Item variant={a.destructive ? 'destructive' : 'default'} onSelect={a.run}>
					{#if a.icon}<a.icon />{/if}
					{a.label}
					{#if a.shortcut}<ContextMenu.Shortcut>{a.shortcut}</ContextMenu.Shortcut>{/if}
				</ContextMenu.Item>
			{/each}
		</ContextMenu.Group>
	{/each}
{/snippet}

{#snippet agentRow(a: AgentView, showSpace: boolean)}
	{@const current = !!tab && activePane[tab.id] === a.paneId && tab.panes.some((p) => p.id === a.paneId)}
	<button
		type="button"
		class={cn(
			'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
			current && 'bg-sidebar-accent text-sidebar-accent-foreground'
		)}
		aria-current={current ? 'true' : undefined}
		onclick={() => jumpToAgent(a)}
		title="Go to {a.name}"
	>
		<StatusBadge status={a.status} compact />
		<span class="flex min-w-0 flex-col">
			<span class="truncate font-medium">{a.name}</span>
			{#if showSpace}<span class="truncate text-xs text-muted-foreground">{a.workspaceLabel}</span>{/if}
		</span>
	</button>
{/snippet}

<!-- The workspace is always dark, like the terminals it holds. -->
<div class="dark flex size-full min-h-0 bg-background text-foreground" style={themeStyle}>
	{#if sidebarOpen}
		<aside class="relative flex shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground" style:width="{sidebarWidth}px">
			<!-- Drag (or arrow keys) to resize; double-click for the default width. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<div
				role="separator"
				tabindex="0"
				aria-orientation="vertical"
				aria-label="Resize sidebar"
				aria-valuemin={180}
				aria-valuemax={480}
				aria-valuenow={sidebarWidth}
				title="Drag to resize, double-click to reset"
				class="group/edge absolute inset-y-0 -end-1 z-20 flex w-2 cursor-col-resize justify-center outline-none"
				onpointerdown={startSidebarResize}
				ondblclick={() => setSidebarWidth(DEFAULT_WIDTH)}
				onkeydown={sidebarResizeKey}
			>
				<span class="h-full w-px bg-foreground/40 opacity-0 transition-opacity group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100"></span>
			</div>
			{#if header}
				<div class="shrink-0 border-b">{@render header()}</div>
			{/if}

			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
				<div class="flex flex-col gap-2 px-2 pt-2">
					<button
						type="button"
						class="flex h-8 items-center gap-2 rounded-md border bg-background/40 px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
						onclick={() => (switcherOpen = true)}
					>
						<SearchIcon class="size-4" aria-hidden="true" />
						Go to…
						<Kbd class="ms-auto">{keys('K')}</Kbd>
					</button>
					{#if needsYou.length || finished.length}
						<button
							type="button"
							class={cn(
								'flex items-center gap-2 rounded-md border px-2 py-1.5 text-start text-sm transition-colors',
								needsYou.length
									? 'border-destructive/40 bg-destructive/15 hover:bg-destructive/25'
									: 'border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20'
							)}
							onclick={nextAttention}
							title="Go to the next one ({keys('J')})"
						>
							<BellRingIcon class={cn('size-4 shrink-0', needsYou.length ? 'text-destructive' : 'text-emerald-400')} aria-hidden="true" />
							<span class="min-w-0 flex-1 truncate">
								{#if needsYou.length}{needsYou.length} {needsYou.length === 1 ? 'agent needs' : 'agents need'} you{/if}{#if needsYou.length && finished.length}, {/if}{#if finished.length}{finished.length} finished{/if}
							</span>
							<span class="shrink-0 text-xs text-muted-foreground">Next</span>
						</button>
					{/if}
				</div>
				<section class="flex flex-col gap-0.5 p-2" aria-labelledby="spaces-heading">
					<div class="flex h-7 items-center gap-1.5 px-2">
						<ToggleGroup.Root
							type="single"
							size="sm"
							class="-ms-1"
							aria-label="Sidebar layout"
							bind:value={
								() => sidebarList,
								(v) => {
									if (v !== 'separate' && v !== 'nested') return;
									sidebarList = v;
									remember(SIDEBAR_LIST_KEY, v);
								}
							}
						>
							<ToggleGroup.Item value="separate" class="size-6 min-w-6 p-0" aria-label="Spaces and agents in separate lists" title="Separate lists (like Herdr)">
								<Rows2Icon />
							</ToggleGroup.Item>
							<ToggleGroup.Item value="nested" class="size-6 min-w-6 p-0" aria-label="Agents under their space" title="Agents under their space">
								<ListTreeIcon />
							</ToggleGroup.Item>
						</ToggleGroup.Root>
						<h2 id="spaces-heading" class="me-auto text-xs font-medium text-muted-foreground">Spaces</h2>
						<Button size="icon-sm" variant="ghost" class="size-6" aria-label="New space" title="New space ({keys('N')})" onclick={newSpace}>
							<PlusIcon />
						</Button>
					</div>
					{#each session.workspaces as w (w.id)}
						{@const current = w.id === space?.id}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								{#snippet child({ props })}
									<div
										{...props}
										class={cn(
											'group/space flex h-8 min-w-0 items-center rounded-md text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
											current && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
										)}
									>
										<button
											type="button"
											class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md ps-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
											aria-current={current ? 'true' : undefined}
											onclick={() => (selectedSpaceId = w.id)}
										>
											{#if w.worktree}
												<GitBranchIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
											{:else}
												<FolderIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
											{/if}
											<span class="truncate" title={w.worktree ? `${w.label} · ${w.worktree.checkoutPath}` : w.label}>{w.label}</span>
											<span class="ms-auto flex shrink-0 items-center pe-1">
												{#if w.agents.length}<StatusBadge status={w.status} compact />{/if}
											</span>
										</button>
										<DropdownMenu.Root>
											<DropdownMenu.Trigger>
												{#snippet child({ props: menuProps })}
													<Button
														{...menuProps}
														size="icon-sm"
														variant="ghost"
														class="me-0.5 size-6 opacity-0 group-hover/space:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
														aria-label="{w.label} actions"
													>
														<EllipsisIcon />
													</Button>
												{/snippet}
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="start" class="w-52">{@render dropdownItems(spaceActions(w))}</DropdownMenu.Content>
										</DropdownMenu.Root>
									</div>
								{/snippet}
							</ContextMenu.Trigger>
							<ContextMenu.Content class="w-52">{@render contextItems(spaceActions(w))}</ContextMenu.Content>
						</ContextMenu.Root>
						{#if sidebarList === 'nested' && w.agents.length}
							<div class="ms-4 mb-1 flex flex-col gap-0.5 border-s ps-1.5">
								{#each [...w.agents].sort(byAttention) as a (a.paneId)}
									{@render agentRow(a, false)}
								{/each}
							</div>
						{/if}
					{:else}
						<p class="px-2 py-1 text-sm text-muted-foreground">No spaces yet.</p>
					{/each}
				</section>

				{#if sidebarList === 'separate'}
					<section class="flex flex-col gap-0.5 border-t p-2" aria-labelledby="agents-heading">
						<div class="flex h-7 items-center px-2">
							<h2 id="agents-heading" class="text-xs font-medium text-muted-foreground">Agents</h2>
							{#if agents.length}<span class="ms-auto text-xs text-muted-foreground tabular-nums">{agents.length}</span>{/if}
						</div>
						{#each agents as a (a.paneId)}
							{@render agentRow(a, true)}
						{:else}
							<p class="px-2 py-1 text-sm text-muted-foreground">No agents running.</p>
						{/each}
					</section>
				{/if}
			</div>

			<div class="flex shrink-0 items-center justify-between border-t p-1.5">
				<Button size="sm" variant="ghost" class="h-7 px-2 text-xs text-muted-foreground" onclick={() => (shortcutsOpen = true)}>
					<KeyboardIcon data-icon="inline-start" />Shortcuts
				</Button>
				<Button size="icon-sm" variant="ghost" aria-label="Hide sidebar" title="Hide sidebar" onclick={() => setSidebar(false)}>
					<PanelLeftCloseIcon />
				</Button>
			</div>
		</aside>
	{/if}

	<div class="flex min-w-0 flex-1 flex-col">
		<div class="flex h-10 shrink-0 items-stretch gap-1 border-b bg-sidebar px-1.5">
			{#if !sidebarOpen}
				<div class="flex items-center gap-1">
					<Button size="icon-sm" variant="ghost" aria-label="Show sidebar" title="Show sidebar" onclick={() => setSidebar(true)}>
						<PanelLeftOpenIcon />
					</Button>
					<span class="max-w-40 truncate px-1 text-sm font-medium" title={space?.label}>{space?.label}</span>
				</div>
			{/if}
			<div class="flex min-w-0 items-stretch overflow-x-auto" role="tablist" aria-label="Tabs in {space?.label ?? 'space'}">
				{#each space?.tabs ?? [] as t (t.id)}
					{@const current = t.id === tab?.id && !activeFile}
					{@const agent = tabAgent(t)}
					<ContextMenu.Root>
						<ContextMenu.Trigger>
							{#snippet child({ props })}
								<!-- Like a browser tab: the close button shows on hover and on the selected tab. -->
								<div
									{...props}
									class={cn(
										'group/tt relative flex shrink-0 items-center text-sm text-muted-foreground transition-colors hover:text-foreground',
										current && 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground'
									)}
								>
									<button
										type="button"
										role="tab"
										aria-selected={current}
										class="flex h-full items-center gap-2 ps-3 pe-1 outline-none focus-visible:text-foreground"
										onclick={() => space && selectTab(space.id, t.id)}
										ondblclick={() => renameTab(t)}
										onauxclick={(e) => e.button === 1 && closeTab(t)}
										title="Double-click to rename, right-click for more"
									>
										{#if agent}
											<BotIcon class="size-4" aria-hidden="true" />
										{:else if t.panes.length > 1}
											<Columns2Icon class="size-4" aria-hidden="true" />
										{:else}
											<SquareTerminalIcon class="size-4" aria-hidden="true" />
										{/if}
										<span class="max-w-40 truncate">{agent ? agent.name : `Tab ${t.label}`}</span>
										{#if agent}<StatusBadge status={agent.status} compact />{/if}
									</button>
									<Button
										size="icon-sm"
										variant="ghost"
										class={cn('me-1 size-5 opacity-0 group-hover/tt:opacity-100 focus-visible:opacity-100', current && 'opacity-100')}
										aria-label="Close {agent ? agent.name : `tab ${t.label}`}"
										title="Close tab"
										onclick={() => closeTab(t)}
									>
										<XIcon />
									</Button>
								</div>
							{/snippet}
						</ContextMenu.Trigger>
						<ContextMenu.Content class="w-52">{#if space}{@render contextItems(tabActions(space, t))}{/if}</ContextMenu.Content>
					</ContextMenu.Root>
				{/each}
				{#if space}
					<div class="flex items-center">
						<Button size="icon-sm" variant="ghost" aria-label="New tab" title="New tab ({keys('T')})" onclick={() => space && newTab(space.id)}>
							<PlusIcon />
						</Button>
					</div>
				{/if}
				{#if fileTabs.length}
					<span class="my-2.5 w-px shrink-0 bg-border" aria-hidden="true"></span>
					{#each fileTabs as f (fileKey(f))}
						{@const current = activeFile === fileKey(f)}
						{@const name = f.path.split('/').pop() || f.path}
						<div
							class={cn(
								'group/ft relative flex shrink-0 items-center text-sm text-muted-foreground transition-colors hover:text-foreground',
								current && 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground'
							)}
						>
							<button
								type="button"
								role="tab"
								aria-selected={current}
								class="flex h-full items-center gap-2 ps-3 pe-1 outline-none focus-visible:text-foreground"
								title="{f.root}/{f.path}"
								onclick={() => showFile(fileKey(f))}
								onauxclick={(e) => e.button === 1 && closeFileTab(f)}
							>
								<FileCodeIcon class="size-4" aria-hidden="true" />
								<span class="max-w-40 truncate">{name}</span>
							</button>
							<Button
								size="icon-sm"
								variant="ghost"
								class={cn('me-1 size-5 opacity-0 group-hover/ft:opacity-100 focus-visible:opacity-100', current && 'opacity-100')}
								aria-label="Close {name}"
								title="Close"
								onclick={() => closeFileTab(f)}
							>
								<XIcon />
							</Button>
						</div>
					{/each}
				{/if}
			</div>
			<div class="ms-auto flex shrink-0 items-center gap-1">
				<Button
					size="sm"
					variant={filesOpen ? 'secondary' : 'ghost'}
					class="h-7 px-2"
					aria-pressed={filesOpen}
					title="Files ({keys('E')})"
					onclick={() => setFilesOpen(!filesOpen)}
				>
					<FolderTreeIcon data-icon="inline-start" />Files
				</Button>
				{#if controls}{@render controls()}{/if}
			</div>
		</div>

		<div class="flex min-h-0 flex-1">
		<div class="relative min-h-0 min-w-0 flex-1 bg-(--workspace-stage,var(--sidebar))">
			{#each fileTabs as f (fileKey(f))}
				<!-- File tabs cover the panes while shown; the terminals stay connected underneath. -->
				<div class={cn('absolute inset-1.5 z-20', activeFile !== fileKey(f) && 'invisible')} inert={activeFile !== fileKey(f)} data-file-tab={fileKey(f)}>
					<FileViewer {machineId} session={session.name} root={f.root} path={f.path} onback={backToTerminals} onclose={() => closeFileTab(f)} />
				</div>
			{/each}
			{#each alive as t (t.id)}
				{@const current = t.id === tab?.id}
				{@const max = maximized[t.id] ?? null}
				{@const rects = rectsFor(t)}
				{@const paneById = new Map(t.panes.map((p) => [p.id, p]))}
				<div class={cn('absolute inset-1.5', !current && 'invisible')} inert={!current} data-tab-area>
					{#each rects as r (r.paneId)}
						{@const pane = paneById.get(r.paneId)}
						{@const st = states[r.paneId]}
						{@const shown = max ? (max === r.paneId ? { x: 0, y: 0, width: 1, height: 1 } : null) : r}
						{@const active = activePane[t.id] === r.paneId}
						<!-- The wrapper only records which pane has the keyboard; the terminal handles keys. -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class={cn('absolute p-[3px]', !shown && 'invisible')}
							style:left={pct((shown ?? r).x)}
							style:top={pct((shown ?? r).y)}
							style:width={pct((shown ?? r).width)}
							style:height={pct((shown ?? r).height)}
							inert={!shown}
							data-pane={r.paneId}
							onpointerdown={() => (activePane[t.id] = r.paneId)}
							onfocusin={() => (activePane[t.id] = r.paneId)}
						>
							<div
								class={cn(
									'group flex size-full min-h-0 flex-col overflow-hidden rounded-lg border shadow-sm transition-colors',
									active ? 'border-foreground/45' : 'hover:border-foreground/20',
									pane?.agent?.status === 'blocked' && 'border-destructive/70'
								)}
								style:background-color={themeColors(appearance.theme).background}
							>
								<ContextMenu.Root>
									<ContextMenu.Trigger>
										{#snippet child({ props })}
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<div
												{...props}
												class={cn(
													'flex h-7 shrink-0 items-center gap-2 border-b border-border/60 ps-2.5 pe-1 text-xs',
													pane?.agent?.status === 'blocked' && 'bg-destructive/15',
													pane?.agent?.status === 'done' && 'bg-emerald-500/10'
												)}
												ondblclick={() => rects.length > 1 && toggleMaximize(t.id, r.paneId)}
											>
												{#if pane?.agent}
													<BotIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
													<span class="truncate font-medium">{pane.agent.name}</span>
													<StatusBadge status={pane.agent.status} compact />
												{:else}
													<SquareTerminalIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
													<span class="font-medium">Shell</span>
												{/if}
												<span class="min-w-0 truncate font-mono text-muted-foreground" title={pane?.cwd ?? undefined}>{folder(pane?.cwd ?? null)}</span>
												<span class="ms-auto flex shrink-0 items-center gap-0.5">
													{#if paneMode[r.paneId] === 'watch' && mode === 'control'}
														<span class="flex items-center gap-1 text-muted-foreground"><EyeIcon class="size-3.5" aria-hidden="true" />Watching</span>
														<Button size="sm" variant="ghost" class="h-6 px-2 text-xs" onclick={() => setPaneMode(r.paneId, 'takeover')}>Take control</Button>
													{/if}
													{#if isLocked(st)}
														<span class="text-muted-foreground">Someone else is controlling this pane</span>
														<Button size="sm" variant="ghost" class="h-6 px-2 text-xs" onclick={() => setPaneMode(r.paneId, 'watch')}><EyeIcon data-icon="inline-start" />Watch</Button>
														<Button size="sm" variant="ghost" class="h-6 px-2 text-xs" onclick={() => setPaneMode(r.paneId, 'takeover')}><KeyboardIcon data-icon="inline-start" />Take over</Button>
													{:else if st?.phase === 'closed'}
														<span class="max-w-64 truncate text-muted-foreground" title={st.reason}>{st.reason ?? 'Closed.'}</span>
														<Button size="icon-sm" variant="ghost" class="size-6" aria-label="Reconnect" title="Reconnect" onclick={() => reconnect(r.paneId)}>
															<RotateCwIcon />
														</Button>
													{:else if st?.phase === 'connecting'}
														<span class="text-muted-foreground">Connecting…</span>
													{/if}
													<span
														class={cn(
															'flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100',
															(active || max === r.paneId) && 'opacity-100'
														)}
													>
														<Button
															size="icon-sm"
															variant="ghost"
															class="size-6"
															aria-pressed={isPinned(r.paneId)}
															aria-label={isPinned(r.paneId) ? 'Unpin prompt' : 'Pin prompt'}
															title={isPinned(r.paneId)
																? 'Prompt pinned: scrolling up shows history above it. Click to let history cover the whole pane.'
																: 'History covers the whole pane when you scroll up. Click to keep the prompt visible below it.'}
															onclick={() => togglePin(r.paneId)}
														>
															{#if isPinned(r.paneId)}<PinIcon />{:else}<PinOffIcon />{/if}
														</Button>
														<Button size="icon-sm" variant="ghost" class="size-6" aria-label="Split right" title="Split right ({keys('\\')})" onclick={() => splitPane(t.id, r.paneId, 'right')}>
															<SquareSplitHorizontalIcon />
														</Button>
														<Button size="icon-sm" variant="ghost" class="size-6" aria-label="Split down" title="Split down ({keys('-')})" onclick={() => splitPane(t.id, r.paneId, 'down')}>
															<SquareSplitVerticalIcon />
														</Button>
														{#if rects.length > 1}
															<Button
																size="icon-sm"
																variant="ghost"
																class="size-6"
																aria-label={max === r.paneId ? 'Restore layout' : 'Maximize pane'}
																title={max === r.paneId ? `Restore layout (${keys('Z')})` : `Maximize (${keys('Z')}, or double-click the title)`}
																onclick={() => toggleMaximize(t.id, r.paneId)}
															>
																{#if max === r.paneId}<Minimize2Icon />{:else}<Maximize2Icon />{/if}
															</Button>
														{/if}
														<DropdownMenu.Root>
															<DropdownMenu.Trigger>
																{#snippet child({ props: menuProps })}
																	<Button {...menuProps} size="icon-sm" variant="ghost" class="size-6" aria-label="Pane actions"><EllipsisIcon /></Button>
																{/snippet}
															</DropdownMenu.Trigger>
															<DropdownMenu.Content align="end" class="w-56">{@render dropdownItems(paneActions(t, r.paneId))}</DropdownMenu.Content>
														</DropdownMenu.Root>
													</span>
												</span>
											</div>
										{/snippet}
									</ContextMenu.Trigger>
									<ContextMenu.Content class="w-56">{@render contextItems(paneActions(t, r.paneId))}</ContextMenu.Content>
								</ContextMenu.Root>
								<div class="relative min-h-0 flex-1">
									{#if historyOpen[r.paneId]}
										<div
											class="absolute inset-x-0 top-0 z-10"
											style:height={isPinned(r.paneId) ? historyHeight(r.paneId) : '100%'}
										>
											<HistoryPanel
												{machineId}
												session={session.name}
												paneId={r.paneId}
												search={historySearch[r.paneId] ?? false}
												liveRows={isPinned(r.paneId) ? () => views[r.paneId]?.bottomRows(LIVE_ROWS) ?? [] : undefined}
												onclose={() => closeHistory(r.paneId)}
											/>
										</div>
									{/if}
									{#key `${r.paneId}:${mode}:${transport}:${attempts[r.paneId] ?? 0}`}
										<TerminalView
											bind:this={views[r.paneId]}
											{machineId}
											session={session.name}
											target={r.paneId}
											mode={paneMode[r.paneId] === 'watch' ? 'observe' : mode}
											takeover={paneMode[r.paneId] === 'takeover'}
											{transport}
											onscrollup={() => (historyOpen[r.paneId] = true)}
											onstatechange={(s) => {
												states[r.paneId] = s;
												// A takeover happens once; later reconnects ask normally again.
												if (s.phase === 'live' && paneMode[r.paneId] === 'takeover') delete paneMode[r.paneId];
											}}
										/>
									{/key}
								</div>
							</div>
						</div>
					{/each}

					{#if !max && !t.layout?.zoomed}
						{#each t.layout?.splits ?? [] as sp (splitKey(sp))}
							{@const dragging = drag?.tabId === t.id && drag.key === splitKey(sp)}
							<!-- A focusable separator with a value is the ARIA window-splitter pattern (arrow keys resize). -->
							<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
							<div
								role="separator"
								tabindex="0"
								aria-orientation={sp.direction === 'right' ? 'vertical' : 'horizontal'}
								aria-valuemin={5}
								aria-valuemax={95}
								aria-valuenow={Math.round((dragging ? drag!.ratio : sp.ratio) * 100)}
								aria-label="Resize panes"
								class={cn(
									'group/divider absolute z-10 flex items-center justify-center outline-none',
									sp.direction === 'right' ? 'w-2 -translate-x-1/2 cursor-col-resize py-2' : 'h-2 -translate-y-1/2 cursor-row-resize px-2'
								)}
								style={dividerStyle(sp, dragging ? drag!.ratio : sp.ratio)}
								onpointerdown={(e) => startDrag(e, t.id, sp)}
								onkeydown={(e) => dividerKey(e, t.id, sp)}
							>
								<span
									class={cn(
										'rounded-full bg-foreground/50 opacity-0 transition-opacity group-hover/divider:opacity-80 group-focus-visible/divider:opacity-100',
										sp.direction === 'right' ? 'h-full w-0.5' : 'h-0.5 w-full',
										dragging && 'opacity-100'
									)}
								></span>
							</div>
						{/each}
					{/if}
				</div>
			{:else}
				<p class="p-4 text-sm text-muted-foreground">This space has no tabs yet.</p>
			{/each}
		</div>
		{#if filesOpen}
			<aside class="relative shrink-0 border-s" style:width="{filesWidth}px" aria-label="Files">
				<!-- Drag the edge to resize; double-click resets. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="group/edge absolute inset-y-0 -start-1 z-20 flex w-2 cursor-col-resize justify-center"
					title="Drag to resize, double-click to reset"
					onpointerdown={startFilesResize}
					ondblclick={() => {
						filesWidth = 300;
						remember(FILES_WIDTH_KEY, '300');
					}}
				>
					<span class="h-full w-px bg-foreground/40 opacity-0 transition-opacity group-hover/edge:opacity-100"></span>
				</div>
				<FileExplorer
					{machineId}
					session={session.name}
					{preferredRoot}
					selected={openFile}
					onopen={openFileTab}
					onterminal={terminalIn}
					onclose={() => setFilesOpen(false)}
				/>
			</aside>
		{/if}
		</div>
	</div>
</div>

<FormDialog bind:open={form.open} title={form.title} description={form.description} fields={form.fields} submitLabel={form.submitLabel} onSubmit={form.onSubmit} />
<ConfirmDialog bind:open={confirm.open} title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} onConfirm={confirm.onConfirm} />

<Dialog.Root bind:open={shortcutsOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Keyboard shortcuts</Dialog.Title>
			<Dialog.Description>These work even while you type in a terminal; every other key goes to the terminal.</Dialog.Description>
		</Dialog.Header>
		<dl class="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 text-sm">
			{#each shortcutList as [label, key] (label)}
				<dt class="text-muted-foreground">{label}</dt>
				<dd><Kbd>{keys(key)}</Kbd></dd>
			{/each}
		</dl>
	</Dialog.Content>
</Dialog.Root>

<Command.Dialog bind:open={switcherOpen} title="Go to" description="Search this session's agents, tabs, panes and spaces">
	<Command.Input placeholder="Go to an agent, tab, pane or space…" />
	<Command.List>
		<Command.Empty>Nothing matches.</Command.Empty>
		{#if agents.length}
			<Command.Group heading="Agents">
				{#each agents as a (a.paneId)}
					<Command.Item value="agent {a.name} {a.workspaceLabel} {a.paneId}" onSelect={() => go(() => jumpToAgent(a))}>
						<StatusBadge status={a.status} compact />
						<span class="min-w-0 flex-1 truncate">{a.name}</span>
						<span class="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{a.workspaceLabel}</span>
					</Command.Item>
				{/each}
			</Command.Group>
		{/if}
		<Command.Group heading="Tabs">
			{#each session.workspaces as w (w.id)}
				{#each w.tabs as t (t.id)}
					{@const agent = tabAgent(t)}
					<Command.Item value="tab {w.label} {t.label} {agent?.name ?? ''} {t.id}" onSelect={() => go(() => openTab(w, t))}>
						{#if agent}<BotIcon />{:else if t.panes.length > 1}<Columns2Icon />{:else}<SquareTerminalIcon />{/if}
						<span class="min-w-0 flex-1 truncate">{agent ? agent.name : `Tab ${t.label}`}</span>
						<span class="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{w.label}</span>
					</Command.Item>
				{/each}
			{/each}
		</Command.Group>
		<Command.Group heading="Panes">
			{#each session.workspaces as w (w.id)}
				{#each w.tabs as t (t.id)}
					{#each t.panes as p (p.id)}
						<Command.Item value="pane {paneLabel(p)} {p.cwd ?? ''} {w.label} {t.label} {p.id}" onSelect={() => go(() => openPane(w, t, p.id))}>
							{#if p.agent}<BotIcon />{:else}<SquareTerminalIcon />{/if}
							<span class="truncate">{paneLabel(p)}</span>
							<span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{folder(p.cwd)}</span>
							<span class="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{w.label} · Tab {t.label}</span>
						</Command.Item>
					{/each}
				{/each}
			{/each}
		</Command.Group>
		<Command.Group heading="Spaces">
			{#each session.workspaces as w (w.id)}
				<Command.Item value="space {w.label} {w.id}" onSelect={() => go(() => (selectedSpaceId = w.id))}>
					{#if w.worktree}<GitBranchIcon />{:else}<FolderIcon />{/if}
					<span class="truncate">{w.label}</span>
				</Command.Item>
			{/each}
		</Command.Group>
		<Command.Separator />
		<Command.Group heading="Actions">
			{#if space}
				<Command.Item value="action new tab" onSelect={() => go(() => space && void newTab(space.id))}>
					<PlusIcon />New tab<Command.Shortcut>{keys('T')}</Command.Shortcut>
				</Command.Item>
			{/if}
			<Command.Item value="action new space" onSelect={() => go(newSpace)}>
				<PlusIcon />New space<Command.Shortcut>{keys('N')}</Command.Shortcut>
			</Command.Item>
			{#if tab && (activePane[tab.id] ?? rectsFor(tab)[0]?.paneId)}
				{@const paneId = (activePane[tab.id] ?? rectsFor(tab)[0]?.paneId)!}
				<Command.Item value="action split right" onSelect={() => go(() => tab && void splitPane(tab.id, paneId, 'right'))}>
					<SquareSplitHorizontalIcon />Split right<Command.Shortcut>{keys('\\')}</Command.Shortcut>
				</Command.Item>
				<Command.Item value="action split down" onSelect={() => go(() => tab && void splitPane(tab.id, paneId, 'down'))}>
					<SquareSplitVerticalIcon />Split down<Command.Shortcut>{keys('-')}</Command.Shortcut>
				</Command.Item>
				<Command.Item value="action show history" onSelect={() => go(() => (historyOpen[paneId] = true))}>
					<HistoryIcon />Show history<Command.Shortcut>{keys('H')}</Command.Shortcut>
				</Command.Item>
			{/if}
			<Command.Item value="action keyboard shortcuts" onSelect={() => go(() => (shortcutsOpen = true))}>
				<KeyboardIcon />Keyboard shortcuts<Command.Shortcut>{keys('/')}</Command.Shortcut>
			</Command.Item>
		</Command.Group>
	</Command.List>
</Command.Dialog>
