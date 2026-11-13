/**
 * What we know about models, starting with a quality rank.
 *
 * Shared analysis (bn-server/specs/shared-analysis) uses the rank twice: the server serves
 * the best-ranked result it holds for a chunk, and the extension only accepts a shared
 * result from a model at least as good as the user's own.
 *
 * Scope: the common API models, the models we offer for download (ai/model-catalog.ts),
 * and the common Ollama models. One entry per family, matched on the id, so dated ids
 * (`gpt-4o-2024-08-06`) and Ollama tags (`llama3.2:3b`) land on their family. Parameter
 * size within a family is ignored — a rough order is enough to pick between results.
 *
 * No imports: bn-server reads this file through its bn-extension-src symlink.
 */

export interface ModelInfo {
	/** Tested against the lowercased model id. First match wins, so specific goes first. */
	match: RegExp;
	/** Higher is better. Bands, not a fine scale: see the constants below. */
	rank: number;
}

/** No model ran: heuristics, or no id at all. Never shared. */
export const RANK_NONE = 0;
/** A model we have no entry for, e.g. on a custom endpoint. Shareable, but loses to any known model. */
export const RANK_UNKNOWN = 1;

const RANK_CLASSIFIER = 10; // zero-shot classifiers: a label, no reasoning
const RANK_TINY = 20; // in-browser generative, under 1B parameters
const RANK_SMALL = 40; // local, roughly 1-4B
const RANK_LOCAL = 50; // local, roughly 7B and up
const RANK_API_SMALL = 60;
const RANK_API = 80;
const RANK_API_TOP = 90;

export const MODEL_INFO: ModelInfo[] = [
	// Our downloads (ai/model-catalog.ts). test/model-info.test.ts checks each one is listed.
	{ match: /^(mobilebert|distilbert)/, rank: RANK_CLASSIFIER },
	{ match: /^flan-t5-small/, rank: RANK_TINY },
	{ match: /^flan-t5/, rank: RANK_TINY + 5 },
	{ match: /^gemma-3-270m/, rank: RANK_TINY },

	// OpenAI
	{ match: /^gpt-.*(mini|nano)/, rank: RANK_API_SMALL },
	{ match: /^gpt-3/, rank: RANK_API_SMALL },
	{ match: /^(gpt-5|o[134](-|$))/, rank: RANK_API_TOP },
	{ match: /^gpt-4/, rank: RANK_API },

	// Anthropic
	{ match: /^claude.*haiku/, rank: RANK_API_SMALL },
	{ match: /^claude.*opus/, rank: RANK_API_TOP },
	{ match: /^claude/, rank: RANK_API },

	// Ollama
	{ match: /^(tinyllama|smollm)/, rank: RANK_TINY },
	{ match: /^(llama3\.2|gemma3|phi3|phi4-mini|qwen2\.5-?coder|deepseek-r1:1)/, rank: RANK_SMALL },
	{ match: /^(llama3|mistral|gemma2|qwen|phi4|deepseek-r1|llama2)/, rank: RANK_LOCAL },
];

export function modelRank(modelId: string | null | undefined): number {
	const id = String(modelId ?? '').trim().toLowerCase();
	if (!id || id === 'heuristic' || id === 'mock') return RANK_NONE;
	return MODEL_INFO.find((info) => info.match.test(id))?.rank ?? RANK_UNKNOWN;
}
