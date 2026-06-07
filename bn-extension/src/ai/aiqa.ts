/**
 * Lightweight LLM observability hook (AIQA-compatible structured events).
 * Set BN_AIQA_ENDPOINT to POST trace JSON; otherwise logs at debug level only.
 */

export interface LLMTraceEvent {
	name: string;
	durationMs: number;
	ok: boolean;
	error?: string;
}

export async function traceLLMCall<T>(name: string, fn: () => Promise<T>): Promise<T> {
	const start = Date.now();
	try {
		const result = await fn();
		await emitTrace({ name, durationMs: Date.now() - start, ok: true });
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await emitTrace({ name, durationMs: Date.now() - start, ok: false, error: message });
		throw err;
	}
}

async function emitTrace(event: LLMTraceEvent): Promise<void> {
	const endpoint =
		(typeof process !== 'undefined' && process.env?.BN_AIQA_ENDPOINT) ||
		(typeof globalThis !== 'undefined' && (globalThis as { BN_AIQA_ENDPOINT?: string }).BN_AIQA_ENDPOINT);

	if (endpoint) {
		try {
			await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'llm_trace', ...event, ts: new Date().toISOString() }),
			});
			return;
		} catch {
			// fall through to console
		}
	}

	if (typeof console !== 'undefined' && console.debug) {
		console.debug('[AIQA]', event);
	}
}
