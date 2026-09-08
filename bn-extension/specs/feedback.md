# Feedback

How users tell us we got it wrong (or right). Supersedes the UX half of
`extension-server-feedback.md`, which keeps the transport and server contract.

Goal: precise feedback in one click. Where our output is a set of tags, the
user edits the tags directly — that *is* the ground truth, with nothing to infer.
Where it is not, a thumb plus an optional preset issue tells us how we were
wrong. Everything ties back to the AIQA trace so we can go from a correction to
the exact prompt and response.

## What can be rated

Four targets in the **Content Analysis** modal, rated in one of two ways:

| Target | Where | How it is rated |
| --- | --- | --- |
| `module` | One per module card (Fact Checker, Bias, Click Unbait, …) | **Tag editing.** Its tags are what it asserts, so they are what you correct. |
| `chunk` | This chunk's header | **Both.** Tag editing for its own tags (`chunk-type:…`, `advert`, `sponsored`), and a thumb for the region itself. |
| `summary` | Chunk summary + overall risk score | **Thumb.** A verdict with no tags of its own. |
| `chunker` | Modal footer, page-level | **Thumb.** How the page was split. |

### What a tag edit records

A tag edit is a statement in its own right: **tag `tag` is / is not on this
chunk**, as `tag` + `tagOn`. Removing a tag we applied says it does not belong;
adding one says we missed it. `tagOn: false` is the `!tag` of terminology.md —
the same statement in a shape that is queryable without parsing strings.

Nothing is inferred, and that is the point. A thumb on a tagged verdict cannot
be read without also knowing which way round the verdict went, and reading it
from the module's `problemScore` gets the benign tags backwards: agreeing with
`bias:neutral` or `verified-claims` — both of which we assert by scoring *low* —
came out as "that tag is off", the exact opposite of what the user said. Letting
the user name the tag removes the inference and the bug with it.

`problemScore` is still stored beside the edit, so a correction can be weighed
against how sure we were.

### What a thumb records

`thumbsUp` — the click, uninterpreted — for the targets whose output has no tags
to correct. `summary` and `chunker` are entirely thumbs. `chunk` keeps one
alongside its tag editor, because "this shouldn't be a chunk" and "the
boundaries are wrong" are statements about the region that no tag edit can make.

A thumbs down opens that target's preset issues; `module` has no list, because
"does not apply" is now expressed by removing the tag.

## Interaction

### Editing tags

- Every tag we applied is a chip with an **✕**. Clicking it submits
  `tagOn: false` immediately and the chip goes.
- **+** opens a select of the rest of that target's vocabulary. Choosing one
  submits `tagOn: true` and the tag joins the row.
- A removed tag goes straight back into the select, so a mis-click is one click
  to undo — and because the record is keyed on the tag, re-adding corrects that
  same row rather than filing a contradicting second one.
- The **+** is hidden while every tag is already applied, but still present:
  removing the last tag has to leave a way to put it back.
- Vocabularies live in `{module}-tags.ts` per module (terminology.md) and in
  `types/Tag.ts` for the chunk's own tags, reached through
  `registry.tagsForModule()`. A module that grows a tag needs no feedback-side
  change. A tag outside the offered vocabulary is a caller bug, and is rejected
  by both the extension and bn-server rather than stored as an opinion.

### Thumbs

- **Thumbs up** — submits immediately, shows a brief "Thanks!". Done.
- **Thumbs down** — submits immediately too (we never lose the signal if the
  user walks away), then expands a row of **preset issue buttons** for that
  target. Clicking one sends a follow-up that updates the same feedback record.
- **Other…** reveals a short free-text box (capped, ~500 chars) with a Send
  button.
- Thumbs are toggleable: clicking the same thumb again retracts, clicking the
  other one replaces. **Replacing clears the preset issue and note the previous
  thumb collected** — otherwise a 👍 keeps a complaint attached to it and the row
  reads as praise carrying a complaint.
- Presets are single-select for v1. (Multi-select is an easy later change if
  users ask.)

Preset lists are passed into the feedback widget by the caller, so each target
can offer its own vocabulary without touching the widget.

### Preset issues (starting lists)

**summary** — Score too high · Score too low · Summary is inaccurate · Missed
the main problem · Wrong topic · Other…

**chunker** — Missed content on the page · Split one article into pieces ·
Merged separate items · Picked up nav/ads/comments as content · Other…

**chunk** — This shouldn't be a chunk · Boundaries are wrong (too much / too
little) · Wrong title · Other…

**module** — none. Tag editing covers it, and "Wrong tag" is gone from `chunk`
for the same reason: the tags are editable in place, which says *which* one.

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

The POST is an **upsert on a `localId` the client derives** from the statement
being made and who is making it — user, target, module, the chunk fingerprint (or
the page url, for `chunker`), and **the tag**. That does three jobs: a preset
issue lands on the row its thumb created; the offline queue is keyed the same
way, so a follow-up made with no connection replaces the queued thumb instead of
adding to it; and saying the same thing again after a reload **corrects the
earlier record instead of filing a second opinion against it**, which is what
keeps aggregate counts honest.

The tag is in the key because each tag is its own statement. Removing `clickbait`
and adding `urgency` on one module are two independent corrections, not one
overwriting the other — while re-adding a tag you removed *is* the same
statement, so it updates that row. A thumb (no tag) and a tag edit on the same
chunk are likewise different statements.

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
its failure). Encode target + tag edit into the comment string so the AIQA UI shows
something useful, e.g. `module:clickUnbait — !clickbait`, using the `!tag` form
from terminology.md. A tag edit leaves the AIQA thumb neutral, since its verdict
is the tag, not a thumb.
In practice this mirror fires mostly for internal and Developer Mode users, who
are the ones reading traces anyway.

Note: `bn-server/specs/bn-server-stack.md` says ElasticSearch holds chunks and
feedback. Feedback stays in PostgreSQL for now; that spec is the one to
reconcile.

### Data sent

`FeedbackSubmission` (`src/types/Feedback.ts`). Every record is **either** a
thumb **or** a tag edit; bn-server rejects one that is neither.

- `target`: `summary` | `module` | `chunker` | `chunk`
- `tag`, `tagOn`: a tag edit — `module` and `chunk`
- `thumbsUp`: a thumb — `summary`, `chunker`, `chunk`. `retracted`: withdrawn,
  record kept
- `issueId`, `issueLabel`: preset chosen on thumbs down (optional)
- `traceId`, `spanId` (optional)
- `moduleId` only for `target: module` (legacy `aspectType` accepted by server normalize)
- `pageUrl` for every target, so any row can be traced back to the page it was
  given on; for `chunker` it is the subject rather than context, alongside the
  chunk count and with no chunk fingerprint

A follow-up preset or note updates the record the thumb created, so one thumbs
down is one row, not two.

`applies` was the earlier form of `thumbsUp`, and `target: aspect` /
`aspectType` the earlier form of `module` / `moduleId`. bn-server normalizes
both from a tab left open across an update (`normalizeBody`). Such a payload is
a thumb on `module`, which no longer has one, so it is the one exemption from
"module feedback is a tag edit" — dropping it would lose real feedback and there
is no tag to translate `aspectType` into.

## Out of scope (v1)

- Per-tag **strength** feedback: an edit says a tag is on or off, not that it is
  `low` rather than `high`. Analyzers do not emit strengths yet either.
- Feedback on a module's explanation or quoted text. Tag editing replaced the
  `module` preset list, and "Explanation is wrong" / "Quoted the wrong bit" went
  with it. Worth re-adding somewhere if people ask for it.
- Multi-select issues, per-statement feedback, feedback from the Popup.
- Reading aggregates back (agreement counts on a chunk).
- Letting users edit a chunk boundary by hand.

## Open questions

- Should Developer Mode also absorb "Show chunk overlay", or does that stay a
  separate toggle? (Overlay is genuinely useful to curious non-developers.)
- The `+` select offers a module's whole vocabulary, which for Defuse Ragebait
  is nine tags and growing. At some point that wants grouping or a filter.
- Nothing yet reads these corrections back: no aggregates, and no export to an
  AIQA dataset.

## Where the code lives

- `features/{module}/{module}-tags.ts` — each module's tag vocabulary, reached
  through `features/registry.ts` `tagsForModule()`
- `types/Tag.ts` — `TagSpec`, and the chunk's own tag vocabulary
- `feedback/feedback-issues.ts` — the preset lists, for the thumb targets
- `feedback/feedback-client.ts` — payload, validation per target, `editableTags()`,
  the derived `localId`, offline queue
- `content/content-analysis-modal.ts` — `renderTagEditor()` and
  `renderFeedbackWidget()`, and their placements
- `background/feedback-manager.ts` — POST to bn-server, then the AIQA mirror
- `tracing/aiqa-tracer.ts` — `mirrorFeedbackToAiqa()`, span ids for linking
- `settings/migrate-settings.ts` — `consoleLogging` → `developerMode`
