
Goal:
Users can share analysis of web pages from suitable websites - especially newspapers and blogs.
This should give fast, efficient, and potentially better analysis.

Analysis updates are sent by extensions that opt-in.
Updates include page -> chunk splits, and chunk-level analysis.

The extension can request cached analysis for the page it is on.

If the server has analysis from several models, then it picks the best model.

When storing, the server avoids storing duplicates.

Open question: How to defend against a malicious user sending false analysis?
This is not considered a blocker for now.

Open question: How to keep the data anonymous, but be able to remove data from a bad-actor?

Suitable websites:
Sharing applies unless the site, page, or chunk is excluded. Type names are from bn-extension `types/Classification.ts`.
 - Site types excluded: adult
 - Page types excluded: listing, search_results, checkout, form, login, profile, media, app, error
 - Chunk types excluded: sidebar, form, paywall, modal, cookie_banner, chrome, boilerplate
 - A server-managed global allow-list of sites that are definitely good for shared analysis, and a block-list of sites that are definitely unsuitable. Both will evolve over time.
 - Social: twitter.com / x.com is included, but not direct messages. facebook.com is excluded.
 - A simple check sets site type adult (page rating label, adult top-level domains).
 - Private: a `private` tag can be applied to a page or a chunk. Private content is never shared, is not sent to AIQA traces, and has feedback disabled.
   By default it is analysed by local models only. An option on the AI Model settings page lets it use the active model instead (which may be remote, e.g. OpenAI).

Privacy:
The server does not store chunk text - only chunk keys (hashes), analysis results, and page urls.

Status: MVP - see [build-plan.md](./build-plan.md) for what is built, the choices made, and what is left.
