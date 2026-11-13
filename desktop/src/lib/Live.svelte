<script lang="ts">
	import { api, fmtDuration, fmtNum, type Status } from './api';

	let { status }: { status: Status } = $props();
	const live = $derived(status.live);
	const maxDps = $derived(Math.max(1, ...(live?.players.map((p) => p.dps) ?? [1])));
	const sorted = $derived([...(live?.players ?? [])].sort((a, b) => b.dps - a.dps));
	const lastDeath = $derived(live?.deaths.at(-1) ?? null);
	const nameOf = (slug: string) => live?.players.find((p) => p.slug === slug)?.name ?? slug;

	function endRun() {
		if (confirm('End this run now and queue it for upload?')) api.endRun();
	}
</script>

{#if !live}
	<div class="wow-frame mx-auto max-w-xl space-y-3 rounded-lg p-8 text-center">
		<p class="text-4xl">🕯️</p>
		<h2 class="text-xl font-bold text-primary">No run in progress</h2>
		<p class="text-muted-foreground">
			{#if status.watch.dungeon}
				You're in <b>{status.watch.dungeon}</b>. The meter starts with the first pull — and it needs
				at least
				{status.settings.minPlayers} group members, solo heroes don't count.
			{:else}
				Enter a dungeon with your party. Make sure combat logging is on: type <code
					class="text-primary">/combatlog</code
				> in chat (every session — the game forgets, like your healer).
			{/if}
		</p>
		{#if status.watch.discardedSolo}
			<p class="text-xs text-muted-foreground">
				{status.watch.discardedSolo} solo run(s) ignored. Find some friends.
			</p>
		{/if}
	</div>
{:else}
	<section class="space-y-4">
		<div class="flex flex-wrap items-end gap-x-6 gap-y-2">
			<div>
				<h2 class="text-2xl font-bold text-primary">{live.zone.name}</h2>
				<p class="text-sm text-muted-foreground">
					{fmtDuration(live.durationMs)} · bosses {live.result.bossesKilled}{live.result.bossesTotal
						? `/${live.result.bossesTotal}`
						: ''}
					{#if live.result.wipes}· {live.result.wipes} wipe{live.result.wipes > 1 ? 's' : ''} 💀{/if}
					· {live.deaths.length} death{live.deaths.length === 1 ? '' : 's'}
				</p>
			</div>
			<button class="btn btn-outline ml-auto" onclick={endRun}>End run</button>
		</div>

		<div class="wow-frame overflow-hidden rounded-lg">
			<table class="w-full text-sm">
				<thead class="text-xs text-muted-foreground">
					<tr class="border-b border-border/50">
						<th class="px-3 py-2 text-left">Hero</th>
						<th class="w-1/3 px-3 py-2 text-left">DPS</th>
						<th class="px-3 py-2 text-right">Damage</th>
						<th class="px-3 py-2 text-right">HPS</th>
						<th class="px-3 py-2 text-right">Taken</th>
						<th class="px-3 py-2 text-right">Deaths</th>
					</tr>
				</thead>
				<tbody>
					{#each sorted as p (p.guid)}
						<tr class="border-b border-border/30 last:border-0">
							<td class="px-3 py-2 font-semibold {p.recorder ? 'text-primary' : ''}">{p.name}</td>
							<td class="px-3 py-2">
								<div class="flex items-center gap-2">
									<div class="h-2 flex-1 overflow-hidden rounded bg-muted">
										<div
											class="h-full rounded bg-primary/80"
											style="width: {(p.dps / maxDps) * 100}%"
										></div>
									</div>
									<span class="w-14 text-right tabular-nums">{p.dps.toFixed(1)}</span>
								</div>
							</td>
							<td class="px-3 py-2 text-right tabular-nums">{fmtNum(p.damage)}</td>
							<td class="px-3 py-2 text-right tabular-nums">{p.hps.toFixed(1)}</td>
							<td class="px-3 py-2 text-right tabular-nums">{fmtNum(p.damageTaken)}</td>
							<td class="px-3 py-2 text-right tabular-nums {p.deaths ? 'text-destructive' : ''}"
								>{p.deaths || ''}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if live.segments.length}
			<div class="flex flex-wrap gap-2">
				{#each live.segments.filter((s) => s.kind === 'boss') as s, i (i)}
					<span
						class="badge {s.result === 'kill'
							? 'bg-success/20 text-success'
							: s.result === 'wipe'
								? 'bg-destructive/20 text-destructive'
								: 'bg-primary/20 text-primary'}"
					>
						{s.result === 'kill' ? '☠' : s.result === 'wipe' ? '💀' : '⚔'}
						{s.name} · {fmtDuration(s.endMs - s.startMs)}
					</span>
				{/each}
			</div>
		{/if}

		{#if lastDeath}
			<p class="text-sm text-muted-foreground">
				Latest corpse: <b class="text-foreground">{nameOf(lastDeath.slug)}</b>
				{#if lastDeath.killer}— killed by {lastDeath.killer}{/if}
				{#if lastDeath.killingBlow}({lastDeath.killingBlow}){/if} at {fmtDuration(lastDeath.atMs)}.
			</p>
		{/if}
	</section>
{/if}
