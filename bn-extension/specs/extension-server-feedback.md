Specifications for Extension ↔ Server

BetterNet extension talks to `bn-server` for cached analysis, updates, and user-contributed signals. This spec covers **chunk module feedback** (v1). Sharing analysis with others comes later.

See also bn-server/specs/bn-server-stack.md

**Feedback UX (what can be rated, preset issues, trace links, Developer Mode) now
lives in `specs/feedback.md`.** This file is the transport + server contract.

## Goals (v1)

- User can give **+ / −** (thumbs up / down) feedback on a specific **chunk** and **module** (e.g. “this article chunk **is** / **is not** misleading”). The thumb is stored as `thumbsUp`, and for a module it is also recorded as ground truth — `tag` is on / off for this chunk. See `specs/feedback.md`.
- Thumbs down feedback may include an **optional short message** (free text, length-capped).
- Extension sends feedback to the server when the user has opted in and a server endpoint is configured (see Settings → Account / Data Sharing).

## User experience

- Entry point: **Content Analysis** modal on a chunk (same place the user already sees module results).
- User picks the **module** being rated
- **+** = our verdict on this module is right.
- **−** = our verdict is wrong.

Either way the record carries what the tag actually is, not just whether we got it
right (`specs/feedback.md`, "What a thumb records").
- Optional **message** field (collapsed by default).
- Brief confirmation in UI; failures show a non-blocking error.

Feedback is keyed by settings `moduleId` and a product `tag` from terminology.md
(`clickbait`, `false-claim`, `bias:left`, …).

## Data sent

Use `ModuleAnalysis` / `FeedbackSubmission` as the basis for data sent / received.
Legacy `target: aspect` and `aspectType` are normalized to `module` + `moduleId` on the server.

## Server API

```
POST /api/feedback
```

Body: `FeedbackSubmission` (`src/types/Feedback.ts`). Response: `{ id, createdAt }`,
201 on insert and 200 on update.

An upsert on a `localId` the client derives from what is being rated and who is rating
it: the thumb inserts, the preset issue or note that follows updates the same row, and
so does the same person re-rating the same chunk later. An update merges, so an omitted
field keeps its value and clearing one needs an explicit `null`.

Chunk-level feedback is linked to the chunk fingerprint (the chunk row is created if we
have not seen it); chunker feedback is linked to the page instead, so `chunkId` is
nullable and there is a `pageId`. Every target sends `pageUrl`, so every row can be
traced back to the page it was given on. Stored in PostgreSQL, table `feedback`.

Future read APIs (out of scope v1): aggregate scores per chunk/module, export for model improvement.

## Extension behaviour

- Gated by **Data Sharing** / account settings (off by default).
- Background worker posts to configured server base URL; content script sends `BN_SUBMIT_FEEDBACK` message.
- Offline or failure: persist to `chrome.storage.local` queue; flush on next successful connection.
- No feedback UI when extension is off for the domain or the feature module is disabled.

## Privacy

- Feedback is **opt-in**.
- v1: anonymous device id or optional BetterNet account id (Settings → Account).