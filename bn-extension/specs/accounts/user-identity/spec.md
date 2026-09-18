# User identity and optional accounts

## Overview

**The extension never requires an account.** It works fully on first install with no sign-up,
no email, and no server contact. That is a product position, not just a default: a tool that
argues for the user's interests should not open by asking who they are.

So identity has two separate layers:

- **A local id** — a random UUID created on first use and kept in the browser. This is the
  identity everything is keyed on. It is anonymous and per-browser-profile.
- **An optional verified email** — a label the user can attach to their local id, so several
  devices can be recognised as the same person. Purely additive; nothing stops working
  without it.

## Status

draft. The local id exists and is in use (`getOrCreateDeviceId`). The email field exists but
is **unverified free text**, which is not yet safe to link accounts with — see Must-nots.

## Relevant links

- `bn-extension/src/feedback/feedback-client.ts` — `getOrCreateDeviceId`, `feedbackLocalId`
- `bn-extension/src/options/options.ts` — the Account section where the email is entered
- [feedback-read-api](../../../../bn-server/specs/feedback/feedback-read-api/spec.md) — the
  first consumer: "my feedback" is defined as feedback owned by my local id
- [extension-server-feedback.md](../../extension-server-feedback.md) — what identity is attached to

## The local id

- A `crypto.randomUUID()` created on first need, stored in `chrome.storage.local` under
  `bnDeviceId`.
- `local`, not `sync`, on purpose: it doubles as a **credential**. Possession of it is what
  proves ownership of your feedback, so it should not roam anywhere we did not put it.
  Being unguessable (122 random bits) is what makes that safe.
- Per browser profile, so the same person on laptop and phone is two local ids until they
  link them with an email.
- Never shown in the UI as something to copy around, and never logged.

## Examples

**No account, which is the common case**

1. Install; give feedback in the Content Analysis modal
2. A local id is created on first submission and sent as the owner of that feedback
3. "View my feedback" in the options page works — it is authorised by the local id, not a login

**Optionally adding an email, to link a second device**

1. Options → Account → enter email → "Verify"
2. The user proves the address (mechanism is the open question in feedback-read-api)
3. The server links this local id to that account
4. On the second device: same email, same verification, second local id linked to the same account
5. "My feedback" now shows both devices' feedback; each row is still owned by the local id that wrote it

**Removing the email** leaves the local id and its feedback intact — unlinking is not deleting.

## Must-nots

- **The email must never be the identity.** It is guessable and, today, unverified: anyone
  could type someone else's address. Access is granted by the local id (or a token derived
  from it), never by a claimed email.
- **An unverified email must not link anything.** Linking on an unverified address would
  merge your data into a stranger's account, or theirs into yours.
- **Changing the email must not orphan past feedback.** `feedbackLocalId` currently hashes
  `userId`, which is the email when one is set — so setting an email silently changes the key
  and re-rating the same chunk writes a second row. Deriving it from the local id instead
  fixes this and is a prerequisite for the read API.

## Out of scope

- Passwords and social login (see the staff login question in feedback-read-api)
- Syncing settings or analysis history across devices — this is about identity only
- Any server-side profile beyond `email` and the linked local ids
- Account deletion / data export. Needed before long, and deliberately its own slice: once
  the user can see their data they will want to remove it.

## Build plan

1. Derive `feedbackLocalId` from the local id rather than `userId`, and send the local id as
   the owner on every submission. status: planning
2. Keep `accountEmail` as an unverified label only — make sure nothing authorises on it. status: planning
3. Email verification + `account -> local ids` linking, server-side. status: planning
4. Options page Account section: verify, show linked-device count, unlink. status: planning

Step 1 is the prerequisite for the feedback read API; steps 3-4 are only needed once someone
actually wants cross-device linking.

## Test plan

- The local id is created once and is stable across restarts; a second call returns the same id
- It is a v4 UUID, so it is not derived from anything about the user
- Feedback written before and after an email is set shares one `localId` for the same chunk,
  i.e. the second rating updates rather than inserting
- An unverified email links nothing: the server rejects a link request for an unproven address
- Two local ids linked to one verified account both appear in "my feedback"; unlinking one
  leaves its feedback owned and readable by that device
