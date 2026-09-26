// Interprets Herdr's `session.snapshot` (forwarded as is by runners) into
// HuntHub's view: sessions -> workspaces -> agents. Parsing is lenient:
// unknown fields are ignored and missing optional ones tolerated, so newer
// Herdr versions keep working.
import { z } from 'zod';
import type { AgentStatus, AgentView, SessionView, WorkspaceView } from '@hunthub/shared/machines';

const statusSchema = z
	.string()
	.transform((s): AgentStatus => (['working', 'blocked', 'done', 'idle'].includes(s) ? (s as AgentStatus) : 'unknown'));

const snapshotSchema = z.object({
	workspaces: z
		.array(
			z.object({
				workspace_id: z.string(),
				label: z.string().optional(),
				number: z.number().optional(),
				agent_status: statusSchema.optional(),
				pane_count: z.number().optional()
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
		.default([])
});

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
		status: w.agent_status ?? 'unknown',
		paneCount: w.pane_count ?? 0,
		agents: []
	}));
	const byId = new Map(workspaces.map((w) => [w.id, w]));

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
