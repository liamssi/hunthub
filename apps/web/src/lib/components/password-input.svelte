<script lang="ts">
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import type { FullAutoFill } from 'svelte/elements';
	import { Input } from '$lib/components/ui/input/index.js';

	let {
		value = $bindable(''),
		id,
		name,
		autocomplete,
		required = false,
		minlength
	}: {
		value?: string;
		id?: string;
		name?: string;
		autocomplete?: FullAutoFill;
		required?: boolean;
		minlength?: number;
	} = $props();

	let visible = $state(false);
</script>

<div class="relative">
	<Input {id} {name} {autocomplete} {required} {minlength} type={visible ? 'text' : 'password'} spellcheck={false} class="pr-10" bind:value />
	<button
		type="button"
		class="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
		aria-label={visible ? 'Hide password' : 'Show password'}
		aria-pressed={visible}
		onclick={() => (visible = !visible)}
	>
		{#if visible}<EyeOffIcon class="size-4" />{:else}<EyeIcon class="size-4" />{/if}
	</button>
</div>
