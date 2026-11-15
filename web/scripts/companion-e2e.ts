// bun scripts/companion-e2e.ts — E2E za Companion HTTP API na DEV deploymentu.
// Poveže dve napravi (odobritev prek interne mutacije), objavi sintetični run iz `wowrun`,
// preveri napake (401/400), idempotenco, združevanje dveh snemalcev in preklic naprave,
// na koncu pobriše vse, kar je ustvaril. Nikoli ne teče proti produkciji.
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

let failures = 0;
const check = (ok: boolean, what: string, extra?: unknown) => {
	console.log(
		`${ok ? '✔' : '✘'} ${what}${!ok && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`
	);
	if (!ok) failures++;
};

async function post(path: string, body: unknown, token?: string) {
	const res = await fetch(`${SITE}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	const text = await res.text();
	let data: any = text;
	try {
		data = JSON.parse(text);
	} catch {}
	return { status: res.status, data };
}

const convexRun = async (fn: string, args: object) =>
	(await $`bunx convex run ${fn} ${JSON.stringify(args)}`.quiet()).text().trim();

// Uporabnik z vlogo (admin/member) iz dev baze.
const roles = (await $`bunx convex data roles --format jsonLines`.quiet())
	.text()
	.trim()
	.split('\n')
	.map((l) => JSON.parse(l));
const userId: string = roles.find((r) => r.role === 'admin' || r.role === 'member')?.userId;
if (!userId) throw new Error('no member/admin in dev roles');

async function linkDevice(name: string): Promise<{ token: string; deviceId: string }> {
	const start = await post('/companion/link/start', { deviceName: name, appVersion: '0.0.0-e2e' });
	check(
		start.status === 200 && /^[A-Z]+-\d{4}$/.test(start.data.code),
		`link/start ${name}`,
		start
	);
	check(String(start.data.linkUrl).includes('/link?code='), 'linkUrl points to portal /link');
	const pending = await post('/companion/link/poll', { pollToken: start.data.pollToken });
	check(pending.data.status === 'pending', 'poll before approval = pending', pending.data);
	await convexRun('companion:approveLinkAs', { code: start.data.code, userId });
	const ok = await post('/companion/link/poll', { pollToken: start.data.pollToken });
	check(
		ok.data.status === 'approved' && String(ok.data.token).startsWith('wcc_'),
		'poll after approval returns token once',
		ok.data
	);
	const again = await post('/companion/link/poll', { pollToken: start.data.pollToken });
	check(
		again.data.status === 'claimed' && !again.data.token,
		'second poll does not leak the token',
		again.data
	);
	return { token: ok.data.token, deviceId: ok.data.deviceId };
}

// Sintetični run (fixture iz crates/wowlog) -> premaknjen v sedanjost, unikaten runKey.
const runs = JSON.parse(
	(
		await $`cargo run -q --bin wowrun -- crates/wowlog/tests/fixtures/synthetic_rfc.txt --compact`.quiet()
	).text()
);
const base = runs[0];
const now = Date.now();
const runKey = [...crypto.getRandomValues(new Uint8Array(8))]
	.map((b) => b.toString(16).padStart(2, '0'))
	.join('');
const summary = {
	...base,
	runKey,
	startedAt: now - 3_600_000,
	endedAt: now - 3_600_000 + base.durationMs
};

const created: { runId?: string; recordSlug?: string; devices: string[] } = { devices: [] };
try {
	const a = await linkDevice('E2E Box A');
	created.devices.push(a.deviceId);

	check((await post('/companion/runs', summary)).status === 401, 'upload without token → 401');
	check(
		(await post('/companion/runs', summary, 'wcc_' + 'x'.repeat(43))).status === 401,
		'upload with unknown token → 401'
	);
	check((await post('/companion/runs', '{nope', a.token)).status === 400, 'invalid JSON → 400');
	check(
		(await post('/companion/runs', { ...summary, schema: 99 }, a.token)).status === 400,
		'unknown schema → 400'
	);
	const extra = await post('/companion/runs', { ...summary, hacked: true }, a.token);
	check(extra.status === 400, 'unknown field → 400 (validator)', extra);
	const bad = await post('/companion/runs', { ...summary, runKey: 'zz' }, a.token);
	check(
		bad.status === 400 && bad.data.error === 'bad runKey',
		'content check → 400 with reason',
		bad
	);

	const up1 = await post('/companion/runs', summary, a.token);
	check(up1.status === 201 && up1.data.created === true, 'first upload creates the run (201)', up1);
	created.runId = up1.data.runId;
	check(String(up1.data.url).includes(`/runs/${up1.data.runId}`), 'response has portal url');

	const up2 = await post('/companion/runs', summary, a.token);
	check(
		up2.status === 200 &&
			up2.data.runId === up1.data.runId &&
			!up2.data.recorderAdded &&
			!up2.data.replaced,
		're-upload is idempotent',
		up2.data
	);

	const b = await linkDevice('E2E Box B');
	created.devices.push(b.deviceId);
	const longer = {
		...summary,
		durationMs: summary.durationMs + 60_000,
		endedAt: summary.endedAt + 60_000,
		recorder: 'fizzle-boom'
	};
	const up3 = await post('/companion/runs', longer, b.token);
	// če prvo nalaganje pade, drugi posnetek ustvari run – tudi tega je treba pospraviti
	created.runId ??= up3.data.runId;
	check(
		up3.data.runId === up1.data.runId && up3.data.recorderAdded && up3.data.replaced,
		'second recorder merges + more complete run replaces',
		up3.data
	);

	const shorter = await post('/companion/runs', { ...summary, recorder: 'mendy-bandage' }, a.token);
	check(
		!shorter.data.replaced && !shorter.data.recorderAdded,
		'worse duplicate does not replace',
		shorter.data
	);

	const doc = (await $`bunx convex data runs --limit 5 --format jsonLines`.quiet())
		.text()
		.trim()
		.split('\n')
		.map((l) => JSON.parse(l))
		.find((r) => r._id === up1.data.runId);
	check(doc?.recordedBy?.length === 2, 'run has 2 recorders', doc?.recordedBy);
	check(doc?.durationMs === longer.durationMs, 'kept the longer recording');
	check(
		Array.isArray(doc?.awards) && doc.awards.length > 0,
		`awards computed (${doc?.awards?.map((x: any) => x.title).join(', ')})`
	);
	check(doc?.party?.length === 3, 'party stored', doc?.party);

	// ---- osebni rekordi iz celega loga (open world): POST /companion/records
	const players = (await $`bunx convex data players --limit 100 --format jsonLines`.quiet())
		.text()
		.trim()
		.split('\n')
		.map((l) => JSON.parse(l));
	const hero = players.find((p) => !p.ownerUserId || p.ownerUserId === userId);
	const rec = (o: object = {}) => ({
		kind: 'heal',
		amount: 7,
		spell: 'E2E Bandage',
		spellId: 746,
		unit: 'themselves',
		at: now - 60_000,
		zone: 'Durotar',
		inDungeon: false,
		...o
	});
	const personal = (slug: string, records: object[]) => ({
		schema: 1,
		characters: [{ slug, name: 'E2E Hero', records }]
	});
	check(
		(await post('/companion/records', personal('nobody-here', [rec()]))).status === 401,
		'records without token → 401'
	);
	const unknown = await post('/companion/records', personal('nobody-here', [rec()]), a.token);
	check(
		unknown.status === 200 && unknown.data.updated === 0 && unknown.data.ignored?.[0] === 'nobody-here',
		'records for an untracked hero are ignored',
		unknown
	);
	check(
		(await post('/companion/records', personal('nobody-here', [rec({ amount: 0 })]), a.token))
			.status === 400,
		'nonsense record → 400'
	);
	check(
		(await post('/companion/records', { schema: 9, characters: [] }, a.token)).status === 400,
		'unknown records schema → 400'
	);
	if (hero) {
		created.recordSlug = hero.slug;
		const first = await post('/companion/records', personal(hero.slug, [rec()]), a.token);
		check(first.status === 200 && first.data.updated === 1, 'open-world record stored', first);
		const same = await post('/companion/records', personal(hero.slug, [rec()]), a.token);
		check(same.data.updated === 0, 'same number again changes nothing', same.data);
		const bigger = await post(
			'/companion/records',
			personal(hero.slug, [rec({ amount: 9 })]),
			a.token
		);
		check(bigger.data.updated === 1, 'a bigger number replaces it', bigger.data);
		const rows = (await $`bunx convex data heroRecords --limit 300 --format jsonLines`.quiet())
			.text()
			.trim()
			.split('\n')
			.map((l) => JSON.parse(l))
			.filter((r) => r.slug === hero.slug && r.kind === 'heal');
		check(
			rows.length === 1 && rows[0].amount === 9 && rows[0].world === true && !rows[0].runId,
			'one row per hero and kind, marked open world',
			rows
		);
	} else {
		console.log('  (no tracked hero on dev → skipping the stored-record checks)');
	}

	await convexRun('companion:deleteDevice', { deviceId: a.deviceId });
	check((await post('/companion/runs', summary, a.token)).status === 401, 'deleted device → 401');
} finally {
	if (created.runId) await convexRun('companion:deleteRun', { runId: created.runId });
	if (created.recordSlug)
		await convexRun('companion:deleteWorldRecords', { slug: created.recordSlug });
	for (const d of created.devices) await convexRun('companion:deleteDevice', { deviceId: d });
	console.log('cleanup done');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
