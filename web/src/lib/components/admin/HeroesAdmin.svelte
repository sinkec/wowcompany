<script lang="ts">
	// Office → Community → Heroes: dodaj junaka neposredno + seznam (sortiranje po stolpcih, izgon).
	import { useConvexClient } from 'convex-svelte';
	import { toast } from 'svelte-sonner';
	import Trash from '@lucide/svelte/icons/trash-2';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import SortHead from '#lib/components/table/SortHead.svelte';
	import { attempt } from '#lib/errors.js';
	import { TableSort } from '#lib/sort.svelte.js';
	import { ago, classColor } from '#lib/wow.js';

	type Row = {
		id: Id<'players'>;
		slug: string;
		displayName: string;
		owner: string | null;
		level: number | null;
		className: string | null;
		classId: number | null;
		updatedAt: number | null;
	};
	let { players }: { players: Row[] } = $props();
	const client = useConvexClient();

	let addName = $state('');
	let adding = $state(false);
	async function addHero(e: SubmitEvent) {
		e.preventDefault();
		if (adding || addName.trim().length < 3) return;
		adding = true;
		const r = await attempt(client.action(api.admin.addPlayer, { name: addName }));
		adding = false;
		if (!r) return;
		if (r.ok) {
			toast.success(`${r.name} (lvl ${r.level}) added. Data arrives within a minute.`);
			addName = '';
		} else toast.error(r.error);
	}

	const sort = new TableSort<'hero' | 'level' | 'owner' | 'updated'>('level');
	const rows = $derived(
		sort.apply(players, {
			hero: (p) => p.displayName,
			level: (p) => p.level,
			owner: (p) => p.owner,
			updated: (p) => p.updatedAt
		})
	);
</script>

<div class="space-y-4">
	<form onsubmit={addHero} class="wow-frame flex flex-wrap items-end gap-3 rounded-lg p-4">
		<div class="min-w-60 flex-1">
			<label for="add" class="text-sm font-semibold text-primary">Add a hero directly</label>
			<Input id="add" bind:value={addName} placeholder="Firstname Surname" disabled={adding} />
		</div>
		<Button type="submit" disabled={adding || addName.trim().length < 3}
			>{adding ? 'Asking Blizzard…' : 'Add'}</Button
		>
	</form>
	<div class="wow-frame overflow-hidden rounded-lg">
		<Table.Root>
			<Table.Header>
				<Table.Row class="text-xs uppercase hover:bg-transparent">
					<SortHead {sort} key="hero" first="asc" class="px-3">Hero</SortHead>
					<SortHead {sort} key="level" class="px-3">Level</SortHead>
					<SortHead {sort} key="owner" first="asc" class="px-3">Owner</SortHead>
					<SortHead {sort} key="updated" class="px-3">Updated</SortHead>
					<Table.Head><span class="sr-only">Actions</span></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each rows as p (p.id)}
					<Table.Row>
						<Table.Cell class="px-3">
							<a
								href="/c/{p.slug}"
								class="font-medium hover:underline"
								style="color: {classColor(p.classId ?? 0)}">{p.displayName}</a
							>
							<div class="text-xs text-muted-foreground">{p.className ?? 'no data yet'}</div>
						</Table.Cell>
						<Table.Cell class="px-3 tabular-nums">{p.level ?? '–'}</Table.Cell>
						<Table.Cell class="px-3 text-muted-foreground">{p.owner ?? 'added by you'}</Table.Cell>
						<Table.Cell class="px-3 text-muted-foreground"
							>{p.updatedAt ? ago(p.updatedAt) : 'pending'}</Table.Cell
						>
						<Table.Cell class="px-3 text-right">
							<AlertDialog.Root>
								<AlertDialog.Trigger
									class={buttonVariants({ variant: 'ghost', size: 'sm' })}
									aria-label="Banish {p.displayName}"
								>
									<Trash class="size-4" />
								</AlertDialog.Trigger>
								<AlertDialog.Content>
									<AlertDialog.Header>
										<AlertDialog.Title>Banish {p.displayName}?</AlertDialog.Title>
										<AlertDialog.Description>
											All their history, gossip and shameful stats get deleted. Forever. Like their
											dignity.
										</AlertDialog.Description>
									</AlertDialog.Header>
									<AlertDialog.Footer>
										<AlertDialog.Cancel>Spare them</AlertDialog.Cancel>
										<AlertDialog.Action
											onclick={() =>
												attempt(
													client.mutation(api.admin.removePlayer, { playerId: p.id }),
													`${p.displayName} banished.`
												)}>Banish</AlertDialog.Action
										>
									</AlertDialog.Footer>
								</AlertDialog.Content>
							</AlertDialog.Root>
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={5} class="p-6 text-center text-muted-foreground italic"
							>Empty roster. Lonely at the top.</Table.Cell
						>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
