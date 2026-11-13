# Shared analysis: build plan

Plan for [spec.md](./spec.md): extensions that opt in upload chunk analysis; any opted-in extension can fetch what others uploaded for the page it is on.

Status: MVP. Built and tested on both sides, behind an opt-in that is off by default. Not yet tried in a real browser or deployed.

## Entry points

- Server: `bn-server/src/routes/shared-analysis.ts`, tables in `src/db.ts` (search "Shared analysis").
- Rules shared by both sides: `bn-extension/src/sharing/share-rules.ts` (what may be shared, what is private, the seed site list).
- Extension client: `bn-extension/src/sharing/shared-analysis-client.ts`.
- Engine hook: `analyzeFeature` and `privateOptions` in `bn-extension/src/analysis/engine.ts`.
- Model ranking: `bn-extension/src/ai/model-info.ts`.
- Tests: `bn-server/test/test_shared_analysis.ts`, `bn-extension/test/share-rules.test.ts`, `bn-extension/test/shared-analysis.test.ts`.

## How it works

Server records:

- Shared result: one per feature + chunk key + model. The primary key is the dedupe: a repeat upload refreshes the date and adds a contributor, nothing else.
- Contributor: a side table of (result, pseudonym), so two contributors of one result are both known.
- Page split: page url to the chunk keys seen on it, merged across uploads, newest 500 kept.
- Site list: allow, block, or private entries, layered over the seed list in `share-rules.ts`.

Endpoints, all under `/api/shared-analysis`:

- `POST /lookup` `{ url }`: the best-ranked result per feature and chunk on that page. POST so urls stay out of access logs.
- `POST /` `{ shareId, url, results[] }`: store one pass.
- `GET /site-lists`: the list extensions apply. `PUT /site-lists` (staff): set or remove one entry.
- `POST /remove-contributor` (staff): delete a contributor's data and block them. Name them by pseudonym or by one of their results.

Extension flow:

1. First pass on a page: if sharing is on and the page is suitable, one lookup by url (3 second limit).
2. The engine checks the local cache, then the shared results, then analyses.
3. A shared hit is copied into the local cache and marked `metadata.shared`. The AIQA span says `betternet.cache: shared`.
4. At the end of each pass, results a model produced in this browser are uploaded in one request.

Chunk keys are the existing content hashes (`analysis/cache-key.ts`, and the Fact Checker's claim key), so the same paragraph on two sites is one record.

## Decisions

Decided with the user, 2026-11-13:

- Suitable websites: exclusion rules in spec.md. Unknown types pass.
- Site list is server-managed. Order: private, block, allow, then type rules. The most specific entry wins (longest host, then longest path); on a tie the cautious one wins. Allow overrides the site-type rule only.
- twitter.com and x.com allowed, direct messages private. facebook.com blocked.
- No chunk text on the server. The upload carries none, and the server refuses a payload that has a `text` or `html` field.
- Best model: `model-info.ts`. One entry per model family, matched on the id. Unknown models rank lowest but above heuristic.
- Adult check: rating meta tag, RTA label, adult top-level domains (`classify/site-type.ts`).
- Private tag on pages and chunks: no sharing, no AIQA trace, no feedback.
- Private content uses local models only, with a toggle on the AI Model options page to use the active model instead.

Chosen while building, to keep it simple. Say if any should change:

- The opt-in is the existing "Use server cache" setting (`useServerCache`), relabelled "Use shared analysis". One switch covers lookup and upload.
- One site list with three kinds (allow, block, private) rather than separate lists.
- Anonymity: option C below, a random share id rotated each calendar month.
- False analysis: option A below, limit the damage only.
- A failed upload is dropped, not queued. The server is a cache, so nothing is lost but a little reuse.
- Rate limiting is a small in-memory counter, no new dependency. Uploads per contributor and per address, lookups per address.
- An extension uses a shared result only when its model ranks equal to or above the user's own.
- Heuristic and error results are never shared.
- The user can mark a page private in the Content Analysis modal. Marking a single chunk is not offered; chunk-level private comes from chunkers only.
- Marks are kept in the browser (`sharing/private-pages.ts`) and are never sent.
- "Local only" for private content also switches off the Google fact-check call, since that sends claim text out.

## Build plan

1. MVP - Model ranking, `ai/model-info.ts`.
2. MVP - Server tables: `sharedResult`, `sharedContributor`, `blockedContributor`, `pageSplit`, `siteList`.
3. MVP - Upload endpoint with validation, caps, and sanitising.
4. MVP - Lookup endpoint, best model per feature and chunk.
5. MVP - Abuse basics: rate limits, markup stripped from every string, links stripped from explanations, non-http `url` dropped.
6. MVP - Extension setting, and the private-content toggle on the AI Model page.
7. MVP - Suitability rules and site list: seed list, server table, fetch and day-long cache in the extension, enforced on the server too.
8. MVP - Adult check.
9. MVP - Private tag: page flag, chunk modifier, X protected posts, site-list private entries, the modal button. Honoured by sharing, the tracer (`NO_TRACE` in `tracing/tracer-hook.ts`), feedback, and model choice.
10. MVP - Extension client: lookup, upload, share id.
11. MVP - Engine layering: local cache, shared, analyse.
12. MVP - Upload at the end of each pass (`background.ts` runPass).
13. MVP - Removal endpoint for staff.
14. MVP - Docs: this file, spec.md, cache spec, terminology, both status files.
15. todo - Try it in a real browser against a local server, including the X padlock selector (`[data-testid="icon-lock"]`), which is from memory and not checked against the live site.
16. todo - Seed the server site list with more private and blocked sites (banking, health portals, more webmail) before turning this on for users.
17. todo - Privacy text for the options page and the website.
18. todo - Staff view of shared results in bn-webapp, so a bad result can be found and its contributor removed without SQL.

## Test plan

Automated, and passing:

- Server: upload then lookup; a repeat upload stays one row; the best-ranked model is served; per-user fields are dropped.
- Server: heuristic, no model, error result, chunk text, oversize, bad key, empty, no share id are refused. Blocked site, private path, and local host are refused for upload and return nothing on lookup.
- Server: markup and links are stripped; rate limit returns 429; site-list edits need staff and take effect at once.
- Server: removing a contributor deletes their results, keeps one a second contributor also sent, and blocks further uploads.
- Extension: sharing off makes no network call. An unsuitable page makes no lookup. The site list is fetched once, not per page.
- Extension: only the normalised url is sent; the upload has no chunk text; a result is uploaded once; server down means analysis carries on.
- Extension: a shared hit skips the feature and is not uploaded back; a weaker model's result is not used; heuristic results and excluded chunk roles are not shared.
- Extension: a private chunk or page opens no span, is not shared, and is switched to the local model; with the toggle off it keeps the active model but stays untraced and unshared.
- Extension: each excluded page type and chunk role; site-list matching; url normalisation; the adult check; model ranking, including every download in the catalog.
- Extension: marking a page private drops queued feedback about it; a protected X post is tagged private.
- Both: the real extension client against a locally running server, two browsers, one page (run by hand once, not in the suite).

Still to do by hand: step 15.

## Open question: defending against false analysis

Not a blocker per the spec. Built: option A.

- A. Limit the damage. Validation, rate limits, sanitised text, staff removal. A false verdict can still be served, but it cannot carry a link or markup, and one contributor cannot flood.
- B. Agreement. Serve a result only once two contributors uploaded a matching problem score. The contributor table already holds the count. Cost: the first reader of a page gets nothing, and an attacker with two ids passes.
- C. Client spot-check. Each extension re-analyses a small random share of shared hits and reports a mismatch. No server model cost.
- D. Server spot-check. Ruled out: it needs chunk text on the server.
- E. Signed-in contributors only. Simple, but breaks "no account needed" and makes uploads identifiable.

Suggested next: C once there is traffic, B as a switch for Fact Checker. Compare problem score and tags, never explanation text, since model output varies.

Known gap: the first writer's content stands. If a bad actor writes a result first and an honest contributor then sends the same key, removing the bad actor keeps the row with the bad content. Option B or C closes this.

## Open question: anonymous, but removable

Built: option C.

- A. Reuse the feedback local id. Links uploads to feedback and to an account. Rejected.
- B. A separate random share id, kept for ever. One long-lived pseudonymous reading profile per contributor.
- C. A separate random share id, replaced monthly. The server keeps only an HMAC of it. A profile is one month at most, and a bad actor's month is removable in one call. Downside: a blocked actor is back next month, or sooner by clearing storage.
- D. No id. Most anonymous, removal by content only.
- E. Blind-signed tokens. Proper unlinkability with rate limiting. Heavy.

Not built: "Delete my data" does not remove this browser's shared results. It could, for the current month's id.

## Other open points

- Unknown still passes. A friends-only or logged-in page on a site nobody has listed is shared until a detector or a list entry covers it. No chunk text is sent, but the url and the verdict are. Step 16 is the mitigation.
- Lookup tells the server which page is being read, even with no upload. The opt-in text says so. Looking up by chunk keys instead of url would avoid it, at the cost of chunking first.
- No maximum age on results yet, so a model upgrade does not replace an old verdict from the same model id.
- Fact Checker keys depend on claim extraction, which can differ by model, so two extensions may miss each other's results.
- Results can quote the chunk: explanations and extracted claims are the model's free text. Capped at 1000 characters and 8 KB per result.
