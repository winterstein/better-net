# Feedback viewer

## Overview

Two read-only views on the feedback people give in the extension:

- **My feedback** — what I have corrected, reached from the extension options page.
- **All feedback** — staff only, with submitters shown as stable pseudonyms and no emails.

**The whole webapp requires sign-in**, via Auth0. That is the opposite of the extension, which
never asks for an account — so the first visit has a step the extension does not: linking this
browser's local id to the account, or there is nothing to show. See
[user-identity](../../../../bn-extension/specs/accounts/user-identity/spec.md).

Served from `app.better-net.com`. The Auth0 JWT travels as a Bearer header rather than a
cookie, so the API's CORS config needs no change (`server.better-net.com.nginx` reflects the
origin with credentials deliberately off).

## Status

MVP. Both views built and tested (`bn-webapp/test/feedback-viewer.test.ts`). Live at
`https://app.better-net.com` with Auth0 and deploy workflow in place. Remaining gap: confirm
a signed-in API call end to end (see `status.md`).

## Relevant links

- [feedback-read-api](../../../../bn-server/specs/feedback/feedback-read-api/spec.md) — endpoints, tokens, pseudonyms
- [user-identity](../../../../bn-extension/specs/accounts/user-identity/spec.md) — what "my" means
- `bn-webapp/src/services/api.ts` — the existing API client this extends
- `bn-extension/src/options/options.ts` — where the link is added

## Examples

**First visit, from the extension**

1. Options → Account → **View my feedback**
2. The extension asks bn-server for a short-lived link code and opens
   `https://app.better-net.com/feedback#link=K7QP-2F`
3. Auth0 sign-in (or sign-up — this may be the first time the user has an account at all)
4. The webapp posts the code with its JWT, which links this browser's local id to the account,
   then strips the code from the URL so it is not left in history
5. The list renders, newest first: what was rated (chunk title and url), the correction
   ("clickbait removed", "thumbs down"), any note, and when

The code is in the URL **fragment**, not the query string: a fragment is never sent to the
server, so it stays out of nginx access logs and `Referer` headers.

The catch, and the reason step 4 above is not simply "read the fragment": signing in is a
full-page redirect to Auth0 and back, and **the fragment does not survive it**. Arriving from
the extension is exactly the case that also has to sign in, so the code is stashed in
`sessionStorage` at startup (`main.tsx`, before React renders) and taken from there after
sign-in. Read it off the URL at redeem time instead and a first visit always ends on "no
browsers linked" — for a user who has just linked one.

Sign-in also carries `appState.returnTo`, because Auth0 only ever returns to the origin: one
callback URL per environment, so `/feedback` has to be navigated back to afterwards.

**Later visits** are just sign-in — no code, because the device is already linked.

**A second device**: repeat the same flow there; both devices' feedback then appears together.

**States that need real wording, not a blank page**

- Signed in, nothing linked → "No devices linked yet — open *View my feedback* from the
  extension options page on the browser you give feedback in." Distinct from having linked a
  device and genuinely having no feedback.
- Linked, no feedback → "No feedback yet", plus a line saying it comes from the Content
  Analysis modal.
- Expired or already-used code → "That link has expired — open it again from the extension."
  Sign-in survives; only the linking step is retried.

**Staff view**

1. `/staff/feedback`, same sign-in
2. A table: submitter pseudonym, target and module, the correction, chunk url and title, when
3. Filter by target, module and tag; paginate
4. No email appears, because the API does not send one — nothing is hidden client-side
5. Signed in but not staff → a clear "not available", never an empty table that looks like
   "no feedback exists"

## Out of scope

- Editing, deleting or replying to feedback
- Charts, aggregate quality scores, export for training
- Showing a user their feedback inside the extension itself
- Acting on feedback (re-running analysis, changing tags)

## Build plan

1. `app.better-net.com`: nginx vhost written and validated; cert and deploy still to do. status: planning
2. Auth0 SPA sign-in, and `api.ts` sending the JWT as a Bearer header. status: MVP
   (application created; blocked on the API/audience before a usable JWT is issued)
3. Link step: read `#link=` from the fragment, post it after sign-in, strip the URL. status: MVP
4. `/feedback` page and the three empty/expired states above. status: MVP
5. **View my feedback** button in the extension options page (Account section): request a link
   code, open the webapp. status: MVP
6. `/staff/feedback` with filters and pagination. status: MVP (target filter and a page limit;
   no paging controls yet)

Step 5 is the only change outside bn-webapp.

## Infra notes

- The cert must exist **before** the vhost is enabled. nginx config load is atomic across the
  whole host, so a missing cert file takes every other site on that box down with it — see the
  comments in `bn-server/server.better-net.com.nginx`.
- The webapp is static, so Cloudflare proxying is fine for it. The browser talks to
  `server.better-net.com` directly, which stays DNS-only for the reasons in that file.

## Test plan

- Not signed in → the sign-in prompt, on both routes; no view renders without a JWT
- The link code is taken from the fragment, posted once, and gone from the URL afterwards
- It survives the sign-in redirect, which drops the fragment, and is used only once
- Storage being unavailable (private mode) does not throw or break the signed-in path
- An expired or reused code shows the re-open message while the user stays signed in
- The three states are distinguishable: nothing linked, linked-but-empty, and has feedback
- "My feedback" shows only this account's linked rows — fixture with two local ids
- The staff table renders no email anywhere: assert against the rendered output
- A non-staff user hitting `/staff/feedback` sees the not-available state, never a partial table
- Empty state renders when there is no feedback
