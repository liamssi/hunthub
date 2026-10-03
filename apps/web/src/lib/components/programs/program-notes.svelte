<script lang="ts">
	// Your notes on a program (Markdown), saved as you type. Only you see them.
	import CheckIcon from '@lucide/svelte/icons/check';
	import Markdown from '$lib/components/markdown.svelte';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { patchCachedDetail } from '$lib/program-details';
	import { updateMe } from '$lib/program-me.svelte';

	let { programId, note }: { programId: number; note: string } = $props();

	let text = $state('');
	let saved = $state('');
	let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let mode = $state<'write' | 'preview'>('write');
	let timer: ReturnType<typeof setTimeout> | null = null;

	// Another program (or fresh data): start from what's stored.
	$effect(() => {
		void programId;
		text = saved = note;
		status = 'idle';
		mode = note.trim() ? 'preview' : 'write';
	});

	async function save() {
		timer = null;
		if (text === saved) return;
		const value = text;
		status = 'saving';
		const ok = await updateMe(programId, { note: value });
		if (ok) {
			saved = value;
			patchCachedDetail(programId, { note: value });
		}
		status = ok ? 'saved' : 'error';
	}
	function edited() {
		status = 'idle';
		if (timer) clearTimeout(timer);
		timer = setTimeout(save, 800);
	}
	// Leaving (another program, closing) saves what's pending.
	$effect(() => () => {
		if (timer) {
			clearTimeout(timer);
			void save();
		}
	});
</script>

<div class="flex flex-col gap-2">
	<div class="flex items-center gap-2">
		<ToggleGroup.Root type="single" variant="outline" size="sm" bind:value={() => mode, (v) => v && (mode = v as typeof mode)} aria-label="Notes view">
			<ToggleGroup.Item value="write">Write</ToggleGroup.Item>
			<ToggleGroup.Item value="preview">Preview</ToggleGroup.Item>
		</ToggleGroup.Root>
		<span class="text-xs text-muted-foreground" aria-live="polite">
			{#if status === 'saving'}Saving…{:else if status === 'saved'}<CheckIcon class="inline size-3.5" aria-hidden="true" /> Saved{:else if status === 'error'}Not saved{:else}Only you see these notes · Markdown{/if}
		</span>
	</div>
	{#if mode === 'write'}
		<Textarea
			bind:value={text}
			oninput={edited}
			onblur={() => timer && save()}
			class="min-h-72 font-mono text-sm"
			placeholder={'Ideas, recon results, what you tried, what to come back to…\n\nMarkdown works: **bold**, - lists, `code`.'}
			aria-label="Notes"
		/>
	{:else if text.trim()}
		<div class="min-h-32 rounded-lg border px-5 py-4"><Markdown source={text} /></div>
	{:else}
		<p class="rounded-lg border px-5 py-8 text-center text-sm text-muted-foreground">No notes yet. Switch to Write to add some.</p>
	{/if}
</div>
