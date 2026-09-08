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
| `aspect` | One per feature card (accuracy, bias, clickbait, …) | "this aspect result is right / wrong" |
| `chunker` | Once, in the modal footer, page-level | "the page was split up sensibly / badly" |
| `chunk` | Once, on this chunk's header | "this region should / shouldn't be a chunk, and its tags are right / wrong" |

Existing aspect feedback keeps working: thumbs up on an aspect still means "yes,
this applies". For the other targets a thumb is simply right/wrong.

## Interaction

- **Thumbs up** — submits immediately, shows a brief "Thanks!". Done.
- **Thumbs down** — submits immediately too (we never lose the signal if the
  user walks away), then expands a row of **preset issue buttons** for that
  target. Clicking one sends a follow-up that updates the same feedback record.
- **Other…** reveals a short free-text box (capped, ~500 chars) with a Send
  button.
- Thumbs are toggleable: clicking the same thumb again retracts, clicking the
  other one replaces.
- Presets are single-select for v1. (Multi-select is an easy later change if
  users ask.)

Preset lists are passed into the feedback widget by the caller, so each target —
and later each feature — can offer its own vocabulary without touching the
widget.

### Preset issues (starting lists)

**summary** — Score too high · Score too low · Summary is inaccurate · Missed
the main problem · Wrong topic · Other…

**aspect** — Not <aspect> (e.g. "This isn't clickbait") · Overstated ·
Understated · Explanation is wrong · Quoted the wrong bit · Other…

**chunker** — Missed content on the page · Split one article into pieces ·
Merged separate items · Picked up nav/ads/comments as content · Other…

**chunk** — This shouldn't be a chunk · Boundaries are wrong (too much / too
little) · Wrong tag · Wrong title · Other…

Preset ids are stable strings (e.g. `score-too-high`, `not-a-chunk`) so they
survive label rewording and can be counted server-side.

## Trace linking

Each feedback record carries the AIQA `traceId` for the page analysis, plus the
`spanId` of the specific step where we know it (the chunker span, the aspect's
LLM call). That is the whole point: a thumbs down becomes "open this trace, look
at this span".

Caveats to design around, not hide:

- Tracing is opt-in and sampled (Settings → Data Sharing). When there's no
  trace, feedback still submits — the trace fields are just absent.
- Local-model analysis and server-cached analysis may have no extension-side
  trace. Cached results should carry the trace id of the run that produced them,
  if the server has it.

## Developer Mode

Rename Settings → Advanced → **Console logging** to **Developer Mode**
(`consoleLogging` → `developerMode`, migrating the existing value). It gates:

1. Console logging (current behaviour, unchanged).
2. **Trace reveal**: after any feedback is submitted, the confirmation shows the
   trace id (short, monospace, click to copy) and a link to the AIQA trace.

Description text: "Console logging, plus AIQA trace links on feedback. For
developers and bug reports."

The link points at the AIQA **UI** host (`aiqa.winterwell.com`), not the API
host in Settings (`server-aiqa.winterwell.com`) — exact trace path to confirm.
If tracing is off or the analysis wasn't sampled, show "no trace for this
analysis" rather than a dead link.

Non-developers never see a trace id. They see "Thanks!".

## Where it goes

**bn-server is the store of record**, in PostgreSQL. Content script → background
worker → `POST /api/feedback` (`bn-server/src/routes/feedback.ts`, table
`feedback` = `chunkId` + `pageId` + `props` JSONB with a GIN index, so new
fields need no migration). Offline or failed sends queue in
`chrome.storage.local` and flush on the next success. Gated by Data Sharing
opt-in, as now.

The POST is an **upsert on a client-generated `localId`**: the thumb inserts the
record, and the preset issue or note that follows updates it. Offline the queue
is keyed the same way, so a follow-up made with no connection replaces the
queued thumb instead of adding to it.

**AIQA is a mirror, not the store.** `aiqa-client` does offer
`submitFeedback(traceId, { thumbsUp, comment })`, which writes a synthetic span
carrying `feedback.value` / `feedback.comment` onto the trace — nice, because
the thumb then shows up next to the prompts in the AIQA UI and can seed eval
datasets. But it can't be the primary store:

- **Coverage.** It needs a trace, and tracing is off by default, sampled, and
  needs a user-supplied API key. Most users' feedback would simply not exist.
- **Granularity.** It's one thumb + free text per *trace*. It has no notion of
  "aspect `clickbait` on chunk 3" or of preset issue ids, so everything we
  collapse into it loses the precision this spec is for.
- **Queryability.** The questions we want to ask ("top false-positive clickbait
  chunks this week") join feedback against our chunk and analysis rows.
- **Ownership.** User-contributed corrections are eval/training data — a product
  asset that belongs in our DB, exported to AIQA datasets deliberately.

So: dual write. Always write to bn-server; when a trace id exists, also call
`submitFeedback` best-effort (fire and forget, never block the UI, never surface
its failure). Encode target + issue into the comment string so the AIQA UI shows
something useful, e.g. `aspect:clickbait / not-clickbait / "it's a news piece"`.
In practice this mirror fires mostly for internal and Developer Mode users, who
are the ones reading traces anyway.

Note: `bn-server/specs/bn-server-stack.md` says ElasticSearch holds chunks and
feedback. Feedback stays in PostgreSQL for now; that spec is the one to
reconcile.

### Data sent

Extends `FeedbackSubmission`:

- `target`: `summary` | `aspect` | `chunker` | `chunk`
- `issueId`, `issueLabel`: preset chosen on thumbs down (optional)
- `traceId`, `spanId` (optional)
- `aspectType` / `moduleId` only for `target: aspect`
- for `chunker`, page context (url, chunk count) instead of a chunk fingerprint

A follow-up preset or note updates the record the thumb created, so one thumbs
down is one row, not two.

## Out of scope (v1)

- Multi-select issues, per-statement feedback, feedback from the Popup.
- Reading aggregates back (agreement counts on a chunk).
- Letting users edit a chunk boundary by hand.

## Open questions

- Should Developer Mode also absorb "Show chunk overlay", or does that stay a
  separate toggle? (Overlay is genuinely useful to curious non-developers.)
- The AIQA UI's own trace path is unconfirmed — `tracing/aiqa-trace-url.ts` has
  the one constant to fix once we know it.

## Where the code lives

- `feedback/feedback-issues.ts` — the preset lists
- `feedback/feedback-client.ts` — payload, validation per target, offline queue
- `content/content-analysis-modal.ts` — the widget and its four placements
- `background/feedback-manager.ts` — POST to bn-server, then the AIQA mirror
- `tracing/aiqa-tracer.ts` — `mirrorFeedbackToAiqa()`, span ids for linking
- `settings/migrate-settings.ts` — `consoleLogging` → `developerMode`
