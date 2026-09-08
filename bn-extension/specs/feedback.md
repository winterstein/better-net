# Feedback

How users tell us we got it wrong (or right). Supersedes the UX half of
`extension-server-feedback.md`, which keeps the transport and server contract.

Goal: precise feedback in two clicks. A thumb tells us *what* was judged; an
optional preset issue tells us *how* it was wrong. Everything ties back to the
AIQA trace so we can go from a complaint to the exact prompt and response.

## What can be rated

Every rateable thing in the **Content Analysis** modal gets its own thumbs
up/down pair. Four kinds of target:

| Target | Where | Rating means |
| --- | --- | --- |
| `summary` | Chunk summary + overall risk score | "this overall verdict is right / wrong" |
| `module` | One per module card (Fact Checker, Bias, Click Unbait, …) | "this module result is right / wrong" |
| `chunker` | Once, in the modal footer, page-level | "the page was split up sensibly / badly" |
| `chunk` | Once, on this chunk's header | "this region should / shouldn't be a chunk, and its tags are right / wrong" |

### What a thumb records

A thumb on its own is nearly useless as data. "You got this wrong" cannot be read
without knowing what we claimed, and "this applies" inverts depending on whether
we said the tag applied in the first place. So each record carries both:

- `thumbsUp` — the click, uninterpreted. Always means one thing.
- `tag` + `tagOn` — the thumb read against the verdict it was given on: **tag X
  is on / off for this chunk**. 👍 on "this is clickbait" and 👎 on "this is not
  clickbait" both record `clickbait` as on.

`tag`/`tagOn` is set for `module`, the one target where exactly one product tag is being
judged. The others rate our whole output — a summary, a chunk boundary, a page
split — and have no single tag to be right or wrong about; their preset issues
carry that detail instead. Extending this to the chunk's own type tag
(`article`, `advert`, …) is the obvious next step, but a 👎 there does not say
*which* tag was wrong, so it needs its own UI first.

"On" is judged against the `safe` risk band (`types/RiskLevel.ts`) — the same
line the Nutrient Label draws, so it is the line the user was reacting to. That
makes a borderline score hinge on a display threshold, which is why
`problemScore` is stored next to the ground truth.

A retraction records no ground truth: `tagOn` is cleared, because a withdrawn
rating asserts nothing.

## Interaction

- **Thumbs up** — submits immediately, shows a brief "Thanks!". Done.
- **Thumbs down** — submits immediately too (we never lose the signal if the
  user walks away), then expands a row of **preset issue buttons** for that
  target. Clicking one sends a follow-up that updates the same feedback record.
- **Other…** reveals a short free-text box (capped, ~500 chars) with a Send
  button.
- Thumbs are toggleable: clicking the same thumb again retracts, clicking the
  other one replaces. **Replacing clears the preset issue and note the previous
  thumb collected** — otherwise a 👍 keeps "this isn't clickbait" attached to it
  and the row reads as praise carrying a complaint.
- Presets are single-select for v1. (Multi-select is an easy later change if
  users ask.)

Preset lists are passed into the feedback widget by the caller, so each target —
and later each feature — can offer its own vocabulary without touching the
widget.

### Preset issues (starting lists)

**summary** — Score too high · Score too low · Summary is inaccurate · Missed
the main problem · Wrong topic · Other…

**module** — Not <tag> (e.g. "This isn't clickbait") · Overstated ·
Understated · Explanation is wrong · Quoted the wrong bit · Other…

**chunker** — Missed content on the page · Split one article into pieces ·
Merged separate items · Picked up nav/ads/comments as content · Other…

**chunk** — This shouldn't be a chunk · Boundaries are wrong (too much / too
little) · Wrong tag · Wrong title · Other…

Preset ids are stable strings (e.g. `score-too-high`, `not-a-chunk`) so they
survive label rewording and can be counted server-side.

## Trace linking

Each feedback record carries the AIQA `traceId` for the page analysis, plus the
`spanId` of the specific step where we know it (the chunker span, the module's
LLM call). That is the whole point: a thumbs down becomes "open this trace, look
at this span".

Caveats to design around, not hide:

- Tracing is opt-in and sampled (Settings → Data Sharing). When there's no
  trace, feedback still submits — the trace fields are just absent.
- Local-model analysis and server-cached analysis may have no extension-side
  trace. Cached results should carry the trace id of the run that produced them,
  if the server has it.
- The AIQA UI has no route for a bare trace id. The trace page is
  `/organisation/<organisationId>/traces/<traceId>`, and any unmatched path
  redirects to the login page — so a link needs the organisation, which is a
  setting (below). Without it we show the copyable id and say what is missing,
  rather than a link that bounces.

## Developer Mode

Rename Settings → Advanced → **Console logging** to **Developer Mode**
(`consoleLogging` → `developerMode`, migrating the existing value). It gates:

1. Console logging (current behaviour, unchanged).
2. **Trace reveal**: after any feedback is submitted, the confirmation shows the
   trace id (short, monospace, click to copy) and a link to the AIQA trace.

Description text: "Console logging, plus AIQA trace links on feedback. For
developers and bug reports."

The link points at the AIQA **UI** host (`aiqa.winterwell.com`), not the API
host in Settings (`server-aiqa.winterwell.com`), and at
`/organisation/<organisationId>/traces/<traceId>` — confirmed against the AIQA
webapp's own routes. The organisation is Settings → Advanced → **AIQA
organisation**; the API derives it from the key, but the UI url needs it
spelled out. If tracing is off or the analysis wasn't sampled, show "no trace
for this analysis" rather than a dead link.

Non-developers never see a trace id. They see "Thanks!".

## Where it goes

**bn-server is the store of record**, in PostgreSQL. Content script → background
worker → `POST /api/feedback` (`bn-server/src/routes/feedback.ts`, table
`feedback` = `chunkId` + `pageId` + `props` JSONB with a GIN index, so new
fields need no migration). Offline or failed sends queue in
`chrome.storage.local` and flush on the next success. Gated by Data Sharing
opt-in, as now.

The POST is an **upsert on a `localId` the client derives** from what is being
rated and who is rating it — user, target, module, and the chunk fingerprint (or
the page url, for `chunker`). That does three jobs: the thumb inserts the record
and the preset issue or note that follows updates it; the offline queue is keyed
the same way, so a follow-up made with no connection replaces the queued thumb
instead of adding to it; and the same person re-rating the same chunk after a
reload **corrects their earlier verdict instead of filing a second opinion
against it**, which is what keeps aggregate counts honest.

A chunk's fingerprint is its url + title (`types/Chunk.ts`), so a page whose body
changed keeps its id, while a different page — or a retitled one — is a new
subject. The trade is that a changed mind overwrites rather than appends: we keep
the current verdict per person, not the history of how they got there.

An update **merges** onto what is stored, so a field the client omits keeps its
value — that is what lets a follow-up be partial. Clearing therefore needs an
explicit `null`, which is how a fresh thumb drops the previous complaint.

**AIQA is a mirror, not the store.** `aiqa-client` does offer
`submitFeedback(traceId, { thumbsUp, comment })`, which writes a synthetic span
carrying `feedback.value` / `feedback.comment` onto the trace — nice, because
the thumb then shows up next to the prompts in the AIQA UI and can seed eval
datasets. But it can't be the primary store:

- **Coverage.** It needs a trace, and tracing is off by default, sampled, and
  needs a user-supplied API key. Most users' feedback would simply not exist.
- **Granularity.** It's one thumb + free text per *trace*. It has no notion of
  "module `clickbait` on chunk 3" or of preset issue ids, so everything we
  collapse into it loses the precision this spec is for.
- **Queryability.** The questions we want to ask ("top false-positive clickbait
  chunks this week") join feedback against our chunk and analysis rows.
- **Ownership.** User-contributed corrections are eval/training data — a product
  asset that belongs in our DB, exported to AIQA datasets deliberately.

So: dual write. Always write to bn-server; when a trace id exists, also call
`submitFeedback` best-effort (fire and forget, never block the UI, never surface
its failure). Encode target + issue into the comment string so the AIQA UI shows
something useful, e.g. `module:clickbait / not-clickbait / "it's a news piece"`.
In practice this mirror fires mostly for internal and Developer Mode users, who
are the ones reading traces anyway.

Note: `bn-server/specs/bn-server-stack.md` says ElasticSearch holds chunks and
feedback. Feedback stays in PostgreSQL for now; that spec is the one to
reconcile.

### Data sent

`FeedbackSubmission` (`src/types/Feedback.ts`):

- `target`: `summary` | `module` | `chunker` | `chunk`
- `thumbsUp`: the click. `retracted`: withdrawn, record kept
- `tag`, `tagOn`: the ground truth, for `target: module` (primary product tag)
- `issueId`, `issueLabel`: preset chosen on thumbs down (optional)
- `traceId`, `spanId` (optional)
- `moduleId` only for `target: module` (legacy `aspectType` accepted by server normalize)
- `pageUrl` for every target, so any row can be traced back to the page it was
  given on; for `chunker` it is the subject rather than context, alongside the
  chunk count and with no chunk fingerprint

A follow-up preset or note updates the record the thumb created, so one thumbs
down is one row, not two.

`applies` was the earlier form of `thumbsUp`. bn-server still accepts it from a
tab left open across an update (`normalizeBody`).

## Out of scope (v1)

- Multi-select issues, per-statement feedback, feedback from the Popup.
- Reading aggregates back (agreement counts on a chunk).
- Letting users edit a chunk boundary by hand.

## Open questions

- Should Developer Mode also absorb "Show chunk overlay", or does that stay a
  separate toggle? (Overlay is genuinely useful to curious non-developers.)
- Whether "on" should be judged against the `safe` band or a threshold of its
  own. Reusing the display threshold matches what the user saw, but it means a
  change to the Nutrient Label's banding silently re-reads old feedback.
- Whether the chunk target should collect per-tag ground truth, which needs UI
  that asks *which* tag was wrong.
- Primary product tag for module feedback comes from `ModuleAnalysis.tags` / `primaryTagForModule`.

## Where the code lives

- `feedback/feedback-issues.ts` — the preset lists
- `feedback/feedback-client.ts` — payload, validation per target, offline queue
- `content/content-analysis-modal.ts` — the widget and its four placements
- `background/feedback-manager.ts` — POST to bn-server, then the AIQA mirror
- `tracing/aiqa-tracer.ts` — `mirrorFeedbackToAiqa()`, span ids for linking
- `settings/migrate-settings.ts` — `consoleLogging` → `developerMode`
