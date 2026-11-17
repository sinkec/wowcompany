// Napake s strežnika za toast: brez Convexovega ovoja (ConvexError nosi sporočilo v `data`).
import { toast } from 'svelte-sonner';

export function errText(e: unknown) {
	const data = (e as { data?: unknown }).data;
	if (typeof data === 'string') return data;
	return ((e as Error).message ?? 'Something broke.')
		.replace(/^\[CONVEX[^\]]*\]\s*/, '')
		.replace(/^\[Request ID: [^\]]*\]\s*/, '')
		.replace(/^Server Error\s*/, '')
		.replace(/^Uncaught (ConvexError|Error):\s*/, '')
		.replace(/\s+at .*$/s, '');
}

/** Počaka na klic, ob uspehu (če je `ok`) pokaže toast, ob napaki toast z berljivim besedilom. */
export async function attempt<T>(p: Promise<T>, ok?: string): Promise<T | undefined> {
	try {
		const r = await p;
		if (ok) toast.success(ok);
		return r;
	} catch (e) {
		toast.error(errText(e));
	}
}
