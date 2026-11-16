// bun scripts/replay-backfill.ts [--prod] <WoWCombatLog-*.txt …>
// Replay za rune, naložene s Companionom pred 0.1.12: lokalni log → wowrun (nova analiza s pozicijami)
// → companion:attachReplay (najde run po ključu ali po času/dungeonu/partyju, obstoječega ne prepiše).
import { $ } from 'bun';

const args = process.argv.slice(2);
const prod = args.includes('--prod');
const logs = args.filter((a) => a !== '--prod');
if (!logs.length) throw new Error('usage: bun scripts/replay-backfill.ts [--prod] <WoWCombatLog-*.txt …>');

const root = new URL('../..', import.meta.url).pathname;
await $`cargo build -q --release -p wowrun`.cwd(root);
const wowrun = `${root}target/release/wowrun`;

type Run = {
	runKey: string;
	zone: { instanceId: number; name: string };
	startedAt: number;
	players: { slug: string }[];
	replay?: unknown;
};
for (const log of logs) {
	const runs = JSON.parse(await $`${wowrun} ${log} --compact`.quiet().text()) as Run[];
	for (const r of runs) {
		if (!r.replay) {
			console.log(`${r.zone.name}: no positions in this log`);
			continue;
		}
		const payload = JSON.stringify({
			runKey: r.runKey,
			instanceId: r.zone.instanceId,
			startedAt: r.startedAt,
			slugs: r.players.map((p) => p.slug),
			replay: r.replay
		});
		const out = await $`bunx convex run ${prod ? ['--prod'] : []} companion:attachReplay ${payload}`
			.quiet()
			.nothrow()
			.text();
		console.log(`${r.zone.name} (${new Date(r.startedAt).toISOString().slice(0, 16)}): ${out.trim()}`);
	}
}
