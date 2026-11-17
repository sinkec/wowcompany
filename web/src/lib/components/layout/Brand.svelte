<script lang="ts">
	// Logotip v glavi: ime ekipe (Guild Master ga nastavi v Office → Website → Home page) nad
	// "WowCompany". Brez imena ekipe samo "WowCompany".
	let { team }: { team: string | null } = $props();
</script>

<a href="/" class="mr-1 flex min-w-0 shrink-0 items-center gap-2.5 sm:mr-3" aria-label="Home">
	<img src="/icon.svg" alt="" class="size-9 shrink-0" />
	<span class="hidden min-w-0 flex-col leading-none lg:flex">
		{#if team}
			<span
				class="max-w-[11rem] truncate text-[0.68rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase"
				>{team}</span
			>
		{/if}
		<span class="font-display text-lg font-bold text-primary {team ? 'mt-0.5' : ''}"
			>WowCompany</span
		>
	</span>
</a>
