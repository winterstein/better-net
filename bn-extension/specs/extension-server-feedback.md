Specifications for Extension ↔ Server

BetterNet extension talks to `bn-server` for cached analysis, updates, and user-contributed signals. This spec covers **chunk aspect feedback** (v1). Sharing analysis with others comes later.

See also bn-server/specs/bn-server-stack.md

**Feedback UX (what can be rated, preset issues, trace links, Developer Mode) now
lives in `specs/feedback.md`.** This file is the transport + server contract.

## Goals (v1)

- User can give **+ / −** (thumbs up / down) feedback on a specific **chunk** and **aspect** (e.g. “this article chunk **is** / **is not** misleading”).
- Thumbs down feedback may include an **optional short message** (free text, length-capped).
- Extension sends feedback to the server when the user has opted in and a server endpoint is configured (see Settings → Account / Data Sharing).

## User experience

- Entry point: **Content Analysis** modal on a chunk (same place the user already sees aspect results).
- User picks the **aspect** being rated
- **+** = aspect applies to this chunk (e.g. misleading, biased, clickbait).
- **−** = aspect does not apply.
- Optional **message** field (collapsed by default).
- Brief confirmation in UI; failures show a non-blocking error.

Aspect labels map to `AspectType` (`accuracy`, `bias`, `scams`, `toxicity`, `clickbait`) and settings modules (`factChecker`, `biasDetector`, etc.).

## Data sent

Use AspectAnalysis as the basis for data sent / received.

## Server API

```
POST /api/feedback
```

Body: `FeedbackSubmission` (`src/types/Feedback.ts`). Response: `{ id, createdAt }`,
201 on insert and 200 on update.

An upsert on the client's `localId`: the thumb inserts, and the preset issue or note
that follows updates the same row. Chunk-level feedback is linked to the chunk
fingerprint (the chunk row is created if we have not seen it); chunker feedback is
linked to the page instead, so `chunkId` is nullable and there is a `pageId`.
Stored in PostgreSQL, table `feedback`.

Future read APIs (out of scope v1): aggregate scores per chunk/aspect, export for model improvement.

## Extension behaviour

- Gated by **Data Sharing** / account settings (off by default).
- Background worker posts to configured server base URL; content script sends `BN_SUBMIT_FEEDBACK` message.
- Offline or failure: persist to `chrome.storage.local` queue; flush on next successful connection.
- No feedback UI when extension is off for the domain or the feature module is disabled.

## Privacy

- Feedback is **opt-in**.
- v1: anonymous device id or optional BetterNet account id (Settings → Account).