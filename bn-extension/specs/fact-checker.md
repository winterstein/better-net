
Specifications for the Fact Checker feature

User can override per domain in Off-List.

Extracts factual claims from page content (headlines, posts, articles).
Checks claims against fact-check sources (e.g. Google Fact Check Tools API) and shared cache where available.
Surfaces results via in-page nutrient labels so the user stays in control.
Focuses on news / political / medical / financial claims — ignores mundane facts and everyday statements.

Settings module: `factChecker`.

## Status

Target tags (terminology.md):

- no-claims — heuristic / Google path when no extractable claims (working)
- false-claim — when fact-check ratings are mostly false (working, Google API)
- suspect-claim — partial / unverified after search (working)
- verified-claims — ratings mostly true (working)
- fringe-view — to-do (demo dataset uses it; live detector not wired)

The Content Analysis modal lists every claim that was looked up, matched or not:
`metadata.factChecks` is a `ClaimCheck[]` (claim + `status` + any reviews), so
"checked three claims, none of them rated" is shown as such rather than as an empty
card. `factChecksFound` counts only the claims that matched.

Fallback to LLM general knowledge:
Published 3rd party factchecks (e.g. Google Fact Check Tools API) are preferred.
When Google has no published rating (no key, or none of the claims matched), `analyze-chunk.ts` calls `runFeatureAnalysis` with the `fact-checker` prompt. The claim list from the lookup is kept. `metadata.diagnostic` is `llm_general_knowledge`, and the explanation is prefixed "General knowledge:".

Coverage overall: partial. No LLM claim extraction yet beyond sentence heuristics.
