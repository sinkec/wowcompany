<script lang="ts">
	// Office → Community → Petitions: prošnje članov za izbris runa (Delete / Keep).
	import { useConvexClient } from 'convex-svelte';
	import Trash from '@lucide/svelte/icons/trash-2';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { ask } from '#lib/confirm.svelte.js';
	import { attempt } from '#lib/errors.js';
	import { fmtWhen } from '#lib/datetime.svelte.js';
	import { fmtDuration } from '#lib/runs.js';
	import { ago } from '#lib/wow.js';

	type Row = {
		runId: Id<'runs'>;
		zone: string;
		startedAt: number;
		durationMs: number;
		party: string[];
		request: { name: string; reason: string; at: number };
	};
	let { rows }: { rows: Row[] } = $props();
	const client = useConvexClient();

	async function del(r: Row) {
		const ok = await ask({
			title: `Delete the ${r.zone} run?`,
			description: `${r.request.name} asked: “${r.request.reason}”. Meter, loot, replay, parses and its records go. No undo.`,
			confirm: 'Delete run',
			destructive: true
		});
		if (ok)
			await attempt(
				client.mutation(api.runDeletion.remove, { runId: r.runId }),
				'Run deleted. History rewritten.'
			);
	}
	const keep = (r: Row) =>
		attempt(
			client.mutation(api.runDeletion.cancel, { runId: r.runId }),
			`Kept. ${r.request.name} will have to live with it.`
		);
</script>

{#if rows.length}
	<section class="space-y-3">
		<h2 class="section-title flex items-center gap-2">
			<Trash class="size-5 text-primary" /> Run deletion requests
		</h2>
		<ul class="grid gap-3 md:grid-cols-2">
			{#each rows as r (r.runId)}
				<li>
					<Card.Root class="space-y-3 p-4">
						<div>
							<a
								href="/runs/{r.runId}"
								class="font-display text-lg font-semibold text-primary hover:underline">{r.zone}</a
							>
							<p class="text-xs text-muted-foreground">
								{fmtWhen(r.startedAt)} · {fmtDuration(r.durationMs)} · {r.party.join(', ')}
							</p>
						</div>
						<p class="text-sm">
							<b>{r.request.name}</b>
							<span class="text-muted-foreground">· {ago(r.request.at)}</span><br />
							“{r.request.reason}”
						</p>
						<div class="flex gap-2">
							<Button size="sm" variant="destructive" onclick={() => del(r)}>Delete run</Button>
							<Button size="sm" variant="outline" onclick={() => keep(r)}>Keep it</Button>
						</div>
					</Card.Root>
				</li>
			{/each}
		</ul>
	</section>
{/if}
