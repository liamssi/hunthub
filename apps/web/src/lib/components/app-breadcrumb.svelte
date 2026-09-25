<script lang="ts">
	import { page } from '$app/state';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';

	// Labels for known paths; add entries as pages are added.
	const labels: Record<string, string> = {
		'/': 'Home',
		'/admin': 'Admin',
		'/admin/users': 'Users',
		'/admin/settings': 'Settings',
		'/account': 'Account',
		'/machines': 'Machines'
	};

	/** Label for a path, including detail pages that name what they show. */
	function labelFor(path: string): string | undefined {
		if (labels[path]) return labels[path];
		if (/^\/machines\/[^/]+$/.test(path)) return page.data.machine?.name;
	}

	const crumbs = $derived.by(() => {
		const segments = page.url.pathname.split('/').filter(Boolean);
		const paths = segments.map((_, i) => '/' + segments.slice(0, i + 1).join('/'));
		return (paths.length ? paths : ['/'])
			.map((p) => ({ href: p, label: labelFor(p) }))
			.filter((c): c is { href: string; label: string } => !!c.label);
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
