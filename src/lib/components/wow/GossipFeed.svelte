<script lang="ts">
	import type { FeedEvent } from '#lib/types.js';
	import { sessionHeadline } from '#convex/lib/humor.js';
	import Locked from './Locked.svelte';
	import { ago, classColor, fmt, qualityColor } from '#lib/wow.js';

	let {
		events,
		title = 'Tavern Gossip',
		showTitle = true,
		locked = false,
		class: klass = ''
	}: { events: FeedEvent[]; title?: string; showTitle?: boolean; locked?: boolean; class?: string } = $props();

	const headline = (e: FeedEvent) => sessionHeadline(e, [...e.id].reduce((a, c) => a + c.charCodeAt(0), 0));
</script>

<section class="wow-frame rounded-lg p-4 {klass}">
	{#if showTitle}<h3 class="mb-3 text-sm font-semibold text-primary">{title}</h3>{/if}
	{#if locked}
		<Locked what="who did what in the tavern" />
	{:else if events.length === 0}
		<p class="py-6 text-center text-sm text-muted-foreground italic">
			Quiet tavern. Either everyone is online, or everyone is dead.
		</p>
	{:else}
		<ul class="space-y-3">
			{#each events as e (e.id)}
				<li class="flex gap-3">
					{#if e.avatar}
						<img src={e.avatar} alt="" class="size-9 shrink-0 rounded-full border" style="border-color: {classColor(e.classId)}" />
					{:else}
						<div class="size-9 shrink-0 rounded-full bg-muted"></div>
					{/if}
					<div class="min-w-0 text-sm">
						<p>
							<a href="/c/{e.slug}" class="font-semibold hover:underline" style="color: {classColor(e.classId)}">{e.name}</a>
							{headline(e)}
						</p>
						<p class="text-xs text-muted-foreground">
							{ago(e.at)}
							{#if e.kills}· {fmt(e.kills)} kills{/if}
							{#if e.quests}· {fmt(e.quests)} quests{/if}
							{#if e.deaths}· {fmt(e.deaths)} deaths{/if}
						</p>
						{#if e.newItems.length}
							<p class="mt-0.5 text-xs">
								looted
								{#each e.newItems.slice(0, 4) as it, i (i)}
									<span style="color: {qualityColor(it.quality)}">[{it.name}]</span>{i < Math.min(e.newItems.length, 4) - 1 ? ', ' : ''}
								{/each}
								{#if e.newItems.length > 4}and {e.newItems.length - 4} more pieces of junk{/if}
							</p>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
