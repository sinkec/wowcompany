// Prenese izbrane spremenljivke iz .env v Convex deployment (vrednosti se ne izpišejo).
// Uporaba: bun run env:push            -> dev deployment
//          bun run env:push -- --prod  -> production deployment
const CONVEX_KEYS = [
	'BLIZZARD_CLIENT_ID',
	'BLIZZARD_CLIENT_SECRET',
	'BLIZZARD_REGION',
	'BLIZZARD_LOCALE',
	'BLIZZARD_PROFILE_NAMESPACE',
	'BLIZZARD_STATIC_NAMESPACE',
	'BLIZZARD_GUILD_SLUG',
	'SITE_URL',
	'BETTER_AUTH_SECRET',
	'GOOGLE_CLIENT_ID',
	'GOOGLE_CLIENT_SECRET',
	'DISCORD_WEBHOOK_URL',
	'DISCORD_APPLICATION_ID',
	'DISCORD_GUILD_ID'
];

const prod = process.argv.includes('--prod');
const text = await Bun.file('.env').text();
const env = new Map<string, string>();
for (const line of text.split('\n')) {
	const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
	if (!m) continue;
	const value = m[2].replace(/\s+#.*$/, '').trim().replace(/^"(.*)"$/, '$1');
	env.set(m[1], value);
}

// Za produkcijo imajo prednost vrednosti s pripono _PROD (npr. SITE_URL_PROD, BETTER_AUTH_SECRET_PROD).
for (const key of CONVEX_KEYS) {
	const value = (prod && env.get(`${key}_PROD`)) || env.get(key);
	if (!value) {
		console.log(`  ·  ${key} (prazno, preskočeno)`);
		continue;
	}
	const args = ['bunx', 'convex', 'env', 'set', ...(prod ? ['--prod'] : []), key, value];
	const p = Bun.spawnSync(args, { stdout: 'ignore', stderr: 'pipe' });
	console.log(p.exitCode === 0 ? `  ✓  ${key}` : `  ✗  ${key}: ${p.stderr.toString().trim()}`);
}
