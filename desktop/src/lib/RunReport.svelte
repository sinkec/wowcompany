<script lang="ts">
	// Poročilo runa v Companionu (brez portala): povzetek, nagrade, party, bossi, smrti, loot in
	// pridobitve snemalca. Bere celoten shranjen run (get_run).
	import { api, fmtDuration, fmtNum, qualityColor, type FullRun } from './api';

	let { runKey, onclose }: { runKey: string; onclose: () => void } = $props();

	let run = $state<FullRun | null>(null);
	let missing = $state(false);
	$effect(() => {
		api.getRun(runKey).then((r) => {
			run = r;
			missing = !r;
		});
	});

	const secs = $derived(run ? Math.max(1, run.durationMs / 1000) : 1);
	const party = $derived([...(run?.players ?? [])].sort((a, b) => b.damage - a.damage));
	const name = (slug: string | null) =>
		(slug && run?.players.find((p) => p.slug === slug)?.name) || slug || 'nobody';
	const top = (f: (p: FullRun['players'][number]) => number) =>
		[...(run?.players ?? [])].sort((a, b) => f(b) - f(a))[0];
	const bosses = $derived((run?.segments ?? []).filter((s) => s.kind === 'boss'));
	const at = (ms: number) => fmtDuration(Math.max(0, ms));
	const gold = (c: number) =>
		[
			[Math.floor(c / 10000), 'g'],
			[Math.floor(c / 100) % 100, 's'],
			[c % 100, 'c']
		]
			.filter(([n]) => n)
			.map(([n, u]) => `${n}${u}`)
			.join(' ') || '0c';

	const awards = $derived.by(() => {
		if (!run?.players.length) return [];
		const out: { title: string; who: string; why: string }[] = [];
		const mvp = top((p) => p.damage);
		if (mvp?.damage) out.push({ title: 'MVP', who: mvp.name, why: `${fmtNum(mvp.dps)} DPS` });
		const medic = top((p) => p.healing);
		if (medic?.healing)
			out.push({ title: 'Medic', who: medic.name, why: `${fmtNum(medic.hps)} HPS` });
		const sponge = top((p) => p.damageTaken);
		if (sponge?.damageTaken)
			out.push({ title: 'Damage sponge', who: sponge.name, why: `${fmtNum(sponge.damageTaken)} taken` });
		const corpse = top((p) => p.deaths);
		out.push(
			corpse?.deaths
				? { title: 'Floor inspector', who: corpse.name, why: `${corpse.deaths} death${corpse.deaths > 1 ? 's' : ''}` }
				: { title: 'Nobody died', who: 'the whole party', why: 'suspicious' }
		);
		const kicker = top((p) => p.interrupts);
		if (kicker?.interrupts)
			out.push({ title: 'Kick master', who: kicker.name, why: `${kicker.interrupts} interrupt${kicker.interrupts > 1 ? "s" : ""}` });
		return out;
	});
</script>

<div class="space-y-4">
	<button class="btn btn-outline" onclick={onclose}>← All runs</button>

	{#if missing}
		<p class="text-muted-foreground">This run is gone from this PC.</p>
	{:else if !run}
		<p class="text-muted-foreground">Unrolling the scroll…</p>
	{:else}
		<header>
			<h2 class="text-2xl font-bold text-primary">{run.zone.name}</h2>
			<p class="text-sm text-muted-foreground">
				{new Date(run.startedAt).toLocaleString()} · {fmtDuration(run.durationMs)} · bosses
				{run.result.bossesKilled}{run.result.bossesTotal ? `/${run.result.bossesTotal}` : ''}
				{#if run.result.cleared}· <b class="text-success">cleared</b>{/if}
				{#if run.result.wipes}· {run.result.wipes} wipe{run.result.wipes > 1 ? 's' : ''}{/if}
				· {run.deaths.length} death{run.deaths.length === 1 ? '' : 's'}
			</p>
		</header>

		{#if awards.length}
			<div class="grid grid-cols-2 gap-2 md:grid-cols-5">
				{#each awards as a (a.title)}
					<div class="wow-frame rounded-lg p-3">
						<div class="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
							{a.title}
						</div>
						<div class="truncate font-semibold text-primary">{a.who}</div>
						<div class="text-xs text-muted-foreground">{a.why}</div>
					</div>
				{/each}
			</div>
		{/if}

		<section class="wow-frame overflow-x-auto rounded-lg">
			<table class="w-full text-sm">
				<thead class="text-left text-[11px] tracking-wider text-muted-foreground uppercase">
					<tr class="border-b border-border/60">
						<th class="p-2">Hero</th>
						<th class="p-2 text-right">Damage</th>
						<th class="p-2 text-right">DPS</th>
						<th class="p-2 text-right">Healing</th>
						<th class="p-2 text-right">HPS</th>
						<th class="p-2 text-right">Taken</th>
						<th class="p-2 text-right">Kicks</th>
						<th class="p-2 text-right">Deaths</th>
					</tr>
				</thead>
				<tbody class="tabular-nums">
					{#each party as p (p.slug)}
						<tr class="border-b border-border/30 last:border-0">
							<td class="p-2 font-medium {p.recorder ? 'text-primary' : ''}">
								{p.name}{#if p.level}<span class="ml-1 text-xs text-muted-foreground">{p.level}</span>{/if}
							</td>
							<td class="p-2 text-right">{fmtNum(p.damage)}</td>
							<td class="p-2 text-right">{fmtNum(p.dps)}</td>
							<td class="p-2 text-right">{fmtNum(p.healing)}</td>
							<td class="p-2 text-right">{fmtNum(p.hps)}</td>
							<td class="p-2 text-right">{fmtNum(p.damageTaken)}</td>
							<td class="p-2 text-right">{p.interrupts}</td>
							<td class="p-2 text-right {p.deaths ? 'text-destructive' : ''}">{p.deaths}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<div class="grid gap-4 md:grid-cols-2">
			{#if bosses.length}
				<section class="wow-frame space-y-2 rounded-lg p-4">
					<h3 class="font-semibold text-primary">Bosses</h3>
					<ul class="space-y-1.5 text-sm">
						{#each bosses as b, i (i)}
							{@const best = [...b.players].sort((x, y) => y.damage - x.damage)[0]}
							{@const len = Math.max(1, (b.endMs - b.startMs) / 1000)}
							<li class="flex items-baseline justify-between gap-2">
								<span>
									{b.result === 'kill' ? '⚔️' : b.result === 'wipe' ? '💀' : '·'}
									<b>{b.name}</b>
									<span class="text-xs text-muted-foreground">at {at(b.startMs)}</span>
								</span>
								<span class="text-right text-xs text-muted-foreground">
									{fmtDuration(b.endMs - b.startMs)}{#if best?.damage}
										· top {name(best.slug)} {fmtNum(best.damage / len)} DPS{/if}
								</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="wow-frame space-y-2 rounded-lg p-4">
				<h3 class="font-semibold text-primary">Deaths</h3>
				{#if run.deaths.length}
					<ul class="max-h-56 space-y-1 overflow-y-auto text-sm">
						{#each run.deaths as d, i (i)}
							<li>
								<span class="text-xs text-muted-foreground tabular-nums">{at(d.atMs)}</span>
								<b>{name(d.slug)}</b>
								{#if d.killer}<span class="text-muted-foreground">
										by {d.killer}{#if d.killingBlow} ({d.killingBlow}){/if}</span
									>{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-muted-foreground italic">Nobody died. Write it down, it won't happen again.</p>
				{/if}
			</section>

			{#if run.loot.length}
				<section class="wow-frame space-y-2 rounded-lg p-4">
					<h3 class="font-semibold text-primary">Loot</h3>
					<ul class="max-h-56 space-y-1 overflow-y-auto text-sm">
						{#each run.loot as l, i (i)}
							<li class="flex justify-between gap-2">
								<span style="color: {qualityColor(l.quality)}"
									>[{l.item}]{#if l.count > 1} ×{l.count}{/if}</span
								>
								<span class="truncate text-muted-foreground">{l.looter}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if run.progress}
				{@const g = run.progress}
				<section class="wow-frame space-y-2 rounded-lg p-4">
					<h3 class="font-semibold text-primary">Coin & glory <span class="text-xs font-normal text-muted-foreground">(you)</span></h3>
					<dl class="grid grid-cols-2 gap-2 text-sm">
						<div><dt class="text-xs text-muted-foreground">Experience</dt><dd class="font-semibold tabular-nums">{fmtNum(g.xp)}{#if g.xpBonus}<span class="text-xs text-muted-foreground"> (+{fmtNum(g.xpBonus)} group)</span>{/if}</dd></div>
						<div><dt class="text-xs text-muted-foreground">Money</dt><dd class="font-semibold tabular-nums text-[#ffd100]">{gold(g.copper)}</dd></div>
					</dl>
					{#if g.levels.length}<p class="text-sm">Ding! Level {g.levels.join(', ')} 🎉</p>{/if}
					{#each g.reputation as r (r.faction)}
						<p class="text-sm">{r.faction} <span class="text-success">+{fmtNum(r.amount)}</span></p>
					{/each}
					{#each g.skills as s (s.skill)}
						<p class="text-sm">{s.skill} {s.from} → <b>{s.to}</b></p>
					{/each}
					{#if g.castFails?.total}
						<p class="text-xs text-muted-foreground">
							{g.castFails.total} failed casts – {g.castFails.spam} of them pressing it before it was ready. The keyboard filed a complaint.
						</p>
					{/if}
				</section>
			{/if}
		</div>
	{/if}
</div>
