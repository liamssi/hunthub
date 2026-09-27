<script lang="ts">
	// The inbox: agents that need you right now, each with the bottom of its
	// screen (what it asks) and quick replies, so you can answer without opening
	// it; then what happened lately (agents that needed someone or finished).
	import BellIcon from '@lucide/svelte/icons/bell';
	import BellOffIcon from '@lucide/svelte/icons/bell-off';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import type { AgentView } from '@hunthub/shared/machines';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import StatusBadge from '$lib/components/agents/status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { attention, desktopSupported, markSeen, setDesktop } from '$lib/attention.svelte';
	import { consoleQuery, sendKeys, typeIntoPane } from '$lib/console';
	import { fleet, workspaceHref } from '$lib/fleet.svelte';
	import { formatRelative } from '$lib/format';
	import { cn } from '$lib/utils.js';

	/** Every agent asking something, across the machines, oldest need first. */
	const needing = $derived(
		Object.values(fleet.herdr)
			.flatMap((h) => h.sessions.flatMap((s) => s.workspaces.flatMap((w) => w.agents)))
			.filter((a) => a.status === 'blocked')
	);
	const keyOf = (a: { machineId: string; session: string; paneId: string }) => `${a.machineId}\t${a.session}\t${a.paneId}`;

	/** The bottom of each needing agent's screen, refreshed while the inbox is open. */
	let screens = $state<Record<string, string[]>>({});
	let replies = $state<Record<string, string>>({});
	let sending = $state<Record<string, boolean>>({});

	async function readScreen(a: AgentView) {
		const out = await consoleQuery(a.machineId, a.session, 'pane.read', { pane_id: a.paneId, source: 'visible', format: 'text' });
		if (!out.ok) return;
		const text = (out.result as { read?: { text?: string } } | null)?.read?.text ?? '';
		const lines = text.split('\n').map((l) => l.trimEnd());
		while (lines.length && !lines.at(-1)) lines.pop();
		screens[keyOf(a)] = lines.slice(-14);
	}

	$effect(() => {
		if (!attention.open) return;
		untrack(markSeen);
		const refresh = () => untrack(() => needing.forEach((a) => void readScreen(a)));
		refresh();
		const timer = setInterval(refresh, 3000);
		return () => clearInterval(timer);
	});

	/** Keeps a scrolled box at its end as its text changes (the question is at the bottom). */
	function stickToEnd(node: HTMLElement, _text: string) {
		node.scrollTop = node.scrollHeight;
		return { update: () => (node.scrollTop = node.scrollHeight) };
	}

	/** Numbered choices on the screen ("1. Yes", "❯ 2. No"), for one-click answers. */
	function choices(lines: string[] | undefined): { key: string; label: string }[] {
		const found = new Map<string, string>();
		for (const line of lines ?? []) {
			const m = /^\s*(?:[❯›>▶]\s*)?(\d)[.)]\s+(.{1,80}?)\s*$/.exec(line);
			if (m && !found.has(m[1]!)) found.set(m[1]!, m[2]!);
		}
		return found.size >= 2 ? [...found].map(([key, label]) => ({ key, label })) : [];
	}

	async function act(a: AgentView, what: string, run: () => ReturnType<typeof sendKeys>) {
		const k = keyOf(a);
		sending[k] = true;
		const out = await run();
		sending[k] = false;
		if (!out.ok) toast.error(`Couldn't reply to ${a.name}`, { description: out.message });
		else {
			toast.success(`${what} → ${a.name}`);
			setTimeout(() => void readScreen(a), 600);
		}
	}
	const pressKey = (a: AgentView, key: string, label: string) => act(a, label, () => sendKeys(a.machineId, a.session, a.paneId, [key]));
	// A choice is a key press: as typed text Herdr would paste it, which menus ignore.
	const typeChoice = (a: AgentView, key: string) => act(a, `Chose ${key}`, () => sendKeys(a.machineId, a.session, a.paneId, [key]));
	function reply(a: AgentView, event: SubmitEvent) {
		event.preventDefault();
		const text = replies[keyOf(a)]?.trim();
		if (!text) return;
		replies[keyOf(a)] = '';
		void act(a, 'Replied', () => typeIntoPane(a.machineId, a.session, a.paneId, text, true));
	}
</script>

<Sheet.Root bind:open={attention.open}>
	<Sheet.Content side="right" class="flex w-full flex-col gap-0 sm:max-w-lg">
		<Sheet.Header class="border-b">
			<Sheet.Title>Inbox</Sheet.Title>
			<Sheet.Description>Agents that need you, and what happened lately.</Sheet.Description>
		</Sheet.Header>

		<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
			<section class="flex flex-col gap-3" aria-labelledby="inbox-needs">
				<h3 id="inbox-needs" class="text-sm font-medium">Needs you{#if needing.length}<span class="ms-1.5 text-muted-foreground tabular-nums">{needing.length}</span>{/if}</h3>
				{#each needing as a (keyOf(a))}
					{@const k = keyOf(a)}
					{@const screen = screens[k]}
					{@const options = choices(screen)}
					<article class="flex flex-col gap-2 rounded-lg border p-3">
						<div class="flex min-w-0 items-center gap-2">
							<StatusBadge status={a.status} compact />
							<div class="flex min-w-0 flex-1 flex-col">
								<span class="truncate text-sm font-medium">{a.name}</span>
								<span class="truncate text-xs text-muted-foreground">{a.workspaceLabel} · {a.session} · {a.machineName}</span>
							</div>
							<Button size="sm" variant="outline" href={workspaceHref(a.machineId, a.session, a.paneId)} onclick={() => (attention.open = false)}>Open</Button>
						</div>
						{#if screen}
							<pre use:stickToEnd={screen.join('\n')} class="max-h-56 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap" aria-label="{a.name}'s screen">{screen.join('\n')}</pre>
						{:else}
							<p class="text-xs text-muted-foreground">Reading its screen…</p>
						{/if}
						<div class="flex flex-wrap items-center gap-1.5">
							{#each options as o (o.key)}
								<Button size="sm" variant="secondary" disabled={sending[k]} onclick={() => typeChoice(a, o.key)} title="Press {o.key}">
									<span class="font-mono">{o.key}</span>
									<span class="max-w-40 truncate">{o.label}</span>
								</Button>
							{/each}
							<Button size="sm" variant="ghost" disabled={sending[k]} onclick={() => pressKey(a, 'Enter', 'Enter')}>Enter</Button>
							<Button size="sm" variant="ghost" disabled={sending[k]} onclick={() => pressKey(a, 'Esc', 'Esc')}>Esc</Button>
						</div>
						<form class="flex gap-2" onsubmit={(e) => reply(a, e)}>
							<Input bind:value={replies[k]} placeholder="Reply…" aria-label="Reply to {a.name}" class="h-8" autocomplete="off" />
							<Button type="submit" size="sm" disabled={sending[k] || !replies[k]?.trim()}>Send</Button>
						</form>
					</article>
				{:else}
					<p class="text-sm text-muted-foreground">No agent needs you right now.</p>
				{/each}
			</section>

			<section class="flex flex-col gap-1" aria-labelledby="inbox-recent">
				<h3 id="inbox-recent" class="mb-1 text-sm font-medium">Recent</h3>
				{#each attention.events as e (e.id)}
					<a
						href={workspaceHref(e.machineId, e.session, e.paneId)}
						onclick={() => (attention.open = false)}
						class="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
					>
						{#if e.kind === 'needs_you'}
							<CircleAlertIcon class="size-4 shrink-0 text-amber-500" aria-hidden="true" />
						{:else}
							<CircleCheckIcon class="size-4 shrink-0 text-emerald-500" aria-hidden="true" />
						{/if}
						<span class="flex min-w-0 flex-1 flex-col">
							<span class="truncate">{e.agent} {e.kind === 'needs_you' ? 'needed you' : 'finished'}</span>
							<span class="truncate text-xs text-muted-foreground">{e.workspaceLabel} · {e.session} · {e.machineName}</span>
						</span>
						<time class="shrink-0 text-xs text-muted-foreground" datetime={e.at} title={new Date(e.at).toLocaleString()}>{formatRelative(e.at)}</time>
					</a>
				{:else}
					<Empty.Root class="border-0 p-4">
						<Empty.Header>
							<Empty.Title class="text-sm">Nothing yet</Empty.Title>
							<Empty.Description>When an agent asks something or finishes, it shows here.</Empty.Description>
						</Empty.Header>
					</Empty.Root>
				{/each}
			</section>
		</div>

		{#if desktopSupported()}
			<div class="flex items-center justify-between gap-3 border-t p-3 text-sm">
				<span class={cn('text-muted-foreground', attention.desktop && 'text-foreground')}>
					{attention.desktop ? 'Desktop notifications are on in this browser.' : 'Get a desktop notification when this tab is in the background.'}
				</span>
				<Button size="sm" variant="outline" onclick={() => setDesktop(!attention.desktop)}>
					{#if attention.desktop}<BellOffIcon data-icon="inline-start" />Turn off{:else}<BellIcon data-icon="inline-start" />Turn on{/if}
				</Button>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
