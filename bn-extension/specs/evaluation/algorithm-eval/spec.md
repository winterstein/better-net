# Algorithm evaluation

## Overview

A shared way to measure how well BetterNet’s algorithms do their job — not how fast they run (though let's measure that too).

We evaluate:

- Page → chunks (the chunker)
- Each chunk analyser as a whole
- Each unreliable step inside an analyser (the places that can be wrong even when the rest of the pipeline is fine)

Gold examples live in this repo, independent of which model or heuristic we plug in. A *setup* (local model X, OpenAI, signals-only, …) is something we run *against* those examples. Same data, different setups, comparable scores.

Used for:

- Regression (CI: “did we make tagging worse?”)
- Reporting (precision / recall / “rewrote when it should have left alone”)
- Improvement loops (“local tagging is weak — try a new scorer / prompt / model”)

Later: the same labelled rows should be exportable for fine-tuning. We do not train yet.

## Status

draft — no harness yet. Click Unbait detection and chunking already have labelled fixtures; this spec generalises that pattern.

## Tooling choice

**Git is the source of truth for examples and expected answers.**  
**AIQA Experiments is the reporting / comparison layer.**  
Those are not alternatives — Experiments needs a dataset on the AIQA server.

`ExperimentRunner` takes a `datasetId`, loads examples from the server, scores each one, and summarises the run. There is no useful Experiments report without examples registered in AIQA. Live Traces (already wired in the extension) are a different product: production debugging, not “setup A vs B on a fixed gold set.”

Do not put gold labels *only* in AIQA. Do not skip AIQA reporting and rebuild run history / compare-setups UI in this repo either — that would reinvent the part AIQA already does. Do not add Langfuse.

Practical split:

| Concern | Where |
|--------|--------|
| Canonical examples + expected | git (`test-data/…`) |
| CI floors (`npm test`) | local runner on git — offline, no API key |
| Named experiments, setup compare, run history | AIQA Experiments |
| Live page/feature debugging | AIQA Traces (already) |

Mirror, don’t dual-write by hand: when you want a reported experiment, sync/upload the git dataset into AIQA (or refresh an existing dataset id), then run `ExperimentRunner` against that copy. Git remains authoritative; AIQA holds a snapshot so Experiments work.

Why git for gold:

- Adding an example is a file in a PR, reviewed like code
- CI can fail a merge without talking to a live server
- Saved pages already belong next to the chunker (`test-data/pages/`)
- Fine-tune later is a JSON export from the same files, not “please dump the SaaS”
- Labels version with the code that claims to pass them

Why AIQA Experiments on top (not a home-grown report):

- Comparing setups wants run history and a UI — building that here is reinventing AIQA
- Same org already has Traces; experiment runs sit next to that world
- Client already in the package (`aiqa-client` → `ExperimentRunner`)

What AIQA is *not* for here:

- Being the only copy of the corpus
- Gating `npm test`

Runtime / latency / memory is a different question (empty `specs/performance-testing.md`). Keep it separate.

## Relevant links

- Existing chunking gold: `test-data/pages/` + `test/chunking-pages.test.ts`
- Existing clickbait gold: `test-data/clickbait-headlines.json` + detector asserts in `test/click-unbait.test.ts`
- Click Unbait steps (worked example): `specs/click-unbait/unravel/spec.md`
- Live traces: `src/tracing/`, Settings → Data Sharing → AIQA
- Terminology: chunk, module, tag (`terminology.md`)

## Units of evaluation

One **dataset** = one contract:

- `id` — stable, e.g. `click-unbait.tag-headline`
- `input` — what the step sees (headline text; saved HTML; destination article text + original title)
- `expected` — gold for *this* step only
- `split` — `ci` (fast, always) vs `holdout` (not used while tuning) vs `slow` (needs a model or a fetch)
- optional `notes`, `source` URL, date captured

One **setup** = how we compute the output (model id, prompt, heuristic). Setups are not stored inside the dataset.

One **run** = setup + dataset → scores. CI keeps a floor on `ci` splits (local, from git). Improvement / reporting runs go through AIQA Experiments against a synced dataset copy.

### Step vs feature

Every feature that judges content should have **both**:

- **Feature dataset** (`click-unbait.end-to-end`, …) — user-visible contract. Given a realistic input (headline + page / destination fixture), did we rewrite correctly, leave alone, label risk, etc.? This is what “is the feature working?” means.
- **Step datasets** — same feature broken into unreliable steps. When e2e fails (or when improving a weak setup), these show *which* bit failed.

They answer different questions. Passing every step and failing e2e is possible (wiring, thresholds, order). Passing e2e while a step is soft is also possible. Keep both; do not treat e2e as optional once the feature ships.

Chunking is its own top-level concern (`chunking.pages`), not a step under a module — but the same idea applies if we later split “find cards” vs “assign tags”.

If a step is reliable (pure format, no judgement), it does not need a dataset — ordinary unit tests are enough. `formatUnbaitTitle` is in that bucket.

E2e rows are usually fewer, richer fixtures, and often `slow` (fetch / model). Step rows are cheaper and denser — good for CI floors and targeted improvement loops.

## Scoring outputs

Start from what we actually output, not from the full metric menu.

### What we need (likely day-to-day)

| Output shape | Examples here | Practical checker | Notes |
|--------------|---------------|-------------------|--------|
| Discrete label | bait/plain; rewrite yes/no; fact verdict | Exact match (`equals`) | Core of tag-headline, rewrite-or-leave, many e2e rows |
| URL or null | pick-destination | Exact match (incl. “must be null”) | Wrong URL is worse than no rewrite — binary |
| Presence / absence in text | mustChunk / mustNotAppear; mustMention; must not echo headline | `contains` / `not_contains` (often several) | Already how chunking gold works; best fit for short payoffs |
| Bounds / structure | chunk count min–max; xpath resolves; maxWords | Checklist / `javascript` | Not a single string compare |
| Risk band / threshold | problemScore → Safe/Caution/High; “should flag” vs not | Band or cut (not exact float) | Exact `problemScore == 0.73` is brittle |
| Aggregate over a set | recall on bait; FP rate on plain; precision@threshold | Dataset summary from 0/1 per row | This is the CI / experiment contract |

### What we need less often

| Output shape | When | Checker | Role |
|--------------|------|---------|------|
| Soft paraphrase of a short summary | extract-summary / e2e when many wordings are fine | `similar` or `llm` | Secondary on `slow`; not the merge gate |
| Free-text explanation quality | module `explanation` | Usually ignore for CI | Optional `llm` later if we care |
| Duration / tokens | experiment runs | `system` | Report only |

### Policy

1. Prefer deterministic checkers for anything that gates CI.
2. Generative steps (honest summary): default to checklist (`mustMention` + `mustNotEcho` + length). Add `similar` / `llm` only when a row cannot be captured that way.
3. Continuous scores (`problemScore`, confidence): score bands or above/below threshold, never exact floats.
4. Always define the set-level floor (recall / FP / pass-rate) — that is the regression contract. Per-example metrics feed it.
5. `unclear` / holdout rows are excluded from floors, not forced into a label.

### Fit to AIQA

AIQA metric types cover the checkers we need. We will not use most of them on day one.

Lean on: `equals`, `contains`, `not_contains`, `javascript`, plus experiment summaries (aggregates of 0/1 rows, or client-computed recall stored on the run).

Defer / use sparingly: `similar` (only if checklist gold is too rigid); `llm` (secondary on `slow`, never sole merge gate); exact numeric equals on `problemScore`.

Caveats:

- Local `scoreMetric` in `aiqa-client` today only runs `javascript` in-process; `llm` is server-side. Offline CI implements contains/equals/bands itself (chunking already does). Sync maps `expected.*` → AIQA metrics so Experiments and CI agree.
- Do not invent a parallel scoring DSL — keep git `expected` fields close to these checkers.

### Per first datasets

- `chunking.pages` — mustChunk / mustNotAppear / count bounds / xpath (already). No LLM.
- `click-unbait.tag-headline` — label equals; report recall + FP rate. No LLM.
- `click-unbait.pick-destination` — URL equals or null. No LLM.
- `click-unbait.extract-summary` — checklist first; `similar`/`llm` optional on hard rows.
- `click-unbait.rewrite-or-leave` — boolean equals (+ optional contains on display text if rewritten).
- `click-unbait.end-to-end` — rewrite/leave + checklist on the visible line.
- Later scorers (bias, ragebait, fact-check): band/threshold + expected flags; explanations out of CI unless we add them on purpose.

## First datasets (Click Unbait as the template)

Feature-level:

- `click-unbait.end-to-end` — headline (+ destination fixture or saved page) → rewrite / leave alone / expected summary checks. Start small with real cases (Upworthy bait that should rewrite; BBC plain that must stay).

Step-level (unreliable steps we already know):

1. `click-unbait.tag-headline` — likely clickbait or not (`bait` / `plain` / `quiz` / `unclear`). `unclear` is excluded from pass/fail, not relabelled to make the metric pretty. *Already exists* as `clickbait-headlines.json`.
2. `click-unbait.pick-destination` — which URL (or none). Wrong page is worse than no rewrite.
3. `click-unbait.extract-summary` — short honest payoff from the destination. Not string-equal: checks such as “mentions X”, “does not echo the bait headline”, “short enough”.
4. `click-unbait.rewrite-or-leave` — given tag + summary (or failure), rewrite vs leave the headline alone.

Also:

- `chunking.pages` — saved HTML → quality expectations (`mustChunk`, `mustNotAppear`, count bounds, xpath resolves). *Already exists.* Exact full-page chunk lists are too brittle; keep the current style.
- Later features: same pair — one e2e dataset + one step dataset per unreliable step (Fact Checker, Bias Detector, …).

Build order can still grow steps first where we already have gold, but the design includes e2e from the start — do not defer the feature dataset as “nice later.”

## Examples

Add a row:

1. Copy a nearby example in the dataset file.
2. Fill `input` from a real page (headline, snippet, or `capture-page.js` HTML).
3. Hand-label `expected`. If you are unsure, use `unclear` / omit from thresholds — do not guess.
4. Run the eval for that dataset. If it fails, either the algorithm is wrong or the label is; say which in the PR.

Improvement loop:

1. Report says `click-unbait.tag-headline` + setup `local:flan-t5-small` is weak vs `signals`.
2. Try a new setup (prompt, model, hybrid). Same dataset.
3. Compare scores. Promote only if holdout does not collapse.
4. Sync the dataset if needed, record the two runs as AIQA Experiments, compare in the UI.

See [example-row-shapes.md](./example-row-shapes.md) for concrete JSON shapes.

## Collecting examples

### AIQA traces as a source?

**Good for small, already-traced inputs — not for “HTML as the browser sees it.”**

Today traces deliberately store lengths/scores and a short headline `input`/`output` pair — not chunk bodies, prompts, or page HTML (privacy + size). AIQA Examples can be promoted from a trace’s spans, which is a fine path for e.g. “this headline was tagged wrong” → draft row for `tag-headline`.

Do **not** route full DOM/HTML through production AIQA sampling to build the corpus:

- Logged-in pages carry private feed/handle/token residue (same warning as `capture-page.js`)
- Pages are large; traces would balloon
- Opt-in QA tracing ≠ consent to store whole pages as eval gold
- Gold must be scrubbed and reviewed in a PR; a sampled trace is not that

For page-sized inputs, keep the existing capture path: save the rendered DOM → `capture-page.js` (strip scripts) → hand-label `expected` → commit. Traces can still *point* at a failure (“chunking missed this story on bbc.co.uk”) and you capture a fresh fixture on purpose.

Optional later: a local “save for eval” action that writes a candidate fixture to disk (or a private draft), never through the default trace pipeline.

### On-disk layout in git

Match size to format — do not force one shape.

| Input size | Layout | Why |
|------------|--------|-----|
| Small rows (headline, URL, label, short excerpt) | **One JSON file, many examples** | Easy to add, grep, review in a PR. Pretty-printed (`clickbait-headlines.json` style), with optional file-level `_comment`. |
| Large inputs (whole HTML page, long destination body) | **One example = stem** — e.g. `pages/bbc.co.uk-home.html` + `bbc.co.uk-home.expected.json` | Diffs stay readable; HTML is not escaped inside a giant JSON string; mirrors what chunking already does. |

Avoid: embedding multi-MB HTML inside JSON; one blob with all pages inline; duplicating the same page into every step dataset (reference the page fixture by id/path from small-row datasets when needed).

No JSONL — same JSON shapes for edit, CI, sync, and any later fine-tune export.

`expected` / metrics stay small either way. Large bytes live as sibling files.

## Out of scope

- Training / fine-tuning (export format only, later)
- Runtime performance (latency, memory, WASM)
- Replacing unit tests for deterministic code
- Judging production live traffic automatically (traces stay opt-in QA, not the gold set)
- LLM-as-judge as the *only* merge gate (allowed as a secondary `slow` metric)

## Build plan

1. Agree this spec (tooling + step-shaped datasets).
2. Define a tiny shared schema (id, input, expected, split) and a runner that: loads a dataset, calls a setup, prints scores, exits non-zero if below the floor.
3. Wrap existing clickbait + page fixtures as the first two datasets so we do not fork them.
4. Add datasets for the other Click Unbait steps; keep examples few and real.
5. `npm test` runs `ci` splits only. A separate `npm run eval` (or tagged tests) runs `slow` / model setups.
6. Wire dataset sync + `ExperimentRunner` for reported evals (`npm run eval` / similar). Local CI stays git-only.
7. Repeat the pattern for the next feature’s unreliable steps.

## Test plan

- Schema: a bad example file fails fast (missing label, unknown split).
- Runner: deterministic fake setup on a 3-row stub → known scores.
- Regression: current detector floors on `clickbait-headlines.json` still hold after the wrap.
- Chunking: existing `chunking-pages` expectations still hold.
- Manual: add one new headline example; eval picks it up without code changes.

## Open (update as we go)

- Exact folder tree under `test-data/` (names only; layout rules are above).
- AIQA dataset sync: every reported eval, or only when the git corpus changed since last sync.
- Confirm server-side scoring for `contains` / `similar` / `llm` on our AIQA deploy (types are there; wire once in a smoke experiment).
- Optional “save for eval” capture UX (local only).
- Fine-tune export columns (when we need them).
