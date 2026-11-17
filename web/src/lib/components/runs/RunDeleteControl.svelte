<script lang="ts">
	// Izbris runa na strani runa: Guild Master izbriše (s potrditvijo), član prosi z razlogom (potrdi
	// Guild Master v Office → Community → Petitions). Odprta prošnja = obvestilo nad runom.
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import Trash from '@lucide/svelte/icons/trash-2';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { ask } from '#lib/confirm.svelte.js';
	import { attempt } from '#lib/errors.js';
	import { ago } from '#lib/wow.js';

	let { runId, zone }: { runId: string; zone: string } = $props();
	const client = useConvexClient();
	const id = $derived(runId as Id<'runs'>);
	const st = useQuery(api.runDeletion.status, () => ({ runId: id }));

	let open = $state(false);
	let reason = $state('');

	async function adminDelete() {
		const ok = await ask({
			title: `Delete this ${zone} run?`,
			description:
				'Everything goes: the meter, loot, replay, parses and the records it set. There is no undo.',
			confirm: 'Delete run',
			destructive: true
		});
		if (!ok) return;
		if ((await attempt(client.mutation(api.runDeletion.remove, { runId: id }))) !== undefined) {
			toast.success('Run deleted. It never happened.');
			goto('/runs');
		}
	}
	async function sendRequest(e: SubmitEvent) {
		e.preventDefault();
		const r = await attempt(client.mutation(api.runDeletion.request, { runId: id, reason }));
		if (r !== undefined) {
			toast.success('Asked the Guild Master. Now we wait.');
			open = false;
			reason = '';
		}
	}
	const withdraw = () =>
		attempt(
			client.mutation(api.runDeletion.cancel, { runId: id }),
			st.data?.isAdmin ? 'Request declined. The run stays.' : 'Request withdrawn.'
		);
</script>

{#if st.data}
	{@const req = st.data.request}
	{#if req}
		<Alert.Root class="border-destructive/50 bg-destructive/10">
			<Trash class="text-red-300" />
			<Alert.Title>Deletion requested by {req.mine ? 'you' : req.name} · {ago(req.at)}</Alert.Title>
			<Alert.Description>“{req.reason}”</Alert.Description>
			<Alert.Action class="flex gap-2">
				{#if st.data.isAdmin}
					<Button size="sm" variant="destructive" onclick={adminDelete}>Delete</Button>
					<Button size="sm" variant="outline" onclick={withdraw}>Keep it</Button>
				{:else if req.mine}
					<Button size="sm" variant="outline" onclick={withdraw}>Withdraw</Button>
				{/if}
			</Alert.Action>
		</Alert.Root>
	{:else if st.data.isAdmin}
		<Button size="sm" variant="ghost" class="text-muted-foreground" onclick={adminDelete}
			><Trash class="size-4" /> Delete run…</Button
		>
	{:else}
		<Dialog.Root bind:open>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button {...props} size="sm" variant="ghost" class="text-muted-foreground"
						><Trash class="size-4" /> Request deletion…</Button
					>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content>
				<form class="space-y-4" onsubmit={sendRequest}>
					<Dialog.Header>
						<Dialog.Title>Ask to delete this run?</Dialog.Title>
						<Dialog.Description>
							The Guild Master decides. Tell them why – a test run, the wrong dungeon, a duplicate,
							crimes against healing.
						</Dialog.Description>
					</Dialog.Header>
					<Textarea bind:value={reason} maxlength={200} rows={3} placeholder="Why should it go?" />
					<Dialog.Footer>
						<Button type="button" variant="ghost" onclick={() => (open = false)}>Never mind</Button>
						<Button type="submit" disabled={reason.trim().length < 3}>Ask the Guild Master</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	{/if}
{/if}
