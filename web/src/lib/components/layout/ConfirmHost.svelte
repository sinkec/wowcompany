<script lang="ts">
	// En dialog za vse potrditve na strani (lib/confirm.svelte.ts → ask()).
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { buttonVariants } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { confirmState, settle } from '#lib/confirm.svelte.js';

	let typed = $state('');
	const c = $derived(confirmState.current);
	const ok = $derived(!c?.typeToConfirm || typed.trim() === c.typeToConfirm);
	$effect(() => {
		if (c) typed = '';
	});
</script>

<AlertDialog.Root open={!!c} onOpenChange={(open) => !open && settle(false)}>
	<AlertDialog.Content>
		{#if c}
			<AlertDialog.Header>
				<AlertDialog.Title>{c.title}</AlertDialog.Title>
				{#if c.description}<AlertDialog.Description>{c.description}</AlertDialog.Description>{/if}
			</AlertDialog.Header>
			{#if c.typeToConfirm}
				<label class="space-y-1.5 text-sm">
					<span class="text-muted-foreground"
						>Type <b class="text-foreground">{c.typeToConfirm}</b> to confirm</span
					>
					<Input
						bind:value={typed}
						autocomplete="off"
						onkeydown={(e) => e.key === 'Enter' && ok && settle(true)}
					/>
				</label>
			{/if}
			<AlertDialog.Footer>
				<AlertDialog.Cancel onclick={() => settle(false)}
					>{c.cancel ?? 'Never mind'}</AlertDialog.Cancel
				>
				<AlertDialog.Action
					disabled={!ok}
					class={c.destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
					onclick={() => settle(true)}>{c.confirm ?? 'Do it'}</AlertDialog.Action
				>
			</AlertDialog.Footer>
		{/if}
	</AlertDialog.Content>
</AlertDialog.Root>
