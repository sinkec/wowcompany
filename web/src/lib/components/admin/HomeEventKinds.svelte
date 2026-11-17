<script lang="ts">
	// Office → Website → Home page: katere vrste dogodkov pokaže "Coming up" na naslovnici.
	import { useConvexClient } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { ALL_KINDS, KIND_DOT, KIND_LABEL } from '#lib/calendar.js';
	import { attempt } from '#lib/errors.js';

	let { current }: { current: string[] } = $props();
	const client = useConvexClient();
	let draft = $state<string[] | null>(null);
	const kinds = $derived(draft ?? current);

	async function toggle(k: string, on: boolean) {
		const next = on ? [...new Set([...kinds, k])] : kinds.filter((x) => x !== k);
		draft = next;
		const r = await attempt(
			client.mutation(api.site.saveHomeEventKinds, { kinds: next }),
			`${KIND_LABEL[k]} ${on ? 'shown' : 'hidden'} on the home page.`
		);
		if (r === undefined) draft = null;
	}
</script>

<Card.Root class="space-y-3 p-5">
	<div>
		<h3 class="card-title">Coming up on the home page</h3>
		<p class="section-lead">
			Which events the home page lists. In-game holidays are off by default – there are a lot of
			them. Everyone can still switch any type on in the calendar.
		</p>
	</div>
	<ul class="grid gap-2 sm:grid-cols-4">
		{#each ALL_KINDS as k (k)}
			<li>
				<label class="flex cursor-pointer items-center gap-2 text-sm">
					<Checkbox checked={kinds.includes(k)} onCheckedChange={(on) => toggle(k, on === true)} />
					<span class="size-2 shrink-0 rounded-full {KIND_DOT[k]}"></span>{KIND_LABEL[k]}
				</label>
			</li>
		{/each}
	</ul>
</Card.Root>
