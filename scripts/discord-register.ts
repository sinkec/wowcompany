// Registrira slash ukaze (/roster, /hero, /leaderboard) na Discord strežniku iz .env.
//   bun run discord:register
import { COMMANDS } from '../src/convex/lib/discordBot.ts';

const env = Object.fromEntries(
	(await Bun.file('.env').text())
		.split('\n')
		.map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
		.filter((m): m is RegExpMatchArray => !!m)
		.map((m) => [m[1], m[2].replace(/\s+#.*$/, '').trim().replace(/^"(.*)"$/, '$1')])
);
const { DISCORD_APPLICATION_ID: app, DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guild } = env;
if (!app || !token) throw new Error('DISCORD_APPLICATION_ID in DISCORD_BOT_TOKEN morata biti v .env');

const url = guild
	? `https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`
	: `https://discord.com/api/v10/applications/${app}/commands`;
const res = await fetch(url, {
	method: 'PUT',
	headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
	body: JSON.stringify(COMMANDS)
});
const body = await res.json();
if (!res.ok) {
	console.error(`✗ Discord ${res.status}:`, JSON.stringify(body));
	process.exit(1);
}
console.log(`✓ registrirano (${guild ? 'strežnik, takoj' : 'globalno, do 1 h'}):`, (body as { name: string }[]).map((c) => `/${c.name}`).join(', '));
