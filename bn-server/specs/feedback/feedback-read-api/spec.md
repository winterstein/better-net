# Feedback read API

## Overview

Feedback is write-only today. This adds reads, for two kinds of caller:

- **A signed-in user** reads their own feedback.
- **Staff** read everyone's, with the submitter's email never leaving the server.

Both authenticate the same way — an Auth0-issued JWT as a Bearer header — and are told apart
by `users.isStaff`. Writing feedback stays anonymous and unauthenticated; only *reading* it
needs an account.

Consumed by bn-webapp — see [feedback-viewer](../../../../bn-webapp/specs/feedback/feedback-viewer/spec.md).

## Status

draft.

## Relevant links

- [user-identity](../../../../bn-extension/specs/accounts/user-identity/spec.md) — the local id, and linking it to an account
- [extension-server-feedback.md](../../../../bn-extension/specs/extension-server-feedback.md) — the write side and the `FeedbackSubmission` shape
- `bn-server/src/routes/feedback.ts` — where POST lives
- Auth0 tenant `winterstein.eu.auth0.com` (already used by AIQA on the same host); `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` exist in the GitHub `prod` environment

## Auth

- The webapp signs in against Auth0 (SPA + PKCE) and sends `Authorization: Bearer <jwt>`.
- bn-server verifies RS256 against the tenant JWKS and checks `iss` and `aud`. No session
  cookie, which is why the API's CORS config needs no change — credentials stay off.
- Identity is the **`sub` claim**, not the email: Auth0 emails can change, `sub` cannot. The
  `users` row is keyed on `sub` and carries `email` and `isStaff`.
- A first sign-in creates the `users` row with `isStaff` false. Staff is set in the database,
  deliberately not self-serve.

## The owner key — read this first

Feedback is owned by the extension's **local id**, never by an email. The reasoning, and the
`localId` bug that comes from keying on a changeable email, are in
[user-identity](../../../../bn-extension/specs/accounts/user-identity/spec.md).

For this API: every row carries an `ownerKey` (the local id), it is unguessable, and no
endpoint ever returns it. "My feedback" therefore means *rows whose `ownerKey` is linked to
my account* — so a user who has never linked a device sees an empty list, which the webapp
has to explain rather than present as "you have given no feedback".

Rows written before `ownerKey` exists have none: visible to staff, absent from "my feedback".
Acceptable, since bn-server has not held real traffic yet.

## Examples

**Link a device to the signed-in account.** The extension mints a short-lived single-use code,
so the long-lived local id never reaches the webapp:

```
POST /api/account/link-code   { localId: "9f3ab2…" }        (from the extension, no JWT)
-> 200 { code: "K7QP-2F", expires: "…+10min" }

POST /api/account/link        { code: "K7QP-2F" }           (from the webapp, with JWT)
-> 200 { linkedDevices: 2 }
-> 410 code expired or already used
```

**Own feedback** — their own data, so nothing is redacted. Newest first, paginated.

```
GET /api/feedback/mine        (JWT)
-> 200 { rows: [ { localId, target, moduleId, tag, tagOn, thumbsUp, message,
                   chunkUrl, chunkTitle, problemScore, created, updated } ], total }
-> 200 { rows: [], total: 0, linkedDevices: 0 }   nothing linked yet — not an error
-> 401 missing, expired or invalid JWT
```

**All feedback** — staff only.

```
GET /api/feedback/all?target=module&moduleId=clickUnbait&page=0     (JWT, isStaff)
-> 200 { rows: [ { submitter: "u_9f3ab2", target, tag, tagOn, message, chunkUrl, … } ], total }
-> 403 signed in but not staff
```

`submitter` is `HMAC(ownerKey, BN_PSEUDONYM_SECRET)`, truncated. Stable, so staff can see that
40 corrections came from one person without learning who. The response carries no email, no
`ownerKey` and no raw `userId` — redaction is server-side, not a hidden column in the UI.

## Out of scope

- Aggregate scores per chunk/module, and export for model training (already future work in
  extension-server-feedback.md)
- Editing feedback. **Deleting** it needs its own slice: "show me my data" invites "now delete
  it", and that has to cover unlinked devices too.
- Auth for the rest of the API. `GET /api/chunk` and `GET /api/page` currently list everything
  unauthenticated, which caps what a staff-only view actually protects.
- Staff management UI — `isStaff` is set by hand in the database.

## Build plan

1. `ownerKey` on writes: record the local id on every submission, derive `localId` from it. status: planning
2. Auth0 JWT verification middleware (JWKS, `iss`, `aud`) + `users` table (`sub, email, isStaff, created`), row created on first sign-in. status: planning
3. Device linking: `POST /api/account/link-code` and `POST /api/account/link`. status: planning
4. `GET /api/feedback/mine`: rows for the account's linked owner keys, paginated. status: planning
5. `GET /api/feedback/all`: staff only, pseudonymised, filters + pagination. status: planning

## Test plan

- A request with no JWT, an expired one, or one signed by the wrong key → 401; the wrong `aud`
  → 401 (a valid token for another Auth0 API must not work here)
- First sign-in creates a `users` row with `isStaff` false
- `/mine` returns only rows for that account's linked devices; a second account sees none of them
- `/mine` with nothing linked returns an empty list and `linkedDevices: 0`, not an error
- A link code works once, then 410; it also expires
- `/all` → 403 for a non-staff account, 200 once `isStaff` is set
- `/all` response JSON contains no email, `ownerKey` or raw `userId` — assert on the serialised
  body, so a newly added field cannot leak one by accident
- One submitter's rows share a pseudonym; two submitters differ
- Filters and pagination: a known fixture returns the expected subset and total
