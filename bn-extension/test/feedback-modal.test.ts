/**
 * Feedback widgets in the Content Analysis modal (src/content/content-analysis-modal.ts).
 *
 * What matters here is the wiring, not the layout: editable tag rows on the module cards
 * and the chunk, thumbs where a thumb still fits, preset issues that appear only after a
 * thumbs down, and the trace link that Developer Mode adds. The localId that ties a
 * follow-up to its thumb is derived in the background, so it is not tested here — see
 * test/feedback.test.ts. See specs/feedback.md.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://example.com/article',
});
const sent: any[] = [];
let reply: any = { ok: true };

Object.assign(globalThis as any, {
  window: dom.window,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  document: dom.window.document,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  KeyboardEvent: dom.window.KeyboardEvent,
  chrome: {
    runtime: {
      sendMessage: async (message: any) => {
        sent.push(message);
        return reply;
      },
    },
    storage: { sync: { get: async () => ({}) }, onChanged: { addListener() {} } },
  },
});

const { showContentAnalysisModal } = await import('../src/content/content-analysis-modal.js');

const TRACE_ID = 'a'.repeat(32);

function openModal(extra: Record<string, unknown> = {}) {
  sent.length = 0;
  showContentAnalysisModal({
    feedbackEnabled: true,
    fingerprint: 'fp-1',
    url: 'https://example.com/article',
    title: 'A headline',
    tags: ['chunk-type:article'] as any,
    traceId: TRACE_ID,
    spanId: 'c'.repeat(16),
    chunkCount: 7,
    pageUrl: 'https://example.com/article',
    summary: { summaryText: 'Overblown', problemScore: 'high', overallRisk: 'high', confidence: 0.7, flags: [] } as any,
    analyses: [
      {
        id: 'x1',
        methodName: 'clickUnbait',
        model: 'heuristic',
        problemScore: 'high',
        confidence: 0.7,
        tags: [{ tag: 'clickbait', strength: 'high', confidence: 0.7 }],
        explanation: 'Headline overstates the story',
        spanId: 'd'.repeat(16),
        metadata: { moduleId: 'clickUnbait' },
      } as any,
    ],
    ...extra,
  });
  return dom.window.document.getElementById('betternet-detail-modal')!;
}

const widgetsOf = (modal: Element) =>
  Array.from(modal.querySelectorAll('[data-feedback]')) as HTMLElement[];
const click = (el: Element | null) => {
  assert.ok(el, 'element to click should exist');
  el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
};
const settle = () => new Promise((r) => setTimeout(r, 0));

// --- what is rateable, and how ---

let modal = openModal();
let widgets = widgetsOf(modal);
const kindOf = (w: HTMLElement) => `${w.dataset.target}:${w.dataset.feedbackKind}`;
assert.deepEqual(
  widgets.map(kindOf).sort(),
  ['chunk:tags', 'chunk:thumb', 'chunker:thumb', 'module:tags', 'page:page-type', 'summary:thumb'],
  'modules are rated by editing their tags; the chunk gets both, since a tag edit cannot say "not a chunk"'
);

const tagEditor = (target: string) =>
  widgets.find((w) => w.dataset.target === target && w.dataset.feedbackKind === 'tags')!;
const thumbWidget = (target: string) =>
  widgets.find((w) => w.dataset.target === target && w.dataset.feedbackKind === 'thumb')!;

const moduleTags = tagEditor('module');
assert.equal(moduleTags.dataset.moduleId, 'clickUnbait');
assert.equal(moduleTags.dataset.spanId, 'd'.repeat(16), 'module feedback points at its own span');
assert.equal(moduleTags.dataset.score, '0.75', 'the widget carries what we claimed');
assert.equal(moduleTags.querySelector('[data-thumb]'), null, 'the module card has no thumb');
assert.equal(moduleTags.querySelector('[data-issue]'), null, 'and no preset issues');

// The tag we applied is on the row, with an x to say it does not belong.
assert.ok(moduleTags.querySelector('[data-tag-chip="clickbait"]'), 'our tag is shown');
assert.ok(moduleTags.querySelector('[data-tag-remove="clickbait"]'), 'and can be removed');

// "+" offers the rest of that module's vocabulary, and not the tag already applied.
const chunkTags = tagEditor('chunk');
const chunkOptions = Array.from(
  chunkTags.querySelectorAll('[data-tag-select] option')
).map((o) => (o as HTMLOptionElement).value);
assert.ok(chunkOptions.includes('advert'), 'the chunk can be marked an advert');
assert.ok(
  !chunkOptions.includes('chunk-type:article'),
  'the tag it already has is not offered again'
);
assert.ok(chunkTags.querySelector('[data-tag-chip="chunk-type:article"]'));
assert.equal(
  (chunkTags.querySelector('[data-tag-select]') as HTMLElement).hidden,
  true,
  'the select stays out of the way until "+" is clicked'
);

// clickUnbait has one tag, and it is already applied, so "+" has nothing to open yet.
assert.equal(
  (moduleTags.querySelector('[data-tag-add]') as HTMLElement).hidden,
  true,
  '"+" is hidden while every tag is applied — but still there, so a removal can be undone'
);

// --- removing a tag says it does not belong ---

click(moduleTags.querySelector('[data-tag-remove="clickbait"]'));
await settle();
assert.equal(sent.length, 1, 'the edit submits straight away');
assert.equal(sent[0].type, 'BN_SUBMIT_FEEDBACK');
assert.equal(sent[0].payload.target, 'module');
assert.equal(sent[0].payload.moduleId, 'clickUnbait');
assert.equal(sent[0].payload.tag, 'clickbait');
assert.equal(sent[0].payload.tagOn, false);
assert.equal(sent[0].payload.thumbsUp, undefined, 'a tag edit is not a thumb');
assert.equal(sent[0].payload.chunkFingerprint, 'fp-1');
assert.equal(sent[0].payload.traceId, TRACE_ID);
assert.equal(moduleTags.querySelector('[data-tag-chip="clickbait"]'), null, 'the chip goes');
assert.match((moduleTags.querySelector('[data-status]') as HTMLElement).textContent!, /Removed/);
// A mis-click is one click to undo: the tag comes back on offer.
assert.equal(
  (moduleTags.querySelector('[data-tag-add]') as HTMLElement).hidden,
  false,
  '"+" appears now there is something to add'
);
assert.deepEqual(
  Array.from(moduleTags.querySelectorAll('[data-tag-select] option'))
    .map((o) => (o as HTMLOptionElement).value)
    .filter(Boolean),
  ['clickbait']
);

// --- adding a tag says we missed it ---

modal = openModal();
widgets = widgetsOf(modal);
const addTo = widgets.find((w) => w.dataset.target === 'chunk' && w.dataset.feedbackKind === 'tags')!;
click(addTo.querySelector('[data-tag-add]'));
await settle();
assert.equal(
  (addTo.querySelector('[data-tag-select]') as HTMLElement).hidden,
  false,
  '"+" opens the select'
);
assert.equal(sent.length, 0, 'opening the select submits nothing');

const select = addTo.querySelector('[data-tag-select]') as HTMLSelectElement;
select.value = 'advert';
select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await settle();
assert.equal(sent.length, 1);
assert.equal(sent[0].payload.target, 'chunk');
assert.equal(sent[0].payload.tag, 'advert');
assert.equal(sent[0].payload.tagOn, true);
assert.equal(sent[0].payload.thumbsUp, undefined);
assert.ok(addTo.querySelector('[data-tag-chip="advert"]'), 'the new tag joins the row');
assert.ok(addTo.querySelector('[data-tag-remove="advert"]'), 'and can be taken off again');
assert.ok(
  !Array.from(addTo.querySelectorAll('[data-tag-select] option')).some(
    (o) => (o as HTMLOptionElement).value === 'advert'
  ),
  'and is no longer offered'
);

// A failed send leaves the row alone rather than pretending the edit landed.
reply = { ok: false, error: 'Feedback sharing is disabled in Settings → Data Sharing' };
modal = openModal();
widgets = widgetsOf(modal);
const failingTags = widgets.find(
  (w) => w.dataset.target === 'module' && w.dataset.feedbackKind === 'tags'
)!;
click(failingTags.querySelector('[data-tag-remove="clickbait"]'));
await settle();
assert.ok(failingTags.querySelector('[data-tag-chip="clickbait"]'), 'the tag is still there');
assert.match((failingTags.querySelector('[data-status]') as HTMLElement).textContent!, /disabled/);
reply = { ok: true };

modal = openModal();
widgets = widgetsOf(modal);
const chunkerIssues = thumbWidget('chunker');
assert.ok(
  Array.from(chunkerIssues.querySelectorAll('[data-issue]')).some((b) =>
    b.textContent?.includes('Missed content')
  ),
  'chunker offers chunker issues'
);
assert.ok(
  !Array.from(thumbWidget('chunk').querySelectorAll('[data-issue]')).some((b) =>
    b.textContent?.includes('Wrong tag')
  ),
  '"Wrong tag" is gone: the tags are editable in place'
);

// --- thumbs up submits straight away ---

click(widgets.find((w) => w.dataset.target === 'summary')!.querySelector('[data-thumb="up"]'));
await settle();
assert.equal(sent.length, 1, 'thumbs up submits without waiting for anything else');
assert.equal(sent[0].type, 'BN_SUBMIT_FEEDBACK');
assert.equal(sent[0].payload.target, 'summary');
assert.equal(sent[0].payload.thumbsUp, true);
assert.equal(sent[0].payload.traceId, TRACE_ID);
assert.equal(sent[0].payload.chunkFingerprint, 'fp-1');

// --- thumbs down submits, then asks what went wrong ---

modal = openModal();
widgets = widgetsOf(modal);
const summaryFb = widgets.find((w) => w.dataset.target === 'summary')!;
click(summaryFb.querySelector('[data-thumb="down"]'));
await settle();
assert.equal(sent.length, 1, 'the thumb itself is already recorded');
assert.equal(sent[0].payload.thumbsUp, false);
assert.equal(sent[0].payload.tag, undefined, 'a thumb names no tag');
assert.equal(
  (summaryFb.querySelector('[data-issues]') as HTMLElement).style.display,
  'flex',
  'presets open on thumbs down'
);

click(summaryFb.querySelector('[data-issue="score-too-high"]'));
await settle();
assert.equal(sent.length, 2);
assert.equal(sent[1].payload.target, 'summary', 'the follow-up rates the same thing');
assert.equal(sent[1].payload.chunkFingerprint, 'fp-1');
assert.equal(sent[1].payload.issueId, 'score-too-high');
assert.equal(sent[1].payload.issueLabel, 'Score too high');
assert.equal((summaryFb.querySelector('[data-issues]') as HTMLElement).style.display, 'none');

// --- Other… opens the free-text box ---

modal = openModal();
widgets = widgetsOf(modal);
const chunkThumbFb = widgets.find(
  (w) => w.dataset.target === 'chunk' && w.dataset.feedbackKind === 'thumb'
)!;
click(chunkThumbFb.querySelector('[data-thumb="down"]'));
await settle();
click(chunkThumbFb.querySelector('[data-issue="other"]'));
await settle();
assert.equal(sent.length, 1, 'Other… only reveals the box, it does not submit');
const note = chunkThumbFb.querySelector('[data-note]') as HTMLElement;
assert.equal(note.style.display, 'block');

const textarea = chunkThumbFb.querySelector('[data-note-text]') as HTMLTextAreaElement;
click(chunkThumbFb.querySelector('[data-send-note]'));
await settle();
assert.equal(sent.length, 1, 'an empty note is not sent');

textarea.value = 'this div is a sidebar';
click(chunkThumbFb.querySelector('[data-send-note]'));
await settle();
assert.equal(sent.length, 2);
assert.equal(sent[1].payload.message, 'this div is a sidebar');
assert.equal(sent[1].payload.target, 'chunk');

// --- chunker feedback carries the page, not the chunk ---

modal = openModal();
widgets = widgetsOf(modal);
click(widgets.find((w) => w.dataset.target === 'chunker')!.querySelector('[data-thumb="down"]'));
await settle();
assert.equal(sent[0].payload.pageUrl, 'https://example.com/article');
assert.equal(sent[0].payload.chunkCount, 7);

// --- clicking the same thumb again retracts it ---

modal = openModal();
widgets = widgetsOf(modal);
const summaryWidget = widgets.find((w) => w.dataset.target === 'summary')!;
click(summaryWidget.querySelector('[data-thumb="up"]'));
await settle();
click(summaryWidget.querySelector('[data-thumb="up"]'));
await settle();
assert.equal(sent.length, 2);
assert.equal(sent[1].payload.retracted, true);
assert.equal(summaryWidget.dataset.vote, '', 'no vote is showing after a retraction');

// --- Developer Mode reveals the trace, nobody else sees it ---

modal = openModal({ developerMode: true, aiqaOrganisationId: 'bn' });
widgets = widgetsOf(modal);
const devWidget = widgets.find((w) => w.dataset.target === 'summary')!;
click(devWidget.querySelector('[data-thumb="up"]'));
await settle();
const traceBox = devWidget.querySelector('[data-trace]') as HTMLElement;
assert.equal(traceBox.style.display, 'block');
assert.ok(traceBox.textContent?.includes('aaaaaaaa'), 'shows the trace id');
const link = traceBox.querySelector('a') as HTMLAnchorElement;
assert.ok(link.href.includes(TRACE_ID), 'links to the AIQA trace');
assert.ok(
  link.href.includes('/organisation/bn/traces/'),
  'the AIQA trace page lives under an organisation'
);

// Without the organisation there is no trace page to link to, so say so and keep the id.
modal = openModal({ developerMode: true });
widgets = widgetsOf(modal);
const noOrg = widgets.find((w) => w.dataset.target === 'summary')!;
click(noOrg.querySelector('[data-thumb="up"]'));
await settle();
const noOrgBox = noOrg.querySelector('[data-trace]') as HTMLElement;
assert.ok(noOrgBox.textContent?.includes('aaaaaaaa'), 'the trace id is still worth quoting');
assert.equal(noOrgBox.querySelector('a'), null, 'no dead link');
assert.match(noOrgBox.textContent!, /organisation/, 'says what is missing');

modal = openModal({ developerMode: true, traceId: undefined });
widgets = widgetsOf(modal);
const untraced = widgets.find((w) => w.dataset.target === 'summary')!;
click(untraced.querySelector('[data-thumb="up"]'));
await settle();
assert.match(
  (untraced.querySelector('[data-trace]') as HTMLElement).textContent!,
  /No trace/,
  'unsampled analysis says so rather than offering a dead link'
);

modal = openModal();
widgets = widgetsOf(modal);
const plainWidget = widgets.find((w) => w.dataset.target === 'summary')!;
click(plainWidget.querySelector('[data-thumb="up"]'));
await settle();
assert.equal(
  (plainWidget.querySelector('[data-trace]') as HTMLElement).style.display,
  'none',
  'no trace id without Developer Mode'
);

// --- a failed send says so, and does not pretend to have a vote ---

reply = { ok: false, error: 'Feedback sharing is disabled in Settings → Data Sharing' };
modal = openModal();
widgets = widgetsOf(modal);
const failing = widgets.find((w) => w.dataset.target === 'summary')!;
click(failing.querySelector('[data-thumb="down"]'));
await settle();
assert.match((failing.querySelector('[data-status]') as HTMLElement).textContent!, /disabled/);
assert.equal((failing.querySelector('[data-issues]') as HTMLElement).style.display, 'none');
reply = { ok: true };

// --- an unreachable server holds the edit instead of losing it ---
// The background queues on a network failure and says `queued`, so the correction stands
// and the row says so. A dead `serverEndpoint` used to read as "your edit was rejected".

reply = { ok: false, queued: true, error: 'Failed to fetch' };
modal = openModal();
widgets = widgetsOf(modal);
const queuedTags = widgets.find(
  (w) => w.dataset.target === 'module' && w.dataset.feedbackKind === 'tags'
)!;
click(queuedTags.querySelector('[data-tag-remove="clickbait"]'));
await settle();
assert.equal(sent.length, 1, 'it was still submitted');
assert.equal(queuedTags.querySelector('[data-tag-chip="clickbait"]'), null, 'the edit stands');
assert.match(
  (queuedTags.querySelector('[data-status]') as HTMLElement).textContent!,
  /Saved/,
  'and says it is saved rather than reporting a failure'
);

modal = openModal();
widgets = widgetsOf(modal);
const queuedThumb = widgets.find((w) => w.dataset.target === 'summary')!;
click(queuedThumb.querySelector('[data-thumb="up"]'));
await settle();
assert.equal(queuedThumb.dataset.vote, 'up', 'the vote shows while it waits to be sent');
assert.match((queuedThumb.querySelector('[data-status]') as HTMLElement).textContent!, /Saved/);
reply = { ok: true };

// --- the page type: shown, and corrected by choosing another ---

const ARTICLE = { value: 'article', confidence: 0.9, source: 'jsonld' } as const;
const pageTypeOf = (m: Element) =>
  m.querySelector('[data-page-type-select]') as HTMLSelectElement;

modal = openModal({ pageType: ARTICLE });
let pageSelect = pageTypeOf(modal);
assert.equal(pageSelect.value, 'page-type:article', 'the classified type is what the select shows');
assert.equal(
  Array.from(pageSelect.options).some((o) => !o.value),
  false,
  'no empty option while we have an answer'
);
assert.ok(
  Array.from(pageSelect.options).some((o) => o.value === 'page-type:checkout'),
  'the rest of the vocabulary is offered'
);
assert.ok(
  !Array.from(pageSelect.options).some((o) => o.value === 'page-type:unknown'),
  '"unknown" is not a correction a user makes'
);

// A correction is two statements: the old type withdrawn, the new one asserted.
const edits: string[] = [];
modal = openModal({ pageType: ARTICLE, onPageTypeEdit: (v: string) => edits.push(v) });
pageSelect = pageTypeOf(modal);
pageSelect.value = 'page-type:checkout';
pageSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await settle();
assert.equal(sent.length, 2);
assert.deepEqual(
  sent.map((m) => [m.payload.target, m.payload.tag, m.payload.tagOn]),
  [
    ['page', 'page-type:article', false],
    ['page', 'page-type:checkout', true],
  ]
);
assert.equal(sent[0].payload.pageUrl, 'https://example.com/article', 'the page is the subject');
assert.deepEqual(edits, ['checkout'], 'the correction is applied locally too, for routing');
assert.equal(pageSelect.dataset.current, 'page-type:checkout');
assert.match(
  (modal.querySelector('[data-feedback-kind="page-type"] [data-status]') as HTMLElement).textContent!,
  /Thanks/
);

// Nothing to withdraw when we had no answer, and the placeholder goes once it is wrong.
modal = openModal();
pageSelect = pageTypeOf(modal);
assert.equal(pageSelect.value, '', 'unclassified pages show the Unknown placeholder');
assert.ok(Array.from(pageSelect.options).some((o) => !o.value));
pageSelect.value = 'page-type:listing';
pageSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await settle();
assert.equal(sent.length, 1, 'one statement: there was no previous type to take back');
assert.equal(sent[0].payload.tag, 'page-type:listing');
assert.equal(sent[0].payload.tagOn, true);
assert.equal(
  Array.from(pageSelect.options).some((o) => !o.value),
  false,
  'the Unknown placeholder described a state the page has now left'
);

// A failed send leaves the select saying what we still believe.
reply = { ok: false, error: 'Feedback sharing is disabled in Settings → Data Sharing' };
modal = openModal({ pageType: ARTICLE });
pageSelect = pageTypeOf(modal);
pageSelect.value = 'page-type:checkout';
pageSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await settle();
assert.equal(pageSelect.dataset.current, 'page-type:article', 'the correction did not land');
assert.equal(pageSelect.value, 'page-type:article', 'and the select shows what we still believe');
reply = { ok: true };

// Developer Mode says which classifier decided it, since that is what you judge before
// correcting it.
modal = openModal({ pageType: ARTICLE, developerMode: true });
assert.match(
  (modal.querySelector('[data-feedback-kind="page-type"]') as HTMLElement).textContent!,
  /jsonld, 90% confident/
);
modal = openModal({ pageType: ARTICLE });
assert.ok(
  !/jsonld/.test((modal.querySelector('[data-feedback-kind="page-type"]') as HTMLElement).textContent!),
  'provenance is a Developer Mode detail'
);

// --- no feedback UI when sharing is off, but the page type is still shown ---

modal = openModal({ feedbackEnabled: false, pageType: ARTICLE });
assert.equal(widgetsOf(modal).length, 0);
assert.equal(pageTypeOf(modal), null, 'nothing to correct with when feedback is off');
assert.match(
  (modal.querySelector('[data-page-type]') as HTMLElement).textContent!,
  /Article/,
  'the page type is information, not feedback, so it is shown either way'
);

console.log('✅ feedback modal tests passed');
