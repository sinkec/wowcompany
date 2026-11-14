<script lang="ts">
	// Osebni rekordi lika, ki snema log – iz CELEGA loga (tudi open world), ne samo iz dungeon runov.
	import { ago, fmtNum, type PersonalRecord, type Status } from './api';

	let { status, ongo }: { status: Status; ongo: (tab: 'guide') => void } = $props();

	const KINDS: { kind: PersonalRecord['kind']; title: string; prep: string; quip: string }[] = [
		{ kind: 'crit', title: 'Biggest crit', prep: 'into', quip: 'The number you will not shut up about.' },
		{ kind: 'hit', title: 'Biggest hit', prep: 'into', quip: 'No crit, just honest violence.' },
		{ kind: 'critHeal', title: 'Biggest crit heal', prep: 'on', quip: 'Somebody was one sneeze from dying.' },
		{ kind: 'heal', title: 'Biggest heal', prep: 'on', quip: 'A band-aid the size of a tent.' },
		{ kind: 'hitTaken', title: 'Hardest hit taken', prep: 'from', quip: 'Caught it with your face.' }
	];
	const chars = $derived(status.records.characters);
</script>

<div class="max-w-3xl space-y-6">
	{#if !chars.length}
		<div class="wow-frame space-y-3 rounded-lg p-8 text-center">
			<p class="text-4xl">🎯</p>
			<h2 class="text-xl font-bold text-primary">No records yet</h2>
			<p class="text-muted-foreground">
				Hit something with <code class="text-primary">/combatlog</code> on. Your biggest crit, hit, heal
				and the worst slap you ever took are tracked everywhere — dungeons and open world.
			</p>
			<button class="btn btn-outline" onclick={() => ongo('guide')}>How to log</button>
		</div>
	{/if}

	{#each chars as c (c.slug)}
		<section class="wow-frame space-y-3 rounded-lg p-5">
			<h2 class="text-lg font-bold text-primary">{c.name}</h2>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each KINDS as k (k.kind)}
					{@const r = c.records.find((x) => x.kind === k.kind)}
					{#if r}
						<div class="rounded-md border border-border/60 p-3">
							<div class="text-xs tracking-wide text-muted-foreground uppercase">{k.title}</div>
							<div class="text-2xl font-bold text-primary tabular-nums">{fmtNum(r.amount)}</div>
							<div class="text-sm">
								{r.spell}{#if r.unit}{' '}<span class="text-muted-foreground">{k.prep}</span>{' '}{r.unit}{/if}
							</div>
							<div class="text-xs text-muted-foreground">
								{r.inDungeon ? '' : 'Open world · '}{r.zone ?? 'somewhere'} · {ago(r.at)}
							</div>
							<div class="mt-1 text-xs text-muted-foreground italic">{k.quip}</div>
						</div>
					{/if}
				{/each}
			</div>
		</section>
	{/each}

	{#if chars.length}
		<p class="text-xs text-muted-foreground">
			Only your own character is tracked here. Records go to the portal when the hero is on the roster;
			they stay on this PC even after the log files are deleted.
		</p>
	{/if}
</div>
