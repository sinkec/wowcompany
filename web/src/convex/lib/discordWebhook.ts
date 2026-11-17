// Pošiljanje v Discord kanal prek webhooka (objave sej, runov, dogodkov). Brez stalne povezave.
export type WebhookResult = { ok: boolean; retryAfter?: number; error?: string };

export async function sendWebhook(url: string | null, body: object): Promise<WebhookResult> {
	if (!url)
		return { ok: false, error: 'No webhook configured. Set one in Office → Discord → Connection.' };
	const res = await fetch(`${url}?wait=true`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: 'Tavern Gossip', allowed_mentions: { parse: [] }, ...body })
	});
	if (res.ok) return { ok: true };
	if (res.status === 429) {
		const j = (await res.json().catch(() => ({}))) as { retry_after?: number };
		return { ok: false, retryAfter: j.retry_after ?? 5 };
	}
	return { ok: false, error: `${res.status} ${await res.text()}` };
}
