// Test vidnosti javno/zasebno na dev deploymentu.
//   bun run check:visibility
// Za več kombinacij javnih polj kliče javne poizvedbe kot obiskovalec (brez prijave) in preveri,
// da ne pride ven nič skritega ter da je vse dovoljeno res prikazano. Na koncu vrne prvotne nastavitve.

const IDENTITY = new Set(['_id', 'playerId', 'slug', 'name', 'surname', 'updatedAt']);
const SUMMARY_FIELDS = [
	'level', 'classId', 'className', 'race', 'faction', 'guild', 'avatar', 'ilvlEquipped', 'experience', 'gender',
	'ruleset', 'ilvlAverage', 'achievementPoints', 'lastLogin', 'kills', 'deaths', 'quests', 'honorableKills', 'counters', 'talents'
];
const SECTIONS = ['equipment', 'stats', 'professions', 'counters', 'allStats', 'history', 'talents'];
/** ključ povzetka -> polje vidnosti */
const fieldOf = (k: string) => (k === 'talentBuild' || k === 'talentSpec' ? 'talents' : k);
const ALL = [...new Set([...SUMMARY_FIELDS, ...SECTIONS])];
const WEEK_FIELD: Record<string, string> = { level: 'level', ilvl: 'ilvlEquipped', kills: 'kills', deaths: 'deaths', quests: 'quests', honorableKills: 'honorableKills' };
const HIST_FIELD = WEEK_FIELD;
const EVENT_FIELD: Record<string, string> = { level: 'level', avatar: 'avatar', ilvl: 'ilvlEquipped', kills: 'kills', deaths: 'deaths', quests: 'quests', honorableKills: 'honorableKills' };

function convex(fn: string, args: object = {}): any {
	const p = Bun.spawnSync(['bunx', 'convex', 'run', fn, JSON.stringify(args)], { stdout: 'pipe', stderr: 'pipe' });
	const out = p.stdout.toString().split('\n').filter((l) => !l.startsWith('✔') && !l.startsWith('-')).join('\n').trim();
	if (p.exitCode !== 0) throw new Error(`${fn}: ${p.stderr.toString().trim()}`);
	return out ? JSON.parse(out) : null;
}

let failures = 0;
let checks = 0;
const fail = (scenario: string, msg: string) => {
	failures++;
	console.log(`   ✗ [${scenario}] ${msg}`);
};

function scenario(name: string, pub: string[]) {
	const P = new Set(pub);
	const ok = (f: string) => P.has(f);
	convex('admin:setPublicFields', { fields: pub });

	const list = convex('players:list');
	if (list.private) fail(name, 'list.private je true za obiskovalca');
	for (const pl of list.players) {
		for (const [k, v] of Object.entries(pl.summary ?? {})) {
			checks++;
			if (!IDENTITY.has(k) && !ok(fieldOf(k))) fail(name, `list ${pl.slug}: uide summary.${k}=${JSON.stringify(v).slice(0, 40)}`);
		}
		for (const f of SUMMARY_FIELDS) {
			checks++;
			if (ok(f) && pl.summary && !(f in pl.summary) && f !== 'guild' && f !== 'ruleset' && f !== 'avatar' && f !== 'lastLogin' && f !== 'counters' && f !== 'talents')
				fail(name, `list ${pl.slug}: manjka dovoljeno summary.${f}`);
		}
		for (const k of Object.keys(pl.week ?? {})) {
			checks++;
			if (!ok(WEEK_FIELD[k])) fail(name, `list ${pl.slug}: uide week.${k}`);
		}

		const g = convex('players:get', { slug: pl.slug });
		for (const k of Object.keys(g.summary ?? {})) {
			checks++;
			if (!IDENTITY.has(k) && !ok(fieldOf(k))) fail(name, `get ${pl.slug}: uide summary.${k}`);
		}
		const d = g.details ?? {};
		for (const sec of ['equipment', 'stats', 'professions', 'counters', 'allStats', 'talents']) {
			checks++;
			if (!ok(sec) && d[sec] != null) fail(name, `get ${pl.slug}: uide details.${sec}`);
			if (ok(sec) && g.details && d[sec] == null) fail(name, `get ${pl.slug}: manjka dovoljeno details.${sec}`);
		}
		checks++;
		if (!ok('avatar') && d.render != null) fail(name, `get ${pl.slug}: uide details.render`);
		checks++;
		if (!ok('history') && g.history != null) fail(name, `get ${pl.slug}: uide history`);
		if (ok('history') && g.history == null) fail(name, `get ${pl.slug}: manjka dovoljena history`);
		for (const row of g.history ?? []) {
			for (const [col, field] of Object.entries(HIST_FIELD)) {
				checks++;
				if (!ok(field) && row[col] != null) fail(name, `get ${pl.slug}: uide history.${col}`);
				if (ok(field) && row[col] == null) fail(name, `get ${pl.slug}: manjka history.${col}`);
			}
		}
	}

	const events = convex('events:recent', { limit: 50 });
	checks++;
	if (!ok('lastLogin') && events.length) fail(name, `feed: ${events.length} dogodkov, čeprav je lastLogin skrit`);
	for (const e of events) {
		for (const [k, field] of Object.entries(EVENT_FIELD)) {
			checks++;
			if (!ok(field) && e[k] != null) fail(name, `feed ${e.slug}: uide ${k}`);
		}
		checks++;
		if (!ok('classId') && e.classId) fail(name, `feed ${e.slug}: uide classId`);
		if (!ok('equipment') && e.newItems?.length) fail(name, `feed ${e.slug}: uide newItems`);
		if (!ok('talents') && e.talentBuild) fail(name, `feed ${e.slug}: uide talentBuild`);
	}
	return events.length;
}

// ---------------------------------------------------------------------------------------------
const original: string[] = convex('players:list').publicFields;
console.log(`Prvotna javna polja: ${original.join(', ')}\n`);

const scenarios: [string, string[]][] = [
	['nič javnega (samo identiteta)', []],
	['privzeto', ['name', 'surname', 'slug', 'level', 'classId', 'className', 'race', 'faction', 'guild', 'avatar', 'ilvlEquipped']],
	['history javna, številke zasebne', ['level', 'history']],
	['feed javen, portret/level/razred skriti', ['lastLogin', 'kills']],
	['samo oprema in poklici', ['equipment', 'professions']],
	['samo talenti', ['talents']],
	['vse javno', ALL]
];

try {
	for (const [name, pub] of scenarios) {
		const before = failures;
		const ev = scenario(name, pub);
		console.log(`${failures === before ? '✓' : '✗'} ${name}  (feed dogodkov: ${ev})`);
	}
	// prijavljen admin/član mora videti vse ne glede na nastavitve -> preverimo vsaj, da obiskovalec NI privilegiran
	const list = convex('players:list');
	checks++;
	if (list.private) fail('obiskovalec', 'brez prijave dobi private=true');
	for (const fn of ['admin:overview', 'claims:listForAdmin']) {
		checks++;
		try {
			convex(fn);
			fail('obiskovalec', `${fn} je dostopen brez prijave`);
		} catch {
			/* pričakovano: Guild Master only */
		}
	}
	checks++;
	if (convex('claims:mine') !== null) fail('obiskovalec', 'claims:mine vrne podatke brez prijave');
	checks++;
	if ((convex('roster:members') ?? []).length) fail('obiskovalec', 'roster:members vrne podatke brez prijave');
} finally {
	convex('admin:setPublicFields', { fields: original });
	console.log(`\nNastavitve vrnjene na prvotne.`);
}

console.log(failures ? `\n✗ ${failures} napak od ${checks} preverjanj` : `\n✓ vseh ${checks} preverjanj uspešnih`);
process.exit(failures ? 1 : 0);
