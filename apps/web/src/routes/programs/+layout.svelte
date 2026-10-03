<script lang="ts">
	// The Programs area: all programs plus each one opened in a tab.
	import ProgramTabs from '$lib/components/programs/program-tabs.svelte';

	let { children } = $props();
</script>

<div class="flex flex-col gap-5">
	<ProgramTabs />
	{@render children()}
</div>
