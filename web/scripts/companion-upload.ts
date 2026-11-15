// bun scripts/companion-upload.ts <run.json> — SAMO DEV: naloži run(e) iz `wowrun … > run.json` prek pravega
// HTTP API-ja (naprava "Seed Box", kot companion-seed.ts). runKey dobi predpono "5eed", zato jih
// `bun scripts/companion-seed.ts --clean` pobriše. Za preizkus nove analize na pravem logu.
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

const file = process.argv[2];
if (!file) throw new Error('usage: bun scripts/companion-upload.ts <run.json>');
const runs = JSON.parse(await Bun.file(file).text()) as {
	runKey: string;
	startedAt: number;
	endedAt: number;
}[];

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
const roles = (await $`bunx convex data roles --format jsonLines --limit 50`.quiet())
	.text()
	.trim()
	.split('\n')
	.map((l) => JSON.parse(l));
const userId = roles.find((r) => r.role === 'admin' || r.role === 'member')?.userId;
const start = await post('/companion/link/start', { deviceName: 'Seed Box', appVersion: 'upload' });
await $`bunx convex run companion:approveLinkAs ${JSON.stringify({ code: start.body.code, userId })}`.quiet();
const { token } = (await post('/companion/link/poll', { pollToken: start.body.pollToken })).body;

for (const r of runs) {
	r.runKey = '5eed' + r.runKey.slice(4);
	// the server only takes runs of the last 30 days: move old samples to "yesterday"
	const shift = Math.max(0, Date.now() - 86_400_000 - r.startedAt);
	r.startedAt += shift;
	r.endedAt += shift;
	const res = await post('/companion/runs', r, token);
	console.log(res.status, JSON.stringify(res.body));
}
