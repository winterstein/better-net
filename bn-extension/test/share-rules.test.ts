/**
 * What may be shared, what is private, and which model wins
 * (bn-server/specs/shared-analysis/spec.md): sharing/share-rules.ts, ai/model-info.ts,
 * classify/site-type.ts.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { LOCAL_MODELS } from '../src/ai/model-catalog.js';
import { RANK_NONE, RANK_UNKNOWN, modelRank } from '../src/ai/model-info.js';
import { classifySiteType } from '../src/classify/site-type.js';
import { MIN_CLASSIFICATION_CONFIDENCE } from '../src/types/Classification.js';
import {
  DEFAULT_SITE_LIST,
  SHARE_SKIP_CHUNK_ROLES,
  SHARE_SKIP_PAGE_TYPES,
  isPrivatePage,
  matchSiteList,
  normalizeShareUrl,
  shareChunkBlockReason,
  sharePageBlockReason,
} from '../src/sharing/share-rules.js';

// --- model ranking ---

assert.equal(modelRank(''), RANK_NONE);
assert.equal(modelRank('heuristic'), RANK_NONE);
assert.equal(modelRank('some-model-nobody-listed'), RANK_UNKNOWN);
for (const model of LOCAL_MODELS) {
  assert.ok(modelRank(model.id) > RANK_UNKNOWN, `download ${model.id} has no rank`);
}
// Dated ids and Ollama tags rank as their family.
assert.equal(modelRank('gpt-4o-2024-08-06'), modelRank('gpt-4o'));
assert.equal(modelRank('llama3.2:3b-instruct-q4_K_M'), modelRank('llama3.2'));
assert.equal(modelRank('Claude-Sonnet-4-5'), modelRank('claude-sonnet-4-5'));
// The rough order: download < local via Ollama < small API < API.
assert.ok(modelRank('mobilebert-mnli') < modelRank('flan-t5-base'));
assert.ok(modelRank('flan-t5-base') < modelRank('llama3.2:3b'));
assert.ok(modelRank('llama3.2:3b') < modelRank('mistral'));
assert.ok(modelRank('mistral') < modelRank('gpt-4o-mini'));
assert.ok(modelRank('gpt-4o-mini') < modelRank('gpt-4o'));
assert.ok(modelRank('claude-3-5-haiku-latest') < modelRank('claude-sonnet-4-5'));
assert.ok(modelRank('claude-sonnet-4-5') < modelRank('claude-opus-4-1'));

// --- url normalisation: what reaches the server ---

assert.equal(
  normalizeShareUrl('https://News.Example.com/world/story-1/?utm_source=tw&fbclid=abc#comments'),
  'https://news.example.com/world/story-1'
);
assert.equal(normalizeShareUrl('https://example.com/article.php?id=42&session=zzz'), 'https://example.com/article.php?id=42');
assert.equal(normalizeShareUrl('https://example.com'), 'https://example.com/');
for (const local of ['http://localhost:3000/a', 'http://192.168.1.4/a', 'http://intranet/a', 'https://wiki.internal/a', 'chrome://settings', 'file:///etc/passwd', 'not a url']) {
  assert.equal(normalizeShareUrl(local), null, local);
}

// --- site list ---

assert.equal(matchSiteList('https://x.com/someone/status/1'), 'allow');
assert.equal(matchSiteList('https://twitter.com/someone'), 'allow');
assert.equal(matchSiteList('https://x.com/messages'), 'private');
assert.equal(matchSiteList('https://x.com/messages/123-456'), 'private', 'the path rule beats the domain rule');
assert.equal(matchSiteList('https://x.com/messagesboard'), 'allow', 'a path prefix ends at a segment');
assert.equal(matchSiteList('https://www.facebook.com/groups/1'), 'block');
assert.equal(matchSiteList('https://m.facebook.com/messages/t/1'), 'private');
assert.equal(matchSiteList('https://netflix.com/'), null, 'x.com is not a substring match');
assert.equal(matchSiteList('https://example.com/'), null);
// Equally specific entries: the cautious one wins.
const clash = [{ pattern: 'a.com', kind: 'allow' as const }, { pattern: 'a.com', kind: 'block' as const }];
assert.equal(matchSiteList('https://a.com/', clash), 'block');
assert.equal(matchSiteList('https://a.com/', [...clash].reverse()), 'block');
// A subdomain entry beats its parent.
assert.equal(
  matchSiteList('https://blog.a.com/p', [{ pattern: 'a.com', kind: 'block' }, { pattern: 'blog.a.com', kind: 'allow' }]),
  'allow'
);

// --- page rules ---

const type = <T>(value: T, confidence = 0.9) => ({ value, confidence, source: 'test' });
const page = (extra = {}) => ({ url: 'https://news.example.com/story', ...extra });

assert.equal(sharePageBlockReason(page()), null, 'unknown types pass');
assert.equal(sharePageBlockReason(page({ pageType: type('article') })), null);
assert.equal(sharePageBlockReason(page({ pageType: type('thread') })), null);
for (const pageType of SHARE_SKIP_PAGE_TYPES) {
  assert.equal(sharePageBlockReason(page({ pageType: type(pageType) })), `page:${pageType}`);
}
assert.equal(sharePageBlockReason(page({ pageType: type('login', 0.3) })), null, 'a guess below the gate is unknown');
assert.equal(sharePageBlockReason(page({ siteType: type('adult') })), 'site:adult');
assert.equal(sharePageBlockReason(page({ private: true })), 'private');
assert.equal(sharePageBlockReason({ url: 'http://localhost/a' }), 'url');
assert.equal(sharePageBlockReason({ url: 'https://www.facebook.com/x' }), 'list:block');
assert.equal(sharePageBlockReason({ url: 'https://x.com/messages/1' }), 'list:private');
assert.equal(sharePageBlockReason({ url: 'https://x.com/someone/status/1' }), null);
// Allow overrides the site type, not the page type.
assert.equal(sharePageBlockReason({ url: 'https://x.com/a', siteType: type('adult') }), null);
assert.equal(sharePageBlockReason({ url: 'https://x.com/login', pageType: type('login') }), 'page:login');

assert.equal(isPrivatePage({ url: 'https://mail.google.com/mail/u/0/' }), true);
assert.equal(isPrivatePage({ url: 'https://www.facebook.com/' }), false, 'blocked from sharing is not the same as private');
assert.equal(isPrivatePage({ url: 'https://example.com/', private: true }), true);
assert.ok(DEFAULT_SITE_LIST.length < 40, 'the seed list stays short: it grows on the server');

// --- chunk rules ---

assert.equal(shareChunkBlockReason({ tags: ['chunk-type:article'] }), null);
assert.equal(shareChunkBlockReason({ tags: [] }), null, 'no role is unknown, which passes');
assert.equal(shareChunkBlockReason({ tags: ['chunk-type:post', 'private'] }), 'private');
for (const role of SHARE_SKIP_CHUNK_ROLES) {
  assert.equal(shareChunkBlockReason({ tags: [`chunk-type:${role}`] }), `role:${role}`);
}

// --- adult site check ---

const site = (html: string, url = 'https://example.com/') => classifySiteType(new JSDOM(html, { url }).window.document, url);

for (const head of [
  '<meta name="rating" content="adult">',
  '<meta name="RATING" content="RTA-5042-1996-1400-1577-RTA">',
  '<meta name="rating" content="Mature">',
]) {
  const answer = site(`<html><head>${head}</head><body></body></html>`);
  assert.equal(answer.value, 'adult', head);
  assert.ok(answer.confidence >= MIN_CLASSIFICATION_CONFIDENCE);
}
assert.equal(site('<html><body></body></html>', 'https://something.xxx/').value, 'adult');
assert.equal(site('<html><head><meta name="rating" content="general"></head></html>').value, 'unknown');
assert.equal(site('<html><body><p>News about adult education.</p></body></html>', 'https://news.example.com/').value, 'unknown');
assert.equal(classifySiteType(null, 'nonsense').value, 'unknown');

console.log('share-rules tests OK');
