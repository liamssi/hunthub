<script lang="ts">
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import GitBranchIcon from '@lucide/svelte/icons/git-branch';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SquareIcon from '@lucide/svelte/icons/square';
	import TerminalIcon from '@lucide/svelte/icons/square-terminal';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { applyHerdrMessage, type Machine, type MachineHerdrView, type SessionView } from '@hunthub/shared/machines';
	import StatusBadge from '$lib/components/agents/status-badge.svelte';
	import ConfirmDialog from '$lib/components/console/confirm-dialog.svelte';
	import FormDialog, { type FormField } from '$lib/components/console/form-dialog.svelte';
	import TerminalDialog from '$lib/components/terminal/terminal-dialog.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { consoleCall, deleteSession, startSession, stopSession } from '$lib/console';
	import { subscribeLive } from '$lib/live';
	import { applyLive } from '$lib/machines';
	import { workspaceHref } from '$lib/fleet.svelte';

	let { data } = $props();

	// The machine is the source of truth: this page only shows what it reports.
	let machine = $derived<Machine>(data.machine);
	let herdr = $derived<MachineHerdrView>(data.herdr);
	$effect(() =>
		subscribeLive(`machine:${data.machine.id}`, (message) => {
			herdr = applyHerdrMessage(herdr, machine.id, message);
			const next = applyLive(machine, message);
			if (next) machine = next;
		})
	);

	const name = $derived(data.sessionName);
	const session = $derived<SessionView | undefined>(herdr.sessions.find((s) => s.name === name));
	const online = $derived(machine.connection === 'online' && machine.status === 'active');
	const running = $derived(session?.state === 'running');
	const call = (label: string, method: string, params: Record<string, unknown>, done?: string) =>
		consoleCall(machine.id, name, label, method, params, done);

	// One form dialog and one confirm dialog, configured per action.
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
	let terminal = $state({ open: false, target: '', title: '' });
	const openTerminal = (paneId: string, agent?: string) =>
		(terminal = { open: true, target: paneId, title: agent ? `${agent} · ${paneId}` : `Pane ${paneId}` });
	const openForm = (f: Omit<typeof form, 'open'>) => (form = { ...f, open: true });
	const openConfirm = (c: Omit<typeof confirm, 'open'>) => (confirm = { ...c, open: true });

	const newWorkspace = () =>
		openForm({
			title: 'New workspace',
			fields: [
				{ name: 'label', label: 'Name', placeholder: 'recon' },
				{ name: 'cwd', label: 'Folder', placeholder: '/home/you/project', description: 'Where its first pane starts. Empty: Herdr default.' }
			],
			submitLabel: 'Create',
			onSubmit: (v) => call('New workspace', 'workspace.create', { ...(v.label && { label: v.label }), ...(v.cwd && { cwd: v.cwd }) })
		});
	const newWorktree = () =>
		openForm({
			title: 'New worktree',
			description: 'Creates a git worktree on a new or existing branch and opens it as a workspace.',
			fields: [
				{ name: 'cwd', label: 'Repository folder', placeholder: '/home/you/project', required: true },
				{ name: 'branch', label: 'Branch', placeholder: 'feature-x', required: true },
				{ name: 'base', label: 'Start from', placeholder: 'main', description: 'For a new branch; empty: the current HEAD.' }
			],
			submitLabel: 'Create worktree',
			onSubmit: (v) => call('New worktree', 'worktree.create', { cwd: v.cwd, branch: v.branch, ...(v.base && { base: v.base }) })
		});
	const removeWorktree = (id: string, label: string, force = false) =>
		openConfirm({
			title: force ? `Remove worktree ${label} anyway?` : `Remove worktree ${label}?`,
			description: force
				? 'Uncommitted changes in it are lost. The branch itself is kept.'
				: 'Its workspace is closed and the checkout is removed from disk. The branch is kept.',
			confirmLabel: force ? 'Remove anyway' : 'Remove worktree',
			onConfirm: async () => {
				const ok = await call('Remove worktree', 'worktree.remove', { workspace_id: id, ...(force && { force: true }) });
				// A dirty checkout is refused; offer to force it.
				if (!ok && !force) removeWorktree(id, label, true);
			}
		});
	const renameWorkspace = (id: string, label: string) =>
		openForm({
			title: 'Rename workspace',
			fields: [{ name: 'label', label: 'Name', value: label, required: true }],
			submitLabel: 'Rename',
			onSubmit: (v) => call('Rename workspace', 'workspace.rename', { workspace_id: id, label: v.label })
		});
	const newTab = (workspaceId: string) =>
		openForm({
			title: 'New tab',
			fields: [
				{ name: 'label', label: 'Name' },
				{ name: 'cwd', label: 'Folder', description: 'Empty: Herdr default.' }
			],
			submitLabel: 'Create',
			onSubmit: (v) => call('New tab', 'tab.create', { workspace_id: workspaceId, ...(v.label && { label: v.label }), ...(v.cwd && { cwd: v.cwd }) })
		});
	const renameTab = (id: string, label: string) =>
		openForm({
			title: 'Rename tab',
			fields: [{ name: 'label', label: 'Name', value: label, required: true }],
			submitLabel: 'Rename',
			onSubmit: (v) => call('Rename tab', 'tab.rename', { tab_id: id, label: v.label })
		});
	const closeWorkspace = (id: string, label: string) =>
		openConfirm({
			title: `Close workspace ${label}?`,
			description: 'Its tabs and panes are closed, and anything running in them (including agents) is stopped.',
			confirmLabel: 'Close workspace',
			onConfirm: () => void call('Close workspace', 'workspace.close', { workspace_id: id })
		});
	const closeTab = (id: string, label: string) =>
		openConfirm({
			title: `Close tab ${label}?`,
			description: 'Its panes are closed, and anything running in them is stopped.',
			confirmLabel: 'Close tab',
			onConfirm: () => void call('Close tab', 'tab.close', { tab_id: id })
		});
	const closePane = (id: string) =>
		openConfirm({
			title: `Close pane ${id}?`,
			description: 'Anything running in this pane is stopped.',
			confirmLabel: 'Close pane',
			onConfirm: () => void call('Close pane', 'pane.close', { pane_id: id })
		});
	const confirmStop = () =>
		openConfirm({
			title: `Stop session ${name}?`,
			description: 'Everything running in it (shells, agents) is stopped. Its layout is kept and it can be started again.',
			confirmLabel: 'Stop session',
			onConfirm: () => void stopSession(machine.id, name)
		});
	const confirmDelete = () =>
		openConfirm({
			title: `Delete session ${name}?`,
			description: "Its saved layout and history are removed from the machine. This can't be undone.",
			confirmLabel: 'Delete session',
			onConfirm: async () => {
				if (await deleteSession(machine.id, name)) location.href = `/machines/${machine.id}`;
			}
		});
</script>

<svelte:head><title>{name} · {machine.name} · HuntHub</title></svelte:head>

<div class="flex flex-wrap items-start justify-between gap-4">
	<div class="flex flex-col gap-1">
		<div class="flex items-center gap-3">
			<h1 class="text-2xl font-semibold">{name}</h1>
			{#if session}
				<Badge variant={running ? 'secondary' : 'outline'}>{running ? 'Running' : 'Stopped'}</Badge>
			{/if}
		</div>
		<p class="text-sm text-muted-foreground">
			Herdr session on <a href="/machines/{machine.id}" class="hover:underline">{machine.name}</a>
		</p>
	</div>
	{#if session && online}
		<div class="flex gap-2">
			{#if running}
				<Button href={workspaceHref(machine.id, name)}><TerminalIcon data-icon="inline-start" />Open session</Button>
				<Button variant="outline" onclick={newWorkspace}><PlusIcon data-icon="inline-start" />New workspace</Button>
				<Button variant="outline" onclick={newWorktree}><GitBranchIcon data-icon="inline-start" />New worktree</Button>
				<Button variant="outline" onclick={confirmStop}><SquareIcon data-icon="inline-start" />Stop</Button>
			{:else}
				<Button onclick={() => startSession(machine.id, name)}><PlayIcon data-icon="inline-start" />Start</Button>
				{#if name !== 'default'}
					<Button variant="outline" onclick={confirmDelete}><TrashIcon data-icon="inline-start" />Delete</Button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

{#if !online}
	<p class="mt-6 text-sm text-muted-foreground">The machine is offline; the session shows when it reconnects.</p>
{:else if !session}
	<p class="mt-6 text-sm text-muted-foreground">
		This session doesn't exist on the machine (it may have been deleted there).
		<a href="/machines/{machine.id}" class="underline">Back to {machine.name}</a>
	</p>
{:else if !running}
	<p class="mt-6 text-sm text-muted-foreground">The session is stopped. Start it to see its workspaces.</p>
{:else if session.workspaces.length === 0}
	<p class="mt-6 text-sm text-muted-foreground">No workspaces yet.</p>
{:else}
	<div class="mt-6 flex flex-col gap-4">
		{#each session.workspaces as ws (ws.id)}
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between gap-2">
					<div class="flex min-w-0 items-center gap-2">
						<Card.Title class="truncate">{ws.label}</Card.Title>
						{#if ws.worktree}
							<Badge variant="outline" class="gap-1" title={ws.worktree.checkoutPath}>
								<GitBranchIcon />{ws.worktree.linked ? `worktree of ${ws.worktree.repoName}` : ws.worktree.repoName}
							</Badge>
						{/if}
						{#if ws.agents.length}<StatusBadge status={ws.status} />{/if}
					</div>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button {...props} size="icon-sm" variant="ghost" aria-label="Workspace {ws.label} actions"><EllipsisIcon /></Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Group>
								<DropdownMenu.Item onSelect={() => newTab(ws.id)}>New tab</DropdownMenu.Item>
								<DropdownMenu.Item onSelect={() => renameWorkspace(ws.id, ws.label)}>Rename</DropdownMenu.Item>
							</DropdownMenu.Group>
							<DropdownMenu.Separator />
							<DropdownMenu.Group>
								{#if ws.worktree?.linked}
									<DropdownMenu.Item variant="destructive" onSelect={() => removeWorktree(ws.id, ws.label)}>Remove worktree</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Item variant="destructive" onSelect={() => closeWorkspace(ws.id, ws.label)}>Close workspace</DropdownMenu.Item>
							</DropdownMenu.Group>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</Card.Header>
				<Card.Content class="flex flex-col gap-3">
					{#each ws.tabs as tab (tab.id)}
						<div class="rounded-md border p-2">
							<div class="flex items-center justify-between gap-2 text-sm">
								<span class="font-medium">Tab {tab.label}</span>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button {...props} size="icon-sm" variant="ghost" aria-label="Tab {tab.label} actions"><EllipsisIcon /></Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end">
										<DropdownMenu.Group>
											<DropdownMenu.Item onSelect={() => renameTab(tab.id, tab.label)}>Rename</DropdownMenu.Item>
										</DropdownMenu.Group>
										<DropdownMenu.Separator />
										<DropdownMenu.Group>
											<DropdownMenu.Item variant="destructive" onSelect={() => closeTab(tab.id, tab.label)}>Close tab</DropdownMenu.Item>
										</DropdownMenu.Group>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</div>
							<div class="mt-1 flex flex-col">
								{#each tab.panes as pane (pane.id)}
									<div class="flex min-w-0 flex-wrap items-center gap-2 border-t py-1.5 text-sm first:border-t-0">
										<span class="font-mono text-xs text-muted-foreground">{pane.id}</span>
										{#if pane.agent}
											<StatusBadge status={pane.agent.status} />
											<span class="font-medium">{pane.agent.name}</span>
										{:else}
											<span class="text-muted-foreground">shell</span>
										{/if}
										<span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={pane.cwd ?? undefined}>{pane.cwd ?? ''}</span>
										<Button size="sm" variant="outline" onclick={() => openTerminal(pane.id, pane.agent?.name)}>
											<TerminalIcon data-icon="inline-start" />Terminal
										</Button>
										<DropdownMenu.Root>
											<DropdownMenu.Trigger>
												{#snippet child({ props })}
													<Button {...props} size="icon-sm" variant="ghost" aria-label="Pane {pane.id} actions"><EllipsisIcon /></Button>
												{/snippet}
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="end">
												<DropdownMenu.Group>
													<DropdownMenu.Item onSelect={() => call('Split pane', 'pane.split', { target_pane_id: pane.id, direction: 'right' })}>Split right</DropdownMenu.Item>
													<DropdownMenu.Item onSelect={() => call('Split pane', 'pane.split', { target_pane_id: pane.id, direction: 'down' })}>Split down</DropdownMenu.Item>
												</DropdownMenu.Group>
												<DropdownMenu.Separator />
												<DropdownMenu.Group>
													<DropdownMenu.Item variant="destructive" onSelect={() => closePane(pane.id)}>Close pane</DropdownMenu.Item>
												</DropdownMenu.Group>
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
{/if}

<FormDialog bind:open={form.open} title={form.title} description={form.description} fields={form.fields} submitLabel={form.submitLabel} onSubmit={form.onSubmit} />
<TerminalDialog bind:open={terminal.open} machineId={machine.id} session={name} target={terminal.target} title={terminal.title} />
<ConfirmDialog bind:open={confirm.open} title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} onConfirm={confirm.onConfirm} />
