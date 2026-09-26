// Interprets Herdr's `session.snapshot` (forwarded as is by runners) into
// HuntHub's view: sessions -> workspaces -> agents. Parsing is lenient:
// unknown fields are ignored and missing optional ones tolerated, so newer
// Herdr versions keep working.
import { z } from 'zod';
import type { AgentStatus, AgentView, PaneView, SessionView, SplitView, TabView, WorkspaceView } from '@hunthub/shared/machines';

const statusSchema = z
	.string()
	.transform((s): AgentStatus => (['working', 'blocked', 'done', 'idle'].includes(s) ? (s as AgentStatus) : 'unknown'));

const rectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

const snapshotSchema = z.object({
	workspaces: z
		.array(
			z.object({
				workspace_id: z.string(),
				label: z.string().optional(),
				number: z.number().optional(),
				agent_status: statusSchema.optional(),
				pane_count: z.number().optional(),
				worktree: z
					.object({
						repo_name: z.string(),
						repo_root: z.string(),
						checkout_path: z.string(),
						is_linked_worktree: z.boolean().optional()
					})
					.nullish()
			})
		)
		.default([]),
	tabs: z
		.array(z.object({ tab_id: z.string(), workspace_id: z.string(), label: z.string().optional(), number: z.number().optional() }))
		.default([]),
	panes: z
		.array(
			z.object({
				pane_id: z.string(),
				tab_id: z.string(),
				workspace_id: z.string(),
				cwd: z.string().optional(),
				foreground_cwd: z.string().optional()
			})
		)
		.default([]),
	agents: z
		.array(
			z.object({
				pane_id: z.string(),
				workspace_id: z.string(),
				agent: z.string().optional(),
				display_agent: z.string().optional(),
				name: z.string().optional(),
				agent_status: statusSchema.optional(),
				cwd: z.string().optional(),
				foreground_cwd: z.string().optional()
			})
		)
		.default([]),
	layouts: z
		.array(
			z.object({
				tab_id: z.string(),
				zoomed: z.boolean().optional(),
				focused_pane_id: z.string().nullish(),
				area: rectSchema,
				panes: z.array(z.object({ pane_id: z.string(), rect: rectSchema })).default([]),
				splits: z
					.array(z.object({ id: z.string(), direction: z.enum(['right', 'down']), ratio: z.number(), rect: rectSchema }))
					.default([])
			})
		)
		.default([])
		// A malformed layout must not hide the rest of the session.
		.catch([])
});

/** Herdr names splits `split_<n>_root` or `split_<n>_<path as 0/1 digits>`. */
export function splitPath(id: string): boolean[] | null {
	const m = /^split_\d+_(root|[01]+)$/.exec(id);
	if (!m) return null;
	return m[1] === 'root' ? [] : [...m[1]!].map((c) => c === '1');
}

type MachineRef = { id: string; name: string };

/** Builds the view of one session; an unreadable snapshot yields no workspaces. */
export function sessionView(
	machine: MachineRef,
	session: { name: string; state: 'running' | 'stopped'; snapshot: unknown }
): SessionView {
	const parsed = session.state === 'running' ? snapshotSchema.safeParse(session.snapshot) : null;
	if (!parsed?.success) return { name: session.name, state: session.state, workspaces: [] };

	const workspaces: WorkspaceView[] = parsed.data.workspaces.map((w) => ({
		id: w.workspace_id,
		label: w.label || `Workspace ${w.number ?? w.workspace_id}`,
		worktree: w.worktree
			? {
					repoName: w.worktree.repo_name,
					repoRoot: w.worktree.repo_root,
					checkoutPath: w.worktree.checkout_path,
					linked: w.worktree.is_linked_worktree ?? false
				}
			: null,
		status: w.agent_status ?? 'unknown',
		paneCount: w.pane_count ?? 0,
		tabs: [],
		agents: []
	}));
	const byId = new Map(workspaces.map((w) => [w.id, w]));

	const tabsById = new Map<string, TabView>();
	for (const t of parsed.data.tabs) {
		const workspace = byId.get(t.workspace_id);
		if (!workspace) continue;
		const tab: TabView = { id: t.tab_id, label: t.label || String(t.number ?? t.tab_id), panes: [], layout: null };
		workspace.tabs.push(tab);
		tabsById.set(tab.id, tab);
	}
	for (const l of parsed.data.layouts) {
		const tab = tabsById.get(l.tab_id);
		const { x, y, width, height } = l.area;
		if (!tab || width <= 0 || height <= 0) continue;
		tab.layout = {
			zoomed: l.zoomed ?? false,
			focusedPaneId: l.focused_pane_id ?? null,
			panes: l.panes.map((p) => ({
				paneId: p.pane_id,
				x: (p.rect.x - x) / width,
				y: (p.rect.y - y) / height,
				width: p.rect.width / width,
				height: p.rect.height / height
			})),
			splits: l.splits.flatMap((sp): SplitView[] => {
				const path = splitPath(sp.id);
				if (!path) return [];
				return [
					{
						path,
						direction: sp.direction,
						ratio: sp.ratio,
						x: (sp.rect.x - x) / width,
						y: (sp.rect.y - y) / height,
						width: sp.rect.width / width,
						height: sp.rect.height / height
					}
				];
			})
		};
	}
	const panesById = new Map<string, PaneView>();
	for (const p of parsed.data.panes) {
		const pane: PaneView = { id: p.pane_id, cwd: p.foreground_cwd || p.cwd || null, agent: null };
		tabsById.get(p.tab_id)?.panes.push(pane);
		panesById.set(pane.id, pane);
	}

	for (const a of parsed.data.agents) {
		const workspace = byId.get(a.workspace_id);
		if (!workspace) continue;
		const agent: AgentView = {
			machineId: machine.id,
			machineName: machine.name,
			session: session.name,
			workspaceId: workspace.id,
			workspaceLabel: workspace.label,
			paneId: a.pane_id,
			name: a.name || a.display_agent || a.agent || 'agent',
			status: a.agent_status ?? 'unknown',
			cwd: a.foreground_cwd || a.cwd || null,
			origin: 'external'
		};
		workspace.agents.push(agent);
		const pane = panesById.get(a.pane_id);
		if (pane) pane.agent = { name: agent.name, status: agent.status };
	}
	return { name: session.name, state: session.state, workspaces };
}

/** Attention first: blocked, then working, done, idle, unknown. */
const statusOrder: Record<AgentStatus, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 };

export function sortAgents(agents: AgentView[]): AgentView[] {
	return [...agents].sort(
		(a, b) =>
			statusOrder[a.status] - statusOrder[b.status] ||
			a.machineName.localeCompare(b.machineName) ||
			a.session.localeCompare(b.session) ||
			a.paneId.localeCompare(b.paneId)
	);
}
