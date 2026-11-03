# Caches: client-side and server-side

## Client-side cache

The extension should:

1. Store per-feature engine.ts analyzeChunk feature.analyze results in a client-side cache holding upto MAX_CACHE_SIZE (default 5000) results.
2. Before running feature.analyze, check the cache for an existing result.
3. Manage saving and loading the cache to/from local storage.

### Cache keys

Keys ignore where the chunk sits on the page, so a reload hits, and differ when the content differs. There is a default chunk -> cache-key function, and a feature can supply its own.

- Default (`src/analysis/cache-key.ts`), every feature except Fact Checker: hash of the chunk title and text (lowercased, whitespace collapsed) plus its primary link. The link is included so two chunks that share a headline but point at different pages do not share a Click Unbait result.
- Fact Checker (`src/features/fact-checker/factcheck-cache-key.ts`): hash of the extracted claims, or the whole text when none are extracted. The text is lowercased, and punctuation, stop-words, and a short English stem are applied, so "Studies show the vaccine is safe" and "Studies showed that vaccines are safe" share a key. "not" is kept. The link is not part of the key: the same claim on two pages is one fact-check.

A stored value is the feature `analyze` result. 

Not stored: a failure (`error` set, or a throw), or a fallback to heuristic. 
The next view retries those. Lookup is per feature, and also per analysis mode and model, so a result from one model is not served after the user switches model.

If the flow is: google fact-check -> no answer -> local LLM, then the local LLM result is stored in local cache.
If the flow is: call LLM -> error, use non-LLM heuristic, then nothing is cached.

`AnalysisCache` (`src/analysis/analysis-cache.ts`) is the seam a later mix of local and server caching can implement. The engine only calls get and set.

User settings (under advanced settings) are:
 - Use local cache: true/false
 - Clear local cache: button

## Server-side cache: TODO

A future feature: saving and loading shared analysis results from a server-side cache.

The client-side cache code should be modular and support a future strategy of mixing client-side and server-side caching.