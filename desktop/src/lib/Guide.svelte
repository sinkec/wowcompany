<script lang="ts">
	// "How to log": vklop, preverjanje (sproti iz stanja aplikacije), izklop in pospravljanje.
	import { ago, api, type Status } from './api';

	let { status, ongo }: { status: Status; ongo: (tab: 'settings') => void } = $props();

	// status pride vsako sekundo → čas se osveži skupaj z njim
	const now = $derived(status ? Date.now() : 0);
	const combatLive = $derived(!!status.watch.lastLineAt && now - status.watch.lastLineAt < 90_000);
	const chatLive = $derived(
		!!status.watch.chatLastLineAt && now - status.watch.chatLastLineAt < 10 * 60_000
	);

	type Check = { ok: boolean | null; title: string; detail: string };
	const checks = $derived<Check[]>([
		{
			ok: !!status.watch.logsDir && !status.watch.error,
			title: 'Logs folder found',
			detail: status.watch.logsDir ?? 'Not found yet – pick it in Settings.'
		},
		{
			ok: combatLive ? true : status.watch.file ? null : false,
			title: combatLive ? 'Combat log is recording' : 'Combat log is not recording right now',
			detail: status.watch.file
				? `${status.watch.file} · last line ${ago(status.watch.lastLineAt)}`
				: 'No WoWCombatLog file yet. Type /combatlog in game.'
		},
		{
			ok: status.watch.advanced,
			title:
				status.watch.advanced === true
					? 'Advanced combat logging is ON'
					: status.watch.advanced === false
						? 'Advanced combat logging is OFF'
						: 'Advanced logging: unknown (no log header seen yet)',
			detail:
				status.watch.advanced === false
					? 'Run /console advancedCombatLogging 1 once, then /combatlog off and on again.'
					: 'Gives HP, item level and positions – better death recaps.'
		},
		{
			ok: chatLive ? true : status.watch.chatFile ? null : false,
			title: status.watch.chatFile
				? 'Chat log found (for loot)'
				: 'Chat log is off – no loot tracking',
			detail: status.watch.chatFile
				? `${status.watch.chatFile} · ${status.watch.lootLines} loot line${status.watch.lootLines === 1 ? '' : 's'} read · last line ${ago(status.watch.chatLastLineAt)}`
				: 'Type /chatlog in game if you want “who looted what” on the portal.'
		},
		{
			ok: status.addon.installed ? (status.addon.dataAt ? true : null) : null,
			title: status.addon.installed
				? `WowCompany addon installed${status.addon.version ? ` (v${status.addon.version})` : ''}`
				: 'WowCompany addon not installed (optional)',
			detail: !status.addon.installed
				? 'The addon turns logging on by itself, shows a meter in game and tells us who led the party.'
				: status.addon.dataAt
					? `Last data from the addon ${ago(status.addon.dataAt)} · ${status.addon.runs} run${status.addon.runs === 1 ? '' : 's'} · ${status.addon.leadersAdded} leader${status.addon.leadersAdded === 1 ? '' : 's'} added. It arrives when you log out or quit (or /reload if you can't wait).`
					: 'No data from it yet – it arrives when you log out or quit the game.'
		}
	]);
	// namestitev / posodobitev addona, ki je priložen aplikaciji
	const addonOutdated = $derived(
		!!status.addon.installedVersion && status.addon.installedVersion !== status.addon.bundledVersion
	);
	let installing = $state(false);
	let installNote = $state<string | null>(null);
	async function installAddon() {
		installing = true;
		installNote = null;
		try {
			const v = await api.installAddon();
			installNote = `Addon v${v} is in the game's AddOns folder. Restart the game (a new addon needs a full restart; an update needs /reload).`;
		} catch (e) {
			installNote = `Could not install: ${e}`;
		} finally {
			installing = false;
		}
	}
	const icon = (ok: boolean | null) => (ok === true ? '✅' : ok === false ? '❌' : '⚠️');
</script>

<div class="max-w-3xl space-y-6">
	<section class="wow-frame space-y-3 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">Right now</h2>
		<ul class="space-y-2">
			{#each checks as c (c.title)}
				<li class="flex gap-3 text-sm">
					<span class="w-5 shrink-0 text-center">{icon(c.ok)}</span>
					<span class="min-w-0">
						<span class="font-semibold">{c.title}</span>
						<span class="block truncate text-xs text-muted-foreground select-text" title={c.detail}
							>{c.detail}</span
						>
					</span>
				</li>
			{/each}
		</ul>
		<div class="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3 text-sm">
			{#if !status.addon.installed || addonOutdated}
				<button class="btn btn-primary" disabled={installing || !status.watch.logsDir} onclick={installAddon}>
					{installing
						? 'Copying…'
						: status.addon.installed
							? `Update addon to v${status.addon.bundledVersion}`
							: `Install the WowCompany addon (v${status.addon.bundledVersion})`}
				</button>
				<span class="text-xs text-muted-foreground">
					{status.addon.installed
						? `Installed: v${status.addon.installedVersion}.`
						: 'In-game meter, automatic logging, party leader and item quality for the portal.'}
				</span>
			{:else}
				<span class="text-xs text-muted-foreground">
					WowCompany addon v{status.addon.installedVersion} is up to date. In game: <code class="text-primary">/wowco</code>
				</span>
			{/if}
			{#if installNote}<span class="basis-full text-xs text-primary">{installNote}</span>{/if}
		</div>
	</section>

	<section class="wow-frame space-y-3 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">Once, ever</h2>
		<p class="text-sm">
			In WoW chat type <code class="text-primary select-text">/console advancedCombatLogging 1</code
			>
			and press Enter. The game remembers it (saved in <code>Config.wtf</code>), so this is a
			one-time ritual. It adds HP and item level to the log — the death recaps on the portal get
			much juicier.
		</p>
	</section>

	<section class="wow-frame space-y-3 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">Every session, before the dungeon</h2>
		<ol class="list-decimal space-y-2 pl-5 text-sm">
			<li>
				<code class="text-primary select-text">/combatlog</code> — chat confirms
				<i>“Combat being logged to Logs\WoWCombatLog…”</i>. The game forgets this on every login,
				like your healer forgets to drink.
			</li>
			<li>
				<code class="text-primary select-text">/chatlog</code> — only if you want <b>loot</b> on the
				portal (“who looted what”). Chat confirms
				<i>“Chat being logged…”</i>. Heads up: the chat log contains <i>all</i> your chat; the app reads
				only the loot lines and nothing else ever leaves your PC.
			</li>
			<li>Turn them on <b>before</b> entering the dungeon, so the app sees you walk in.</li>
			<li>Keep this app running (it lives in the tray when you close the window).</li>
		</ol>
	</section>

	<section class="wow-frame space-y-3 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">Records everywhere (optional)</h2>
		<p class="text-sm">
			Your biggest crit, hit, heal and hardest hit taken are tracked from the <b>whole</b> combat log,
			not just dungeons — see the <b>Records</b> tab. For open-world records keep
			<code class="text-primary select-text">/combatlog</code> on outside dungeons too. With the
			WowCompany addon: <code class="text-primary select-text">/wowco log everywhere</code>. The log
			grows ~5–10 MB per hour of fighting; it is deleted when you quit this app.
		</p>
	</section>

	<section class="wow-frame space-y-3 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">After the dungeon: stop logging</h2>
		<ol class="list-decimal space-y-2 pl-5 text-sm">
			<li>
				Leave the instance. The run is finished and uploaded once you've been out for 15 minutes
				(corpse runs don't count) — or press <b>End run</b> on the Live tab if you can't wait.
			</li>
			<li>
				Type <code class="text-primary select-text">/combatlog</code> again →
				<i>“Combat logging disabled”</i>, and
				<code class="text-primary select-text">/chatlog</code> again →
				<i>“Chat logging disabled”</i>. Same command toggles it off. The log grows ~5–10 MB per hour
				of fighting, so don't leave it running all week.
			</li>
		</ol>
	</section>

	<section class="wow-frame space-y-3 rounded-lg p-5">
		<h2 class="text-lg font-bold text-primary">Tidying up</h2>
		<p class="text-sm">
			{#if status.settings.deleteLogsOnExit}
				When you <b>Quit</b> the app (tray → Quit), it deletes the combat and chat logs. If the game is
				already closed, all of them go (an unfinished run is saved first). If the game is still running,
				it keeps the file WoW wrote to in the last 2 minutes — deleting a file the game is still writing
				would lose the data. Your personal records stay.
			{:else}
				Automatic deletion is <b>off</b>. Old logs pile up in the Logs folder until you delete them.
			{/if}
			Change it, or delete now, in
			<button class="text-primary underline" onclick={() => ongo('settings')}>Settings</button>.
		</p>
	</section>
</div>
