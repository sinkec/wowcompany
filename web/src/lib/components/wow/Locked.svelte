<script lang="ts">
	import Tip from './Tip.svelte';
	import LockIcon from '@lucide/svelte/icons/lock';
	let { what = 'the juicy stuff', compact = false }: { what?: string; compact?: boolean } = $props();
</script>

{#if compact}
	<Tip text="Members only" class="items-center gap-1 text-muted-foreground">
		<LockIcon class="size-3" aria-label="Members only" />
	</Tip>
{:else}
	<div class="flex flex-col items-center gap-2 rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
		<LockIcon class="size-5 text-primary/70" />
		<p>Members only. Sign in and get vouched for to see {what}.</p>
	</div>
{/if}
