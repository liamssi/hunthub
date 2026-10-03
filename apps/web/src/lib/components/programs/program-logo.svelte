<script lang="ts">
	// A program's logo (cached by the hub), or its initials when it has none.
	import { cn } from '$lib/utils.js';

	let { name, logo, class: className }: { name: string; logo: string | null; class?: string } = $props();

	let failed = $state(false);
	$effect(() => {
		void logo;
		failed = false;
	});

	const initials = $derived(
		name
			.replace(/[^\p{L}\p{N} ]/gu, ' ')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]!.toUpperCase())
			.join('') || '?'
	);
</script>

<span class={cn('relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-xs font-semibold text-muted-foreground select-none', className)}>
	{#if logo && !failed}
		<img src={logo} alt="" loading="lazy" decoding="async" class="size-full bg-white object-contain" onerror={() => (failed = true)} />
	{:else}
		<span aria-hidden="true">{initials}</span>
	{/if}
</span>
