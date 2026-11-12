<script lang="ts">
	import LockIcon from '@lucide/svelte/icons/lock';
	let { what = 'the juicy stuff', compact = false }: { what?: string; compact?: boolean } = $props();
</script>

{#if compact}
	<span class="inline-flex items-center gap-1 text-muted-foreground" title="Members only">
		<LockIcon class="size-3" />
	</span>
{:else}
	<div class="flex flex-col items-center gap-2 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
		<LockIcon class="size-5 text-primary/70" />
		<p>Members only. Sign in and get vouched for to see {what}.</p>
	</div>
{/if}
