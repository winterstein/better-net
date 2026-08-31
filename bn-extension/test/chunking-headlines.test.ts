/**
 * Headline chunker tests: the teaser links around an article (ticker, sidebar, related
 * posts) are shorter than minTextLength, so the main chunker dropped them and a fake
 * headline next to the story was never labelled.
 *
 * Two different site shapes, because this has to work beyond the one theme it was written
 * against.
 */

import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const WORDPRESS_NEWS = `<!DOCTYPE html><html><body>
  <nav class="menu"><ul>
    <li><a href="/category/news/">News and politics from around the world</a></li>
  </ul></nav>
  <div class="ticker"><ul>
    <li class="ticker-item"><a href="/denzel-washington-nypd-covered-up/"
        title="Denzel Washington: NYPD Covered-Up Taylor Swift Satanic Sacrifices Involving Missing Kids">
        <span class="date">[ August 30, 2026 ]</span>
        <span class="title">Denzel Washington: NYPD Covered-Up Taylor Swift Satanic Sacrifices Involving Missing Kids</span>
        <span class="cat">News</span></a></li>
  </ul></div>
  <main>
    <article id="post-238066">
      <h1 class="entry-title">Study: Bill Gates Lab Grown Meat Causes Cancer in Humans</h1>
      <div class="entry-content">
        <p>Bill Gates lab-grown meat causes cancer in humans who consume it, according to a disturbing new study.
        Synthetic meat has been heavily promoted by Bill Gates and the globalist elites at the WEF as the solution
        to so-called climate change. However, this same food has now been
        <a href="/why-fake-meat-companies-use-immortalized-cell-lines/">shown to cause cancer via the immortalized cell lines</a>
        used to manufacture it, and the long-term safety data does not yet exist.</p>
      </div>
      <div class="author-box">
        <a href="https://www.facebook.com/SeanAdlTabatabai/" title="Follow Sean Adl-Tabatabai on Facebook">Facebook</a>
      </div>
    </article>
  </main>
  <aside class="sidebar">
    <div class="widget"><h4><a href="/radical-democrats-confiscate-your-gold/">Radical Democrats Want to Confiscate Your Gold For Equity With a Peanuts Payout</a></h4></div>
  </aside>
</body></html>`;

const OTHER_NEWSROOM = `<!DOCTYPE html><html><body>
  <main>
    <h1>Council votes through the new transport plan</h1>
    <p>${'The council met on Tuesday to discuss the plan in detail. '.repeat(4)}</p>
  </main>
  <section class="most-read">
    <div class="promo"><a href="/news/uk-politics-12345">Chancellor signals tax rises in the autumn budget</a></div>
    <div class="promo"><a href="/news/health-67890">Hospital waiting lists fall for the third month running</a></div>
  </section>
</body></html>`;

async function chunk(html: string, url: string) {
  const w = new Window({ url });
  (globalThis as any).window = w as any;
  (globalThis as any).document = w.document as any;
  (globalThis as any).DOMParser = (w as any).DOMParser;
  (globalThis as any).Node = (w as any).Node;
  (globalThis as any).NodeFilter = (w as any).NodeFilter;
  w.document.write(html);
  const { extractChunks } = await import('../src/chunking/chunking.js');
  return extractChunks(w.document as any, url, {});
}

const chunks = await chunk(WORDPRESS_NEWS, 'https://thepeoplesvoice.tv/study-bill-gates-lab-grown-meat-causes-cancer-in-humans/');
const headlines = chunks.filter((c) => c.metadata?.headline);
const bodies = chunks.filter((c) => !c.metadata?.headline);
const has = (list, text) => list.some((c) => c.text.includes(text));

// The story itself still comes from the main chunker
assert.ok(has(bodies, 'lab-grown meat causes cancer in humans'), 'main article chunk');

// Side headlines are picked up, from the ticker and from the sidebar
assert.ok(has(headlines, 'Denzel Washington'), 'ticker headline');
assert.ok(has(headlines, 'Radical Democrats'), 'sidebar headline');
for (const headline of headlines) {
  assert.ok(headline.xpath, 'headline chunks need an xpath to hang a label on');
  assert.ok(headline.tags.includes('article'), 'headlines are article teasers');
}
assert.ok(
  headlines.find((c) => c.text.includes('Radical Democrats')).tags.includes('sidebar'),
  'sidebar teasers are tagged sidebar'
);

// Furniture and duplicates stay out
assert.ok(!has(headlines, 'News and politics from around the world'), 'nav menu link excluded');
assert.ok(!has(headlines, 'Follow Sean Adl-Tabatabai'), 'off-site follow/share link excluded');
assert.ok(!has(headlines, 'immortalized cell lines'), 'a link inside the article is not chunked twice');

// A candidate we throw away (hidden here, a rotating ticker item in the wild) must not
// block the copy of the same headline elsewhere on the page.
const REPEATED = `<!DOCTYPE html><html><body>
  <main><h1>Something else entirely</h1><p>${'Filler copy for the main story. '.repeat(6)}</p></main>
  <div style="display:none;visibility:hidden"><a href="/denzel-washington-nypd-covered-up/">Denzel Washington: NYPD Covered-Up Satanic Sacrifices Involving Missing Kids</a></div>
  <aside><div class="widget"><h4>Denzel Washington: NYPD Covered-Up Satanic Sacrifices Involving Missing Kids</h4></div></aside>
</body></html>`;
const repeated = await chunk(REPEATED, 'https://example-news.test/story');
const denzels = repeated.filter((c) => c.text.includes('Denzel Washington'));
assert.equal(denzels.length, 1, 'the visible copy is chunked, once');
assert.ok(denzels[0].metadata?.headline && denzels[0].tags.includes('sidebar'), 'and it is the sidebar copy');

// A different newsroom's markup, with no title attributes and no theme classes
const other = await chunk(OTHER_NEWSROOM, 'https://example-news.test/news/transport-plan');
const otherHeadlines = other.filter((c) => c.metadata?.headline);
assert.equal(otherHeadlines.length, 2, 'both promos found on a plain markup site');
assert.ok(has(otherHeadlines, 'Chancellor signals tax rises'));
assert.ok(has(other.filter((c) => !c.metadata?.headline), 'council met on Tuesday'), 'main story still chunked');

console.log('✅ headline chunker tests passed');
