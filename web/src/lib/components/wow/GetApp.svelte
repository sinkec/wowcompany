<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	// Prenos WowCompany Companion: zadnja izdaja "companion-v*" z GitHub Releases (javni API, brez žetona).
	import { onMount } from 'svelte';
	import Download from '@lucide/svelte/icons/download';
	import Loader from '@lucide/svelte/icons/loader-2';
	import { GITHUB_REPO } from '#lib/site.js';

	type Asset = { name: string; browser_download_url: string; size: number };
	type Release = {
		tag_name: string;
		name: string;
		draft: boolean;
		published_at: string;
		html_url: string;
		assets: Asset[];
	};

	let release = $state<Release | null>(null);
	let status = $state<'loading' | 'ready' | 'none' | 'error'>('loading');
	let os = $state<'windows' | 'linux' | 'other'>('other');

	onMount(async () => {
		const ua = navigator.userAgent.toLowerCase();
		os = ua.includes('windows')
			? 'windows'
			: ua.includes('linux') && !ua.includes('android')
				? 'linux'
				: 'other';
		try {
			const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`, {
				headers: { Accept: 'application/vnd.github+json' }
			});
			if (!r.ok) throw new Error(String(r.status));
			const list = (await r.json()) as Release[];
			release =
				list.find((x) => !x.draft && x.tag_name.startsWith('companion-v') && x.assets.length) ??
				null;
			status = release ? 'ready' : 'none';
		} catch {
			status = 'error';
		}
	});

	const find = (re: RegExp) => release?.assets.find((a) => re.test(a.name)) ?? null;
	const win = $derived(find(/windows.*setup\.exe$/i) ?? find(/\.exe$/i));
	const appimage = $derived(find(/\.AppImage$/));
	const deb = $derived(find(/\.deb$/));
	const version = $derived(release?.tag_name.replace('companion-v', '') ?? '');
	const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;
	const primary = $derived(os === 'linux' ? appimage : win);
	const primaryLabel = $derived(
		os === 'linux' ? 'Download for Linux (AppImage)' : 'Download for Windows'
	);
</script>

<section id="download" class="wow-frame space-y-4 rounded-lg p-5">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="section-title">Get the app</h2>
			<p class="text-sm text-muted-foreground">
				Windows and Linux (Steam/Proton, Lutris). Free, small, and only snitches on your party —
				never on strangers.
			</p>
		</div>
		{#if status === 'ready'}<span
				class="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground"
				>v{version}</span
			>{/if}
	</div>

	{#if status === 'loading'}
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<Loader class="size-4 animate-spin" /> Asking the goblins in the warehouse…
		</div>
	{:else if status === 'none'}
		<p class="text-sm text-muted-foreground italic">
			No release yet. The blacksmith is still hammering it. Check back soon.
		</p>
	{:else if status === 'error'}
		<p class="text-sm text-muted-foreground">
			Couldn't reach GitHub. Grab it directly from
			<a
				class="text-primary hover:underline"
				href="https://github.com/{GITHUB_REPO}/releases"
				target="_blank"
				rel="noopener noreferrer">GitHub Releases</a
			>.
		</p>
	{:else}
		<div class="flex flex-wrap items-center gap-3">
			{#if primary}
				<Button href={primary.browser_download_url} size="lg" class="h-11 gap-2 px-5 font-semibold">
					<Download class="size-5" />
					{primaryLabel}
					<span class="text-xs font-normal opacity-80">{mb(primary.size)}</span>
				</Button>
			{/if}
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
				{#if win && primary !== win}<a
						class="text-primary hover:underline"
						href={win.browser_download_url}>Windows installer ({mb(win.size)})</a
					>{/if}
				{#if appimage && primary !== appimage}<a
						class="text-primary hover:underline"
						href={appimage.browser_download_url}>Linux AppImage ({mb(appimage.size)})</a
					>{/if}
				{#if deb}<a class="text-primary hover:underline" href={deb.browser_download_url}
						>Linux .deb ({mb(deb.size)})</a
					>{/if}
				<a
					class="text-muted-foreground hover:text-foreground hover:underline"
					href={release?.html_url}
					target="_blank"
					rel="noopener noreferrer">All files</a
				>
			</div>
		</div>

		<div class="space-y-4 text-sm text-muted-foreground">
			<div>
				<h3 class="font-semibold text-foreground">1. Install and sign in (once)</h3>
				<ol class="mt-1 list-decimal space-y-1 pl-5">
					<li>
						<b class="text-foreground">Windows:</b> run the installer. SmartScreen will say “unknown
						publisher” — click <i>More info → Run anyway</i>. We can't afford a code-signing
						certificate; we spent it on repair bills.
					</li>
					<li>
						<b class="text-foreground">Linux:</b> AppImage →
						<code class="text-primary">chmod +x</code> and run; or
						<code class="text-primary">sudo apt install ./WowCompany-Companion_*.deb</code>.
					</li>
					<li>
						Open the app → <b class="text-foreground">Sign in with Google</b> → approve the code on this
						page.
					</li>
				</ol>
			</div>

			<div>
				<h3 class="font-semibold text-foreground">
					2. Add the in-game addon <span class="font-normal text-primary">(recommended)</span>
				</h3>
				<ol class="mt-1 list-decimal space-y-1 pl-5">
					<li>
						In the app open <b class="text-foreground">How to log</b> and press
						<b class="text-foreground">Install the WowCompany addon</b>. It copies itself into the
						game's AddOns folder. No zip files, no folder archaeology.
					</li>
					<li>
						<b class="text-foreground">Restart the game</b> (a new addon needs a full restart).
						<code class="text-primary">/wowco</code> or the coin button on the minimap opens it.
					</li>
					<li>
						That's it. The addon switches the combat and chat logs on by itself when you walk into a
						dungeon, shows a damage meter in game, and tells the portal who led the party and how
						shiny the loot was.
					</li>
					<li>
						After a dungeon the addon asks whether to send the loot now:
						<b class="text-foreground">Send now</b> reloads the interface for a second,
						<b class="text-foreground">Later</b> sends it when you close the game (the app keeps your
						logs until then). The party leader comes from the chat log either way.
					</li>
					<li>
						Want your biggest crit counted <b class="text-foreground">everywhere</b>, not just in
						dungeons? <code class="text-primary">/wowco log everywhere</code>, or the
						<i>Everywhere</i> button on the addon's Logging tab.
					</li>
				</ol>
			</div>

			<div>
				<h3 class="font-semibold text-foreground">No addon? The old-fashioned way</h3>
				<ul class="mt-1 list-disc space-y-1 pl-5">
					<li>
						Once ever: <code class="text-primary">/console advancedCombatLogging 1</code> (better death
						recaps).
					</li>
					<li>
						Every session, before the dungeon: <code class="text-primary">/combatlog</code>, and
						<code class="text-primary">/chatlog</code> if you want the loot on the portal. Type both again
						afterwards to switch them off. The game forgets them on every login, like your healer forgets
						to drink.
					</li>
				</ul>
			</div>

			<div>
				<h3 class="font-semibold text-foreground">What ends up here</h3>
				<ul class="mt-1 list-disc space-y-1 pl-5">
					<li>
						<b class="text-foreground">Dungeon runs:</b> meter, bosses, autopsies of every death, loot,
						awards nobody asked for — uploaded when the run ends.
					</li>
					<li>
						<b class="text-foreground">Personal records:</b> your biggest crit, hit, heal and the
						hardest slap you ever took, dungeon or open world. Also in the app (<i>Records</i>) and
						in the addon.
					</li>
					<li>
						<b class="text-foreground">Only your party and your own character.</b> Strangers who wander
						into your fight are never shown or uploaded — not on the portal, not in the addon.
					</li>
					<li>
						The log files are deleted when you quit the app (tray → Quit). Closing the app's window
						or the addon's window does not stop anything; both keep working in the background.
					</li>
				</ul>
			</div>
		</div>
	{/if}
</section>
