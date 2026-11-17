<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	// Arhiv starih realmov (samo člani, samo branje): junaki, runi, lestvice. Po 30 dneh izbris.
	import { useQuery } from 'convex-svelte';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import Download from '@lucide/svelte/icons/download';
	import { api } from '#convex/_generated/api.js';
	import PageHeader from '#lib/components/wow/PageHeader.svelte';
	import { ago, classColor, fmt } from '#lib/wow.js';
	import { fmtDuration } from '#lib/runs.js';

	const now = Date.now();
	const list = useQuery(api.realms.list, { now });
	let picked = $state<string | null>(null);
	const key = $derived(picked ?? list.data?.[0]?.key ?? null);
	const archive = $derived(list.data?.find((a) => a.key === key) ?? null);
	const contents = useQuery(api.realms.contents, () => (key ? { key } : 'skip'));

	function download() {
		if (!archive || !contents.data) return;
		const blob = new Blob(
			[
				JSON.stringify(
					{ realm: archive.label, archivedAt: archive.archivedAt, ...contents.data },
					null,
					2
				)
			],
			{ type: 'application/json' }
		);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `wowcompany-archive-${archive.key}.json`;
		a.click();
		URL.revokeObjectURL(a.href);
	}
</script>

<svelte:head><title>Archive — WowCompany</title></svelte:head>

<div class="space-y-6">
	<PageHeader
		title="The Archive"
		icon={ArchiveIcon}
		lead="Realms the company left behind. Read-only, members only, and gone for good 30 days after the move – unless the company moves back."
	/>

	{#if list.isLoading}
		<div class="h-48 animate-pulse rounded-lg bg-muted"></div>
	{:else if list.data === null}
		<p class="panel text-center text-sm text-muted-foreground">
			Members only. Sign in and get vouched for to dig through the old bones.
		</p>
	{:else if !list.data?.length}
		<p class="panel text-center text-sm text-muted-foreground italic">
			Nothing archived. The company never moved – loyal, or just lazy.
		</p>
	{:else}
		<ToggleGroup.Root
			type="single"
			variant="outline"
			spacing={1}
			class="flex-wrap"
			aria-label="Archived realm"
			bind:value={() => key ?? '', (v) => v && (picked = v)}
		>
			{#each list.data as a (a.key)}
				<ToggleGroup.Item value={a.key}>{a.label}</ToggleGroup.Item>
			{/each}
		</ToggleGroup.Root>

		{#if archive}
			<Card.Root
			 class="p-5 flex flex-wrap items-center justify-between gap-3 {archive.daysLeft <= 7 ? 'border-destructive/70' : ''}"
			>
				<div>
					<div class="eyebrow">Archived {ago(archive.archivedAt)}</div>
					<div class="section-title">{archive.label}</div>
					<p class="section-lead {archive.daysLeft <= 7 ? 'text-destructive' : ''}">
						{#if archive.purging}Being deleted right now.
						{:else}Deleted in <b>{archive.daysLeft}</b> day{archive.daysLeft === 1 ? '' : 's'}
							({new Date(archive.deleteAt).toLocaleDateString()}). {archive.daysLeft <= 7
								? 'Download it now if you want to keep anything.'
								: ''}{/if}
					</p>
				</div>
				<Button size="lg" disabled={!contents.data} onclick={download}
					><Download class="size-4" /> Download (JSON)</Button
				>
			</Card.Root>

			{#if contents.data}
				{@const c = contents.data}
				<section class="space-y-3">
					<h2 class="section-title">Heroes ({c.heroes.length})</h2>
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{#each c.heroes as h (h.slug)}
							<Card.Root class="p-5 flex items-center gap-3 !p-3">
								{#if h.avatar}<img
										src={h.avatar}
										alt=""
										class="size-10 rounded-full border-2"
										style="border-color: {classColor(h.classId ?? undefined)}"
									/>{/if}
								<div class="min-w-0">
									<div
										class="truncate font-semibold"
										style="color: {classColor(h.classId ?? undefined)}"
									>
										{h.name}
									</div>
									<div class="stat-label">
										{#if h.level}Level {h.level} {h.race} {h.className}{/if}
										{#if h.ilvl}· ilvl {h.ilvl}{/if}
										{#if h.deaths != null}· {fmt(h.deaths)} deaths{/if}
									</div>
								</div>
							</Card.Root>
						{/each}
					</div>
				</section>

				{#if c.seasons.length}
					<section class="space-y-2">
						<h2 class="section-title">Ladders</h2>
						<div class="flex flex-wrap gap-2">
							{#each c.seasons as s (s.number)}
								<a
									href="/rankings?season={s.number}"
									class="rounded-md border border-border px-3 py-1.5 text-sm hover:border-primary"
									>{s.name}</a
								>
							{/each}
						</div>
					</section>
				{/if}

				<section class="space-y-2">
					<h2 class="section-title">Dungeon runs ({archive.runs})</h2>
					<ul class="panel divide-y divide-border/40 !p-0">
						{#each c.runs as r (r.id)}
							<li>
								<a
									href="/runs/{r.id}"
									class="flex flex-wrap items-baseline justify-between gap-2 p-3 hover:bg-accent/30"
								>
									<span
										><b class="text-primary">{r.zone}</b>
										<span class="text-xs text-muted-foreground"
											>{new Date(r.startedAt).toLocaleDateString()} · {fmtDuration(r.durationMs)} · bosses
											{r.bossesKilled}{r.bossesTotal ? `/${r.bossesTotal}` : ''}</span
										></span
									>
									<span class="truncate text-xs text-muted-foreground">{r.party.join(', ')}</span>
								</a>
							</li>
						{:else}
							<li class="p-3 text-sm text-muted-foreground italic">No runs in this archive.</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}
	{/if}
</div>
