// bun scripts/companion-seed.ts [--clean] — SAMO DEV: naloži 3 realistične izmišljene dungeon rune
// (junaki iz dev baze) prek pravega HTTP API-ja, da se da pregledati /runs in /runs/[id].
// --clean pobriše rune in napravo, ki jih je ustvarila ta skripta (runKey se začne z "5eed").
import { $ } from 'bun';

const env = Object.fromEntries(
	(await Bun.file('.env.local').text())
		.split('\n')
		.map((l) => l.match(/^([A-Z_]+)=(.*)$/))
		.filter((m): m is RegExpMatchArray => !!m)
		.map((m) => [m[1], m[2].replace(/^"|"$/g, '')])
);
const SITE = env.PUBLIC_CONVEX_SITE_URL;
if (!SITE || !env.CONVEX_DEPLOYMENT?.startsWith('dev:'))
	throw new Error('needs a dev deployment in .env.local');
process.env.CONVEX_TMPDIR ??= `${process.cwd()}/node_modules/.convex-tmp`;

const data = async (table: string) =>
	(await $`bunx convex data ${table} --format jsonLines --limit 500`.quiet())
		.text()
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l));
const run = async (fn: string, args: object) =>
	(await $`bunx convex run ${fn} ${JSON.stringify(args)}`.quiet()).text();

if (process.argv.includes('--clean')) {
	for (const r of await data('runs'))
		if (String(r.runKey).startsWith('5eed')) await run('companion:deleteRun', { runId: r._id });
	for (const d of await data('devices'))
		if (d.name === 'Seed Box') await run('companion:deleteDevice', { deviceId: d._id });
	console.log('seed data removed');
	process.exit(0);
}

// --- naprava
const post = async (path: string, body: unknown, token?: string) => {
	const r = await fetch(`${SITE}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify(body)
	});
	return { status: r.status, body: await r.json() };
};
const userId = (await data('roles')).find((r) => r.role === 'admin' || r.role === 'member')?.userId;
const start = await post('/companion/link/start', { deviceName: 'Seed Box', appVersion: 'seed' });
await run('companion:approveLinkAs', { code: start.body.code, userId });
const { token } = (await post('/companion/link/poll', { pollToken: start.body.pollToken })).body;

// --- junaki iz dev baze (po razredih: tank, healer, 3 dps)
const heroes = (await data('summaries')) as {
	slug: string;
	name: string;
	surname: string;
	classId: number;
}[];
const pick = (cls: number[], not: string[]) =>
	heroes.find((h) => cls.includes(h.classId) && !not.includes(h.slug))!;
function party() {
	const used: string[] = [];
	const take = (cls: number[]) => {
		const h = pick(cls, used) ?? heroes.find((x) => !used.includes(x.slug))!;
		used.push(h.slug);
		return h;
	};
	return [take([1]), take([7, 2, 11]), take([8]), take([4]), take([3, 9])];
}

let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const key = () => '5eed' + [...Array(12)].map(() => Math.floor(rnd() * 16).toString(16)).join('');

type Boss = { id: number; name: string; dur: number; wipeFirst?: boolean };
function makeRun(
	zone: { id: number; name: string; bosses: number },
	bosses: Boss[],
	minutes: number,
	hoursAgo: number
) {
	const p = party();
	const durationMs = minutes * 60_000;
	const startedAt = Date.now() - hoursAgo * 3_600_000;
	const bucket = 10_000;
	const n = Math.ceil(durationMs / bucket);
	const role = ['tank', 'heal', 'dps', 'dps', 'dps'];
	const base = [9, 2, 34, 28, 24];
	const segments: any[] = [];
	let t = 60_000;
	for (const b of bosses) {
		const pullDur = b.dur * 1000;
		t += Math.floor((durationMs - 60_000) / (bosses.length + 1) / 2);
		if (b.wipeFirst) {
			segments.push({
				kind: 'boss',
				name: b.name,
				encounterId: b.id,
				startMs: t,
				endMs: t + 40_000,
				result: 'wipe',
				players: []
			});
			t += 40_000 + 90_000;
		}
		segments.push({
			kind: 'boss',
			name: b.name,
			encounterId: b.id,
			startMs: t,
			endMs: t + pullDur,
			result: 'kill',
			players: []
		});
		t += pullDur + Math.floor((durationMs - 60_000) / (bosses.length + 1) / 2);
	}
	const tl = p.map((h, i) => ({
		slug: h.slug,
		damage: [...Array(n)].map((_, k) => {
			const inBoss = segments.some((s) => k * bucket >= s.startMs && k * bucket < s.endMs);
			return rnd() < 0.35 ? 0 : Math.round(base[i] * 10 * (inBoss ? 1.6 : 1) * (0.5 + rnd()));
		}),
		healing: [...Array(n)].map(() =>
			role[i] === 'heal' && rnd() > 0.3 ? Math.round(180 * (0.4 + rnd())) : 0
		),
		taken: [...Array(n)].map(() =>
			rnd() < 0.4 ? 0 : Math.round((role[i] === 'tank' ? 160 : 35) * (0.3 + rnd()))
		)
	}));
	const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
	for (const s of segments)
		s.players = tl.map((x) => {
			const r = (a: number[]) =>
				sum(a.slice(Math.floor(s.startMs / bucket), Math.ceil(s.endMs / bucket)));
			return { slug: x.slug, damage: r(x.damage), healing: r(x.healing), damageTaken: r(x.taken) };
		});
	const deathsBy = [0, 1, 3, 0, 1];
	const deaths: any[] = [];
	p.forEach((h, i) => {
		for (let d = 0; d < deathsBy[i]; d++) {
			const at = Math.floor(rnd() * (durationMs - 120_000)) + 60_000;
			const lava = i === 2 && d === 0;
			deaths.push({
				slug: h.slug,
				atMs: at,
				killer: lava ? null : bosses[d % bosses.length].name,
				killingBlow: lava ? 'Lava' : ['Fireball', 'Cleave', 'Shadow Bolt'][d % 3],
				recap: [
					{
						atMs: -4200,
						source: bosses[0].name,
						spell: 'Melee',
						amount: -120,
						overkill: 0,
						hp: 610,
						maxHp: 900
					},
					{
						atMs: -2900,
						source: `${p[1].name} ${p[1].surname}`,
						spell: 'Lesser Heal',
						amount: 180,
						overkill: 0,
						hp: 790,
						maxHp: 900
					},
					{
						atMs: -1500,
						source: bosses[0].name,
						spell: 'Fireball',
						amount: -450,
						overkill: 0,
						hp: 340,
						maxHp: 900
					},
					{
						atMs: 0,
						source: lava ? null : bosses[0].name,
						spell: lava ? 'Lava' : 'Fireball',
						amount: -520,
						overkill: 180,
						hp: 0,
						maxHp: 900
					}
				]
			});
		}
	});
	deaths.sort((a, b) => a.atMs - b.atMs);
	const spells: Record<string, [number, string][]> = {
		tank: [
			[0, 'Melee'],
			[11581, 'Thunder Clap'],
			[11601, 'Revenge'],
			[7373, 'Hamstring']
		],
		heal: [
			[0, 'Melee'],
			[403, 'Lightning Bolt']
		],
		dps: [
			[10151, 'Fireball'],
			[10197, 'Fire Blast'],
			[10216, 'Flamestrike'],
			[0, 'Melee'],
			[3044, 'Arcane Shot']
		]
	};
	const players = p.map((h, i) => {
		const damage = sum(tl[i].damage);
		const healing = sum(tl[i].healing);
		const parts = spells[role[i]].map(([id, name], k) => ({
			id,
			name,
			w: [0.45, 0.25, 0.18, 0.12, 0.08][k] ?? 0.05
		}));
		const W = parts.reduce((a, b) => a + b.w, 0);
		return {
			guid: `Player-1-SEED${i}`,
			name: `${h.name} ${h.surname}`,
			slug: h.slug,
			recorder: i === 2,
			level: 40 + i,
			damage,
			healing,
			overheal: role[i] === 'heal' ? Math.round(healing * 0.42) : 0,
			shielding: role[i] === 'heal' ? 1340 : 0,
			damageTaken: sum(tl[i].taken),
			environmentalTaken: i === 2 ? 1450 : i === 4 ? 230 : 0,
			deaths: deathsBy[i],
			interrupts: role[i] === 'tank' ? 7 : i === 3 ? 4 : 0,
			dispels: role[i] === 'heal' ? 5 : 0,
			activeMs: Math.round(durationMs * (0.45 + rnd() * 0.45)),
			dps: Math.round((damage / (durationMs / 1000)) * 10) / 10,
			hps: Math.round((healing / (durationMs / 1000)) * 10) / 10,
			critPct: Math.round(rnd() * 250) / 10,
			topDamage: parts.map((s) => ({
				id: s.id,
				name: s.name,
				amount: Math.round((damage * s.w) / W),
				hits: Math.round(40 * s.w * 10),
				crits: Math.round(9 * s.w * 10),
				pet: false
			})),
			topHealing:
				role[i] === 'heal'
					? [
							{
								id: 10396,
								name: 'Healing Wave',
								amount: Math.round(healing * 0.6),
								hits: 61,
								crits: 7,
								pet: false
							},
							{
								id: 10468,
								name: 'Lesser Healing Wave',
								amount: Math.round(healing * 0.3),
								hits: 44,
								crits: 5,
								pet: false
							},
							{
								id: 10623,
								name: 'Chain Heal',
								amount: Math.round(healing * 0.1),
								hits: 12,
								crits: 1,
								pet: false
							}
						]
					: []
		};
	});
	const killed = new Set(segments.filter((s) => s.result === 'kill').map((s) => s.encounterId))
		.size;
	return {
		schema: 1,
		runKey: key(),
		zone: { instanceId: zone.id, name: zone.name, difficultyId: 1, instanceUid: 7000 + zone.id },
		startedAt,
		endedAt: startedAt + durationMs,
		durationMs,
		endReason: 'leftInstance',
		result: {
			bossesKilled: killed,
			bossesTotal: zone.bosses,
			wipes: segments.filter((s) => s.result === 'wipe').length,
			cleared: killed >= zone.bosses
		},
		recorder: p[2].slug,
		players,
		segments,
		deaths,
		timeline: { bucketMs: bucket, players: tl }
	};
}

const runs = [
	makeRun(
		{ id: 389, name: 'Ragefire Chasm', bosses: 4 },
		[
			{ id: 2732, name: 'Oggleflint', dur: 48 },
			{ id: 2733, name: 'Taragaman the Hungerer', dur: 75, wipeFirst: true },
			{ id: 2734, name: 'Jergosh the Invoker', dur: 52 },
			{ id: 2735, name: 'Bazzalan', dur: 41 }
		],
		34,
		3
	),
	makeRun(
		{ id: 36, name: 'Deadmines', bosses: 8 },
		[
			{ id: 2741, name: "Rhahk'Zor", dur: 35 },
			{ id: 2742, name: 'Sneed', dur: 60 },
			{ id: 2743, name: 'Gilnid', dur: 44 },
			{ id: 2745, name: 'Mr. Smite', dur: 70, wipeFirst: true },
			{ id: 2744, name: 'Captain Greenskin', dur: 50 }
		],
		71,
		27
	),
	makeRun(
		{ id: 43, name: 'Wailing Caverns', bosses: 8 },
		[{ id: 585, name: 'Lady Anacondra', dur: 55 }],
		12,
		50
	)
];

for (const r of runs) {
	const res = await post('/companion/runs', r, token);
	console.log(res.status, r.zone.name, res.body.url ?? res.body.error);
}
console.log('\nremove with: bun scripts/companion-seed.ts --clean');
