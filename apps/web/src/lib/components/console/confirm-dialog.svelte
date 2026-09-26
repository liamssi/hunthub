<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

	/** Confirmation for destructive actions. */
	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel,
		onConfirm
	}: { open?: boolean; title: string; description: string; confirmLabel: string; onConfirm: () => void } = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			<AlertDialog.Description>{description}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<!-- The action button doesn't close the dialog by itself. -->
			<AlertDialog.Action
				class="bg-destructive text-white hover:bg-destructive/90"
				onclick={() => {
					open = false;
					onConfirm();
				}}
			>
				{confirmLabel}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
