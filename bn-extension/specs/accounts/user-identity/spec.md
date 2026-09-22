# User identity and optional accounts

## Overview

**The extension never requires an account.** It works fully on first install with no sign-up,
no email, and no server contact. That is a product position, not just a default: a tool that
argues for the user's interests should not open by asking who they are.

So identity has two separate layers:

- **A local id** — a random UUID created on first use and kept in the browser. This is the
  identity everything is keyed on. It is anonymous and per-browser-profile.
- **An optional account** — the user can sign in (Auth0), which attaches a *verified* email
  to their local id so several devices are recognised as one person. Purely additive: the
  extension never asks, and nothing in it stops working without an account.

The one place an account is required is the webapp, which is read-only and separate — see
[feedback-viewer](../../../../bn-webapp/specs/feedback/feedback-viewer/spec.md). Giving
feedback stays anonymous; only going back to *look* at it needs an account.

## Status

MVP. Feedback is keyed on the local id, the email is a label only, and linking works via a
one-time code. The link control and the linked-account status are in both the popup and the
options page (`src/accounts/`), tested in `test/account-link.test.ts`.

Auth0 tenant `better-net.eu.auth0.com`, with the webapp's SPA application created. Still not
exercised end to end against it: the `BetterNet Server API` resource server does not exist
yet, so no JWT can be issued that bn-server will accept — see the build plan.

## Relevant links

- `bn-extension/src/feedback/feedback-client.ts` — `getOrCreateDeviceId`, `peekDeviceId`, `feedbackLocalId`
- `bn-extension/src/accounts/account-link-view.ts` — the wording for each link state
- `bn-extension/src/accounts/account-link-ui.ts` — the control, shared by the popup and options
- `bn-extension/src/options/options.ts` — the Account section where the email is entered
- [feedback-read-api](../../../../bn-server/specs/feedback/feedback-read-api/spec.md) — the
  first consumer: JWT auth, and the link-code endpoints
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

**Where linking is offered.** Two places, both optional and neither a nag: the foot of the
page popup, and Options → Account. Each shows one of:

- not linked → a *Link this browser to an account* button, and a line saying it is not needed
- linked → *This browser is linked to sam@example.com*, plus *Link to a different account*,
  because re-linking is how a device moves and there is no separate unlink
- the server unreachable → the button, and **no** status line. Silence beats guessing "not
  linked", which would be wrong for a linked browser that happens to be offline.

The status comes from `POST /api/account/device-status`, authorised by possession of the local
id like `/link-code`. A browser with no local id yet is unlinked by definition, and is answered
without a server call — asking about your status must not be what creates an identity.

**Optionally signing in, to see or link feedback**

1. Popup → *Link this browser*, or Options → Account → **View my feedback**
2. The extension asks bn-server for a short-lived, single-use link code
3. The webapp opens, the user signs in with Auth0 (Auth0 supplies the verified email, so the
   extension never has to verify one itself)
4. The webapp posts the code with its JWT; the server links this local id to that account
5. On a second device, repeat: a second local id joins the same account, and "my feedback"
   then covers both. Each row is still owned by the local id that wrote it.

The **local id itself never leaves the extension** — the code stands in for it, which is why
the code is single-use and short-lived.

**A device belongs to at most one account, and linking again moves it.** That is the whole
story for a mis-link — signing in to the wrong account, or linking a borrowed computer — so
there is no separate unlink to build. Moving a device never touches its feedback: the rows
stay owned by the local id, and simply appear under whichever account holds it now.

Removing feedback altogether is a different, explicit action, deliberately not folded in
here. See Out of scope.

## Must-nots

- **The email must never be the identity.** It is guessable and, today, unverified: anyone
  could type someone else's address. Access is granted by the local id (or a token derived
  from it), never by a claimed email.
- **An unverified email must not link anything.** Linking on a self-typed address would merge
  your data into a stranger's account, or theirs into yours. Linking is authorised by the
  link code plus an Auth0 JWT, never by a claimed address.
- **Signing in must never become a condition of using the extension**, including as a nag.
- **Changing the email must not orphan past feedback.** `feedbackLocalId` currently hashes
  `userId`, which is the email when one is set — so setting an email silently changes the key
  and re-rating the same chunk writes a second row. Deriving it from the local id instead
  fixes this and is a prerequisite for the read API.

## Out of scope

- Passwords and social login (see the staff login question in feedback-read-api)
- Syncing settings or analysis history across devices — this is about identity only
- Any server-side profile beyond `email` and the linked local ids
- Deleting feedback — now its own slice, [delete-my-data](../delete-my-data/spec.md). It is
  also the real answer to "stop associating this browser with me", which is why there is no
  unlink here.
- Account deletion (removing the Auth0 account itself) and data export.

## Build plan

1. Derive `feedbackLocalId` from the local id rather than `userId`, and send the local id as
   the owner on every submission. status: MVP
2. Keep `accountEmail` as an unverified label only — make sure nothing authorises on it. status: MVP
3. Request a link code and open the webapp, from the options page Account section. status: MVP
4. Show whether this device is linked, and to which account, in both the options page and the
   popup, with a Link button when it is not. status: MVP
5. Auth0 tenant `better-net.eu.auth0.com`: SPA application created. **Blocked**: the
   `BetterNet Server API` resource server (audience `https://server.better-net.com/api`) and
   the post-login Action that adds the email claim are not created — the Auth0 MCP token
   holds no `create:resource_servers` or `create:actions` scope. Until then Auth0 issues no
   JWT bn-server will accept, so linking cannot be completed against the real tenant.
   status: blocked

Step 1 is the prerequisite for the feedback read API. Steps 3-4 are what the user actually
touches; the account itself lives in Auth0, so there is nothing to *build* for that here —
only the tenant configuration in step 5.

## Test plan

- The local id is created once and is stable across restarts; a second call returns the same id
- It is a v4 UUID, so it is not derived from anything about the user
- Feedback written before and after an email is set shares one `localId` for the same chunk,
  i.e. the second rating updates rather than inserting
- A link request with no JWT is rejected, and a self-typed `accountEmail` grants nothing
- A link code is single-use and short-lived
- Two local ids linked to one account both appear in "my feedback"
- Linking a device that already belongs to account A to account B moves it: its feedback then
  appears under B and no longer under A, and no rows are lost either way
- The extension works end to end with no account: analysis, feedback submission, and queue
  flush all succeed signed out
- A status check on a browser with no local id returns "not linked" without creating one
- An unreachable server shows no status at all, rather than "not linked"
- The linked status names the account, and follows a re-link to the new one
