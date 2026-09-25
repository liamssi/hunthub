<script lang="ts">
	let { data } = $props();
</script>

<h1>HuntHub</h1>

<ul>
	<li>API: {data.api}</li>
	<li>Database: {data.health?.db ?? 'unknown'}</li>
</ul>
