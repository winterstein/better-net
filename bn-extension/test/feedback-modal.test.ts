/**
 * Feedback widgets in the Content Analysis modal (src/content/content-analysis-modal.ts).
 *
 * What matters here is the wiring, not the layout: one widget per rateable thing, a thumb
 * that submits immediately, preset issues that appear only after a thumbs down, and the
 * trace link that Developer Mode adds. The localId that ties a follow-up to its thumb is
 * derived in the background from what is being rated, so it is not tested here — see
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

// --- one widget per rateable thing ---

let modal = openModal();
let widgets = widgetsOf(modal);
assert.deepEqual(
  widgets.map((w) => w.dataset.target).sort(),
  ['chunk', 'chunker', 'module', 'summary'],
  'summary, each feature, the chunk and the chunker are all rateable'
);

const moduleWidget = widgets.find((w) => w.dataset.target === 'module')!;
assert.equal(moduleWidget.dataset.moduleId, 'clickUnbait');
assert.equal(moduleWidget.dataset.spanId, 'd'.repeat(16), 'module feedback points at its own span');
assert.equal(moduleWidget.dataset.score, '0.75', 'the widget carries what we claimed');

// Presets are hidden until a thumbs down, and every widget offers its own vocabulary.
const issuesRow = moduleWidget.querySelector('[data-issues]') as HTMLElement;
assert.equal(issuesRow.style.display, 'none');
assert.ok(
  Array.from(issuesRow.querySelectorAll('[data-issue]')).some(
    (b) => b.textContent?.trim() === "This isn't clickbait"
  ),
  'clickbait module offers "This isn\'t clickbait"'
);
const chunkerIssues = widgets.find((w) => w.dataset.target === 'chunker')!;
assert.ok(
  Array.from(chunkerIssues.querySelectorAll('[data-issue]')).some((b) =>
    b.textContent?.includes('Missed content')
  ),
  'chunker offers chunker issues'
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
const moduleFb = widgets.find((w) => w.dataset.target === 'module')!;
click(moduleFb.querySelector('[data-thumb="down"]'));
await settle();
assert.equal(sent.length, 1, 'the thumb itself is already recorded');
assert.equal(sent[0].payload.thumbsUp, false);
assert.equal(
  (moduleFb.querySelector('[data-issues]') as HTMLElement).style.display,
  'flex',
  'presets open on thumbs down'
);

click(moduleFb.querySelector('[data-issue="not-applicable"]'));
await settle();
assert.equal(sent.length, 2);
assert.equal(sent[1].payload.target, 'module', 'the follow-up rates the same thing');
assert.equal(sent[1].payload.moduleId, 'clickUnbait');
assert.equal(sent[1].payload.chunkFingerprint, 'fp-1');
assert.equal(sent[1].payload.issueId, 'not-applicable');
assert.equal(sent[1].payload.issueLabel, "This isn't clickbait");
assert.equal((moduleFb.querySelector('[data-issues]') as HTMLElement).style.display, 'none');

// --- Other… opens the free-text box ---

modal = openModal();
widgets = widgetsOf(modal);
const chunkWidget = widgets.find((w) => w.dataset.target === 'chunk')!;
click(chunkWidget.querySelector('[data-thumb="down"]'));
await settle();
click(chunkWidget.querySelector('[data-issue="other"]'));
await settle();
assert.equal(sent.length, 1, 'Other… only reveals the box, it does not submit');
const note = chunkWidget.querySelector('[data-note]') as HTMLElement;
assert.equal(note.style.display, 'block');

const textarea = chunkWidget.querySelector('[data-note-text]') as HTMLTextAreaElement;
click(chunkWidget.querySelector('[data-send-note]'));
await settle();
assert.equal(sent.length, 1, 'an empty note is not sent');

textarea.value = 'this div is a sidebar';
click(chunkWidget.querySelector('[data-send-note]'));
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

// --- no feedback UI when sharing is off ---

modal = openModal({ feedbackEnabled: false });
assert.equal(widgetsOf(modal).length, 0);

console.log('✅ feedback modal tests passed');
