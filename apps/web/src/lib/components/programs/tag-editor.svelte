<script lang="ts">
	// Your tags on a program: add (Enter), remove, or pick one you've used before.
	import HashIcon from '@lucide/svelte/icons/hash';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import { MAX_TAG_LENGTH, MAX_TAGS, type ProgramMe } from '@hunthub/shared/programs';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { knownTags, learnTags, updateMe } from '$lib/program-me.svelte';

	let { programId, me }: { programId: number; me: ProgramMe } = $props();

	let open = $state(false);
	let draft = $state('');
	const clean = (t: string) => t.trim().replace(/^#/, '').toLowerCase().slice(0, MAX_TAG_LENGTH);
	const suggestions = $derived(knownTags.list.filter((t) => !me.tags.includes(t) && t.includes(clean(draft))).slice(0, 8));

	function save(tags: string[]) {
		learnTags(tags);
		void updateMe(programId, { tags });
	}
	function add(t: string) {
		const tag = clean(t);
		draft = '';
		if (!tag || me.tags.includes(tag) || me.tags.length >= MAX_TAGS) return;
		save([...me.tags, tag]);
	}
	const remove = (t: string) => save(me.tags.filter((x) => x !== t));
</script>

<div class="flex flex-wrap items-center gap-1">
	{#each me.tags as t (t)}
		<span class="flex items-center gap-0.5 rounded border py-px ps-1.5 pe-0.5 text-xs text-muted-foreground">
			#{t}
			<button type="button" class="rounded p-0.5 hover:bg-muted hover:text-foreground" aria-label="Remove tag {t}" onclick={() => remove(t)}><XIcon class="size-3" /></button>
		</span>
	{/each}
	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} size="sm" variant="ghost" class="h-6 px-1.5 text-xs text-muted-foreground"><HashIcon data-icon="inline-start" />{me.tags.length ? 'Tag' : 'Add tags'}</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-64 p-2" align="start">
			<form
				class="flex gap-1"
				onsubmit={(e) => {
					e.preventDefault();
					add(draft);
				}}
			>
				<Input bind:value={draft} placeholder="e.g. recon-done, api, later" class="h-8 text-sm" maxlength={MAX_TAG_LENGTH} aria-label="New tag" />
				<Button type="submit" size="icon-sm" variant="outline" aria-label="Add tag" disabled={!clean(draft)}><PlusIcon /></Button>
			</form>
			{#if suggestions.length}
				<div class="mt-2 flex flex-wrap gap-1">
					{#each suggestions as t (t)}
						<button type="button" class="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground" onclick={() => add(t)}>#{t}</button>
					{/each}
				</div>
			{/if}
			<p class="mt-2 text-xs text-muted-foreground">Only you see your tags. Filter by them on the programs page.</p>
		</Popover.Content>
	</Popover.Root>
</div>
