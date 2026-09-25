<script lang="ts">
	import { page } from '$app/state';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';

	// Labels for known paths; add entries as pages are added.
	const labels: Record<string, string> = {
		'/': 'Home',
		'/admin': 'Admin',
		'/admin/users': 'Users',
		'/account': 'Account'
	};

	const crumbs = $derived.by(() => {
		const segments = page.url.pathname.split('/').filter(Boolean);
		const paths = segments.map((_, i) => '/' + segments.slice(0, i + 1).join('/'));
		return (paths.length ? paths : ['/'])
			.filter((p) => labels[p])
			.map((p) => ({ href: p, label: labels[p] }));
	});
</script>

<Breadcrumb.Root>
	<Breadcrumb.List>
		{#each crumbs as crumb, i (crumb.href)}
			{#if i < crumbs.length - 1}
				<Breadcrumb.Item class="hidden md:block">
					{#if crumb.href === '/admin'}
						{crumb.label}
					{:else}
						<Breadcrumb.Link href={crumb.href}>{crumb.label}</Breadcrumb.Link>
					{/if}
				</Breadcrumb.Item>
				<Breadcrumb.Separator class="hidden md:block" />
			{:else}
				<Breadcrumb.Item>
					<Breadcrumb.Page>{crumb.label}</Breadcrumb.Page>
				</Breadcrumb.Item>
			{/if}
		{/each}
	</Breadcrumb.List>
</Breadcrumb.Root>
