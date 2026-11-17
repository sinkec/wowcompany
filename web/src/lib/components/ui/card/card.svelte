<script lang="ts">
	import { cn, type WithElementRef } from "#lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = "default",
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { size?: "default" | "sm" } = $props();
</script>

<!-- WowCompany: okvir iz layout.css (.wow-frame), brez vsiljene postavitve – kartice na strani nosijo svoj odmik/flex. -->
<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	class={cn("wow-frame text-card-foreground rounded-lg [--card-spacing:--spacing(6)] data-[size=sm]:[--card-spacing:--spacing(4)] group/card", className)}
	{...restProps}
>
	{@render children?.()}
</div>
