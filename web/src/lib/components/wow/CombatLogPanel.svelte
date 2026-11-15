<script lang="ts">
	// Statistika igralca, razvrščena kot WoW Combat Log Config: "My actions" in "What happened to me?",
	// kategorije Melee / Ranged / Spells / Periodic / Auras / Spell Casting / Miscellaneous.
	import type { CombatLogStats } from '#convex/lib/companionSchema.js';
	import { fmtNum, fmtRate } from '#lib/runs.js';

	let { combat, secs }: { combat: CombatLogStats; secs: number } = $props();

	type Row = { label: string; value: string; note?: string };
	type Block = { title: string; rows: Row[] };

	const MISS: Record<string, string> = {
		MISS: 'Miss',
		DODGE: 'Dodge',
		PARRY: 'Parry',
		BLOCK: 'Block',
		RESIST: 'Resist',
		ABSORB: 'Absorb',
		IMMUNE: 'Immune',
		EVADE: 'Evade',
		DEFLECT: 'Deflect',
		REFLECT: 'Reflect'
	};
	const per = (n: number) => `${fmtRate(n / Math.max(secs, 1))}/s`;
	const pctOf = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
	const keep = (rows: (Row | false | 0)[]) => rows.filter((r): r is Row => !!r);

	function hitRows(
		p: { amount: number; hits: number; crits: number; misses: number },
		dealt: boolean
	): Row[] {
		return keep([
			p.amount > 0 && {
				label: dealt ? 'Damage' : 'Damage taken',
				value: fmtNum(p.amount),
				note: per(p.amount)
			},
			p.hits > 0 && {
				label: 'Hits',
				value: fmtNum(p.hits),
				note: `${pctOf(p.crits, p.hits)} crit`
			},
			p.misses > 0 && {
				label: dealt ? 'Misses' : 'Avoided',
				value: fmtNum(p.misses),
				note: pctOf(p.misses, p.hits + p.misses)
			}
		]);
	}

	const mine = $derived.by((): Block[] => {
		const m = combat.mine;
		return [
			{ title: 'Melee', rows: hitRows(m.melee, true) },
			{ title: 'Ranged', rows: hitRows(m.ranged, true) },
			{
				title: 'Spells',
				rows: keep([
					...hitRows(m.spells, true),
					m.heals > 0 && { label: 'Heals', value: fmtNum(m.heals), note: per(m.heals) },
					m.powerGains > 0 && { label: 'Power gains', value: fmtNum(m.powerGains) },
					m.drains > 0 && { label: 'Drains', value: fmtNum(m.drains) },
					m.interrupts > 0 && { label: 'Interrupts', value: fmtNum(m.interrupts) },
					m.extraAttacks > 0 && { label: 'Extra attacks', value: fmtNum(m.extraAttacks) },
					m.summons > 0 && { label: 'Summons', value: fmtNum(m.summons) },
					m.resurrections > 0 && { label: 'Resurrections', value: fmtNum(m.resurrections) }
				])
			},
			{
				title: 'Periodic',
				rows: keep([
					...hitRows(m.periodic, true),
					m.periodicHeals > 0 && {
						label: 'Heals',
						value: fmtNum(m.periodicHeals),
						note: per(m.periodicHeals)
					}
				])
			},
			{
				title: 'Auras',
				rows: keep([m.dispels > 0 && { label: 'Dispels', value: fmtNum(m.dispels) }])
			},
			{
				title: 'Spell Casting',
				rows: keep([
					m.castsStarted > 0 && { label: 'Start', value: fmtNum(m.castsStarted) },
					m.casts > 0 && { label: 'Success', value: fmtNum(m.casts) },
					m.castsFailed > 0 && {
						label: 'Failures',
						value: fmtNum(m.castsFailed),
						note: m.failReasons
							.slice(0, 3)
							.map((r) => `${r.name} ×${r.count}`)
							.join(' · ')
					}
				])
			},
			{
				title: 'Miscellaneous',
				rows: keep([
					m.kills > 0 && { label: 'Kills', value: fmtNum(m.kills) },
					m.damageShields > 0 && { label: 'Damage shields', value: fmtNum(m.damageShields) }
				])
			}
		].filter((b) => b.rows.length);
	});

	const me = $derived.by((): Block[] => {
		const t = combat.me;
		return [
			{ title: 'Melee', rows: hitRows(t.melee, false) },
			{ title: 'Ranged', rows: hitRows(t.ranged, false) },
			{
				title: 'Spells',
				rows: keep([
					...hitRows(t.spells, false),
					t.healsReceived > 0 && {
						label: 'Heals received',
						value: fmtNum(t.healsReceived),
						note: per(t.healsReceived)
					}
				])
			},
			{ title: 'Periodic', rows: hitRows(t.periodic, false) },
			{
				title: 'Miscellaneous',
				rows: keep([
					{ label: 'Deaths', value: String(t.deaths), note: t.deaths ? 'rip' : 'not today' },
					t.environmental > 0 && {
						label: 'Environmental damage',
						value: fmtNum(t.environmental),
						note: 'lava, falling, slime – the floor fights back'
					}
				])
			}
		].filter((b) => b.rows.length);
	});
</script>

<div class="grid gap-3 md:grid-cols-2">
	{#each [{ title: 'My actions', blocks: mine, extra: combat.mine.misses, extraTitle: 'Misses by type' }, { title: 'What happened to me?', blocks: me, extra: combat.me.avoided, extraTitle: 'Avoided by type' }] as col (col.title)}
		<section class="rounded-md border border-border/50 p-3">
			<h4 class="mb-2 text-sm font-semibold text-primary">{col.title}</h4>
			{#each col.blocks as b (b.title)}
				<div class="mb-2">
					<div class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
						{b.title}
					</div>
					{#each b.rows as r (r.label)}
						<div class="flex items-baseline justify-between gap-2 text-xs">
							<span>{r.label}</span>
							<span class="text-right tabular-nums"
								><b>{r.value}</b>{#if r.note}<span class="ml-1 text-muted-foreground">{r.note}</span
									>{/if}</span
							>
						</div>
					{/each}
				</div>
			{/each}
			{#if col.extra.length}
				<div class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
					{col.extraTitle}
				</div>
				<div class="flex flex-wrap gap-x-3 text-xs">
					{#each col.extra as x (x.name)}
						<span>{MISS[x.name] ?? x.name} <b class="tabular-nums">{x.count}</b></span>
					{/each}
				</div>
			{/if}
		</section>
	{/each}
</div>
