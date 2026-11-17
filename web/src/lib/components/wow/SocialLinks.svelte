<script lang="ts">
	import Tip from './Tip.svelte';
	// Povezave na skupnost (Discord, Facebook …), ki jih Guild Master nastavi v Office → Website → Home page.
	// pojmenovani uvozi: v paket gredo samo te ikone, ne vseh ~3000
	import {
		siBluesky,
		siDiscord,
		siFacebook,
		siInstagram,
		siKick,
		siPatreon,
		siReddit,
		siTiktok,
		siTwitch,
		siX,
		siYoutube
	} from 'simple-icons';
	import Globe from '@lucide/svelte/icons/globe';

	type Social = { kind: string; url: string; label?: string };
	let { socials, variant = 'buttons' }: { socials: Social[]; variant?: 'buttons' | 'icons' } =
		$props();

	const ICON: Record<string, { title: string; path: string; hex: string } | undefined> = {
		discord: siDiscord,
		facebook: siFacebook,
		youtube: siYoutube,
		twitch: siTwitch,
		x: siX,
		instagram: siInstagram,
		tiktok: siTiktok,
		reddit: siReddit,
		bluesky: siBluesky,
		kick: siKick,
		patreon: siPatreon
	};
	const NAME: Record<string, string> = { x: 'X', website: 'Website', discord: 'Join our Discord' };
	const label = (s: Social) => s.label || NAME[s.kind] || ICON[s.kind]?.title || s.kind;
	// temne znamke (X, TikTok …) na temnem ozadju: svetla barva
	const color = (s: Social) => {
		const hex = ICON[s.kind]?.hex;
		return !hex || hex === '000000' ? 'currentColor' : `#${hex}`;
	};
</script>

{#if socials.length}
	<div class="flex flex-wrap items-center gap-2">
		{#each socials as s, i (i)}
			<Tip text={label(s)}>
			<a
				href={s.url}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={label(s)}
				class={variant === 'buttons'
					? 'inline-flex h-11 items-center gap-2 rounded-md border border-border/70 bg-background/50 px-4 text-sm font-semibold backdrop-blur transition hover:border-primary/60 hover:bg-accent/60'
					: 'inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent/50 hover:text-foreground'}
			>
				{#if ICON[s.kind]}
					<svg viewBox="0 0 24 24" class="size-4" fill={color(s)} aria-hidden="true"
						><path d={ICON[s.kind]!.path} /></svg
					>
				{:else}
					<Globe class="size-4" />
				{/if}
				{#if variant === 'buttons'}<span>{label(s)}</span>{/if}
			</a>
			</Tip>
		{/each}
	</div>
{/if}
