# Sample pages for the chunking tests

Real pages, saved as rendered HTML, plus what we expect the chunker to make of them.
`test/chunking-pages.test.ts` runs over every `*.html` here that has a matching
`*.expected.json`.

These are the honest fixtures. The older `test-data/*.chunking.json` files generate their
own HTML (`scripts/build-fixture-html.js`) from the expected chunks, so the page structure
that caused the bug — nav, tickers, teaser lists, screen-reader spans — is exactly what is
missing from them. Prefer adding pages here.

## Adding a page

```
node scripts/capture-page.js https://www.bbc.co.uk/            # fetch + save + strip
node scripts/capture-page.js --file ~/Downloads/saved.html x.com-post   # clean a hand-saved page
```

Scripts, SVG and preloads are stripped (about half the bytes, and the chunker never reads
them). Stylesheets are kept: hidden-element checks depend on them.

### Pages that block automation

x.com, Facebook and other logged-in pages cannot be fetched headlessly. Save them from your
own browser: open devtools on the page and run

```js
(() => {
  const blob = new Blob(['<!DOCTYPE html>\n' + document.documentElement.outerHTML], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'page.html';
  a.click();
})()
```

then `node scripts/capture-page.js --file ~/Downloads/page.html x.com-post`.

A page saved while BetterNet is enabled contains BetterNet's own nutrient labels. That is
kept on purpose: it is exactly the DOM a re-analysis sees after an SPA navigation, and
`x.com-post.expected.json` asserts the badge text (`Safe ×`) never comes back as page
content.

Whichever way you save it, **run it through `capture-page.js`**. A page pasted straight out
of the browser still carries the site's own `<script>` tags: load it and the site's router
boots, wipes the saved markup and navigates away, so the page chunks to nothing for reasons
that have nothing to do with the chunker. `test/chunking-pages.test.ts` fails with that
instruction if a page still has scripts in it.

Use "copy the DOM" rather than *Save Page As*: Save Page As rewrites markup and pulls in
resources, so it no longer matches what the content script sees. **Check the saved HTML for
anything private** — a logged-in capture carries your handle, your feed and sometimes
tokens; prefer a logged-out or throwaway account, and skim the file before committing.

## Expectations

`<name>.expected.json`:

```json
{
  "url": "https://www.bbc.co.uk/",
  "note": "Homepage: teaser lists, no main article.",
  "chunks": { "min": 20, "max": 50 },
  "mustChunk": ["Mel Stride and Priti Patel replaced in major Tory reshuffle"],
  "mustNotAppear": ["Attribution", "Image source,"],
  "primaryChunk": { "contains": "economic inactivity crisis", "minLength": 2000 }
}
```

- `mustChunk` — each string must appear in some chunk's text (the stories we must not miss).
- `mustNotAppear` — strings that must appear in *no* chunk (screen-reader boilerplate,
  cookie banners, nav furniture).
- `primaryChunk` — for article pages: the whole story must arrive as one chunk.
- `chunks.min` / `chunks.max` — coarse guard against the chunker collapsing or exploding.

Every page also gets the invariants in the test itself (no chunk repeating its own text, no
empty chunks, every xpath resolving), so those need no configuration.

## Legacy fixtures (`test-data/*.chunking.json`)

Still useful, and now green: `scripts/build-fixture-html.js` puts each chunk back inside the
element it was recorded from (`metadata.elementType`), which it used to drop — that is why
`bbc.co.uk-news.1` had no `<article>` and failed. They remain synthetic, though: only the
recorded chunks exist, so page furniture is absent. New coverage belongs here in `pages/`.
