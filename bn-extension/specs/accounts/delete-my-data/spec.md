# Delete my data

## Overview

A **Delete my feedback** button in the options page, behind one confirmation, that permanently
deletes the feedback this browser has sent to bn-server.

Scope is deliberately *this browser*, because that is what the extension can prove it owns:
the local id is its credential, and the extension is never signed in (see
[user-identity](../user-identity/spec.md)). Account-wide deletion across linked devices
belongs in the webapp, where the user has a JWT — noted in Out of scope.

So the wording has to say what it does: "the feedback sent from this browser", not "all my
data". A button that overpromises on deletion is worse than one with a narrow scope.

## Status

draft.

## Relevant links

- [user-identity](../user-identity/spec.md) — the local id, and why it is the credential here
- [feedback-read-api](../../../../bn-server/specs/feedback/feedback-read-api/spec.md) — `ownerKey`, and the read side
- `bn-extension/src/options/options.ts` — Account section
- `bn-extension/src/feedback/feedback-client.ts` — `FEEDBACK_QUEUE_KEY`, the local queue that also has to go

## Examples

**Happy path**

1. Options → Account → **Delete my feedback**
2. Confirmation: "Permanently delete the feedback sent from this browser? This cannot be
   undone." with the count, e.g. *12 items*. Cancel is the default action.
3. On confirm, the extension:
   - clears the pending queue in `chrome.storage.local` (see below — this must happen, and
     before or with the request, never after)
   - asks bn-server to delete the rows owned by this local id
4. "Deleted 12 items." The local id stays, so new feedback still works and still upserts
   normally.

**Server side**

```
POST /api/feedback/delete-mine   { localId: "9f3ab2…" }
-> 200 { deleted: 12 }
```

Authorised by possession of the local id, the same credential as
`POST /api/account/link-code`. A hard delete: the rows go, including the free-text `message`,
which is the part most likely to contain something personal.

The `chunk` and `page` rows that feedback created are **not** deleted — they describe a public
web page, not the user — and nothing links them back to the submitter once the feedback row is
gone.

**Offline**: if the request fails, say so and change nothing server-side. The queue has already
been cleared, which is the safe direction: worst case some unsent feedback is dropped, which is
what the user asked for anyway.

## Must-nots

- **The pending queue must be cleared too.** `bnFeedbackQueue` holds feedback that has not
  reached the server, and the flush alarm runs every 30 minutes — so deleting server-side
  while leaving the queue would silently re-create the data minutes later. This is the easiest
  thing to get wrong here.
- **No deletion without the confirmation step**, and the destructive option must not be the
  default focus.
- **Do not claim more than is deleted** (see the AIQA note in Out of scope).

## Out of scope

- **Account-wide deletion** across every linked device. Needs the webapp and a JWT; this
  button can only speak for the browser it is in.
- **Export my data.** The natural sibling, and the webapp already shows the same rows, so this
  is lower priority than it looks.
- **The AIQA trace copy.** Feedback is mirrored onto the AIQA trace for the trace view
  (`mirrorFeedbackToAiqa` in `background/feedback-manager.ts`), and deleting from bn-server
  does not touch it. Until that is handled, deletion is not complete in the sense a user would
  assume — so the UI must not say "everywhere", and this should get its own slice.
- Rotating the local id on delete. Not needed: the rows it owned are gone, so there is nothing
  left to correlate.
- Deleting analysis caches or chunk/page rows — not user data.

## Build plan

1. `POST /api/feedback/delete-mine`: hard-delete rows by `ownerKey`, return the count.
   Depends on `ownerKey` existing on writes (step 1 of user-identity). status: planning
2. A count for the confirmation dialog — either a field on the delete response used
   afterwards, or a small count endpoint if the dialog should show it before confirming. status: planning
3. Options page: button, confirmation dialog, result and error states. status: planning
4. Clear `bnFeedbackQueue` as part of the same action. status: planning

## Test plan

- Confirming deletes only this local id's rows; a second local id's feedback is untouched
- Cancelling deletes nothing, server-side or locally
- The pending queue is empty afterwards, and a flush triggered right after a delete sends
  nothing — the regression that would otherwise resurrect deleted feedback
- A failed request reports the failure and leaves server rows intact
- Feedback given *after* a delete works and upserts normally on the same `localId`
- `chunk` and `page` rows survive a delete
- Deleting with nothing to delete reports 0 rather than erroring
