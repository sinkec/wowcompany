// Discord: objava dungeon runa in /parses (Company Parses). Čiste funkcije – testi v tests/discord-runs.test.ts.
// Vidnost kot povsod v Discordu: `runs` = objava sploh, `runDetails` = številke in parsi, `runDeaths` = smrti.

type Embed = Record<string, unknown>;

/** Barvni znak parsa (Discord nima barvnega besedila). */
export function parseEmoji(pct: number | null): string {
	if (pct === null) return '▫️';
	if (pct >= 100) return '🏆';
	if (pct >= 99) return '💗';
	if (pct >= 95) return '🟧';
	if (pct >= 75) return '🟪';
	if (pct >= 50) return '🟦';
	if (pct >= 25) return '🟩';
	return '⬜';
}

const mmss = (ms: number) => {
	const s = Math.round(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const r = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};
const rate = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1));

export type RunPost = {
	id: string;
	zone: string;
	durationMs: number;
	result: { bossesKilled: number; bossesTotal: number | null; wipes: number; cleared: boolean };
	leader: string | null;
	party: { slug: string; name: string; damage: number; healing: number; deaths: number }[];
	awards: { title: string; slug: string; detail: string }[];
	standings: {
		slug: string;
		avg: number | null;
		best: { encounter: string; pct: number } | null;
	}[];
	dice: { slug: string; avg: number; wins: number }[];
};

export function runEmbed(r: RunPost, fields: string[], site?: string): Embed | null {
	const ok = (f: string) => fields.includes(f);
	if (!ok('runs')) return null;
	const name = (slug: string) => r.party.find((p) => p.slug === slug)?.name ?? slug;
	const secs = Math.max(1, r.durationMs / 1000);
	const bosses =
		r.result.bossesTotal !== null
			? `${r.result.bossesKilled}/${r.result.bossesTotal} bosses`
			: `${r.result.bossesKilled} boss${r.result.bossesKilled === 1 ? '' : 'es'}`;
	const out: { name: string; value: string; inline?: boolean }[] = [];
	if (ok('runDetails')) {
		const pct = new Map(r.standings.map((s) => [s.slug, s]));
		const lines = [...r.party]
			.sort((a, b) => b.damage - a.damage)
			.map((p) => {
				const s = pct.get(p.slug);
				const parse = s ? ` ${parseEmoji(s.avg)} ${s.avg ?? '–'}` : '';
				const heal = p.healing > p.damage ? ` · ${rate(p.healing / secs)} hps` : '';
				return `**${p.name}** ${rate(p.damage / secs)} dps${heal}${parse}`;
			});
		out.push({ name: 'Party (avg Company Parse)', value: lines.join('\n').slice(0, 1024) });
		const best = r.standings.filter((s) => s.best).sort((a, b) => b.best!.pct - a.best!.pct)[0];
		if (best?.best)
			out.push({
				name: 'Parse of the run',
				value: `${parseEmoji(best.best.pct)} **${name(best.slug)}** ${best.best.pct} on ${best.best.encounter}`
			});
		if (r.awards.length)
			out.push({
				name: 'Awards',
				value: r.awards
					.slice(0, 3)
					.map((a) => `**${a.title}** – ${name(a.slug)}: ${a.detail}`)
					.join('\n')
					.slice(0, 1024)
			});
	}
	if (ok('runDeaths')) {
		const dead = r.party.filter((p) => p.deaths > 0).sort((a, b) => b.deaths - a.deaths);
		out.push({
			name: 'Deaths',
			value: dead.length
				? dead.map((p) => `${p.name} ☠️×${p.deaths}`).join(' · ')
				: 'Nobody died. Suspicious.',
			inline: true
		});
	}
	if (ok('runLoot') && r.dice.length > 1) {
		const sorted = [...r.dice].sort((a, b) => b.avg - a.avg);
		const lucky = sorted[0];
		const cursed = sorted[sorted.length - 1];
		out.push({
			name: 'Dice',
			value: `🎲 ${name(lucky.slug)} (avg ${lucky.avg}, ${lucky.wins} won) · 💀 ${name(cursed.slug)} (avg ${cursed.avg})`,
			inline: true
		});
	}
	const url = site ? `${site}/runs/${r.id}` : undefined;
	return {
		title: `⚔️ ${r.zone} — ${bosses}${r.result.cleared ? ' (cleared)' : ''}, ${mmss(r.durationMs)}`,
		...(url ? { url } : {}),
		description: [
			r.result.wipes ? `${r.result.wipes} wipe${r.result.wipes === 1 ? '' : 's'}. ` : '',
			r.leader ? `Led by **${r.leader}**, allegedly.` : ''
		]
			.join('')
			.trim(),
		color: r.result.cleared ? 0x1eff00 : 0xffd100,
		fields: out
	};
}

export type HeroParses = {
	name: string;
	slug: string;
	season: string;
	bestPerfAvg: number | null;
	medianPerfAvg: number | null;
	encounters: {
		encounter: string;
		zone: string;
		role: string;
		best: number;
		bestPct: number | null;
		kills: number;
	}[];
};

export function parsesEmbed(h: HeroParses, fields: string[], site?: string): Embed | null {
	if (!fields.includes('runs') || !fields.includes('runDetails')) return null;
	const zones = new Map<string, string[]>();
	for (const e of h.encounters) {
		const unit = e.role === 'heal' ? 'hps' : 'dps';
		const line = `${parseEmoji(e.bestPct)} ${e.encounter} **${e.bestPct ?? '–'}** · ${rate(e.best)} ${unit} · ${e.kills} kill${e.kills === 1 ? '' : 's'}`;
		zones.set(e.zone, [...(zones.get(e.zone) ?? []), line]);
	}
	return {
		title: `${h.name} — Company Parses (${h.season})`,
		...(site ? { url: `${site}/c/${h.slug}` } : {}),
		description: h.encounters.length
			? `Best avg ${parseEmoji(h.bestPerfAvg)} **${h.bestPerfAvg ?? '–'}** · median avg ${h.medianPerfAvg ?? '–'}`
			: 'No boss kills this season. Either busy, or bad.',
		color: 0xa335ee,
		fields: [...zones.entries()].slice(0, 25).map(([zone, lines]) => ({
			name: zone,
			value: lines.join('\n').slice(0, 1024)
		}))
	};
}
