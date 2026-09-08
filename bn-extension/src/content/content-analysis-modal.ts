// Content Analysis detail modal (opened from chunk nutrition badge)

import type { ModuleAnalysis } from '../types/ModuleAnalysis.js';
import type { ChunkAnalysis } from '../types/ChunkAnalysis.js';
import { chunkProblemScore } from '../types/ChunkAnalysis.js';
import { fractionFromProblemScore, issueTagIds } from '../types/Score.js';
import type { FeedbackTarget } from '../types/Feedback.js';
import { riskLevelForScore } from '../types/RiskLevel.js';
import { issuesForTarget, issueLabel, OTHER_ISSUE_ID } from '../feedback/feedback-issues.js';
import { MAX_FEEDBACK_MESSAGE_LENGTH } from '../feedback/feedback-client.js';
import { aiqaTraceUrl } from '../tracing/aiqa-trace-url.js';
import { logit } from '../utils/logger.js';

export interface TrafficLight {
  color: string;
  border: string;
  label: string;
}

export interface NutritionData {
  label: string;
  score: number;
  scores?: { type: string; score: number }[];
  flags?: string[];
  highestRisk?: { type: string; score: number };
}

const ANALYSIS_LABELS: Record<string, string> = {
  factChecker: 'Fact Checker',
  biasDetector: 'Bias Detector',
  antiManipulation: 'Anti-manipulation',
  defuseRagebait: 'Defuse Ragebait',
  clickUnbait: 'Click Unbait',
};

export function getTrafficLight(score: number): TrafficLight {
  // Bands live in RiskLevel.ts so the label and the display threshold agree.
  const { color, border, label } = riskLevelForScore(score);
  return { color, border, label };
}

export function calculateNutritionData(analyses: ModuleAnalysis[]): NutritionData {
  const scores: { type: string; score: number }[] = [];
  const flags: string[] = [];

  analyses.forEach((analysis) => {
    if (!analysis.error && analysis.problemScore) {
      const type = String(analysis.metadata?.moduleId ?? analysis.methodName);
      scores.push({ type, score: fractionFromProblemScore(analysis.problemScore) });
      if (analysis.tags?.length) {
        flags.push(...issueTagIds(analysis.tags));
      }
    }
  });

  if (scores.length === 0) {
    return { label: 'No Data', score: 0 };
  }

  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  const highestRisk = scores.reduce((max, s) => (s.score > max.score ? s : max), scores[0]);

  let label = 'Safe';
  if (avgScore >= 0.7) {
    label = 'High Risk';
  } else if (avgScore >= 0.4) {
    label = 'Caution';
  }

  return {
    label,
    score: avgScore,
    scores,
    flags: [...new Set(flags)],
    highestRisk,
  };
}

function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function escapeHtml(text: unknown): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getRatingColor(rating: string): { bg: string; text: string } {
  const ratingLower = (rating || '').toLowerCase();
  if (ratingLower.includes('false') || ratingLower.includes('pants on fire')) {
    return { bg: '#ffebee', text: '#c62828' };
  }
  if (ratingLower.includes('true')) {
    return { bg: '#e8f5e9', text: '#2e7d32' };
  }
  if (ratingLower.includes('mixture') || ratingLower.includes('half')) {
    return { bg: '#fff3e0', text: '#f57c00' };
  }
  return { bg: '#f5f5f5', text: '#666' };
}

/** Page and chunk context every feedback submission from this modal is sent with. */
export interface FeedbackContext {
  chunkFingerprint?: string;
  chunkUrl?: string;
  chunkTitle?: string;
  pageUrl?: string;
  chunkCount?: number;
  traceId?: string;
  /** Span for the chunk as a whole; module widgets carry their own. */
  chunkSpanId?: string;
  /** Settings → Advanced → Developer Mode: reveal the AIQA trace after feedback. */
  developerMode?: boolean;
  aiqaServerUrl?: string;
  aiqaOrganisationId?: string;
}

const FEEDBACK_PROMPTS: Record<FeedbackTarget, string> = {
  summary: 'Is this overall verdict right?',
  module: 'Does this assessment fit?',
  chunker: 'Did we split this page up sensibly?',
  chunk: 'Is this the right chunk, with the right tags?',
};

const THUMB_STYLE = `
  border: 1px solid #ddd;
  background: #fafafa;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1.2;
`;

const ISSUE_STYLE = `
  border: 1px solid #ddd;
  background: white;
  border-radius: 12px;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 11px;
  color: #444;
`;

/**
 * Thumbs up/down for one rateable thing, plus the preset issues shown after a thumbs
 * down. Preset lists come from feedback/feedback-issues.ts, so a target's vocabulary is
 * data, not widget code. See specs/feedback.md.
 */
function renderFeedbackWidget(opts: {
  target: FeedbackTarget;
  moduleId?: string;
  problemScore?: number;
  spanId?: string;
  tags?: string[];
}): string {
  const { target, moduleId, problemScore, spanId, tags } = opts;
  const issues = issuesForTarget(target, moduleId)
    .map(
      (issue) =>
        `<button type="button" data-issue="${escapeHtml(issue.id)}" style="${ISSUE_STYLE}">${escapeHtml(issue.label)}</button>`
    )
    .join('');

  return `
    <div data-feedback
      data-target="${escapeHtml(target)}"
      data-module-id="${escapeHtml(moduleId ?? '')}"
      data-score="${problemScore ?? 0}"
      data-span-id="${escapeHtml(spanId ?? '')}"
      data-tags="${escapeHtml((tags ?? []).join(','))}"
      style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px;">
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <span style="font-size: 11px; color: #666;">${FEEDBACK_PROMPTS[target]}</span>
        <button type="button" data-thumb="up" title="This is right" style="${THUMB_STYLE}">👍</button>
        <button type="button" data-thumb="down" title="This is wrong" style="${THUMB_STYLE}">👎</button>
        <span data-status style="font-size: 11px; color: #666;"></span>
      </div>
      <div data-issues style="display: none; gap: 6px; flex-wrap: wrap; margin-top: 8px;">${issues}</div>
      <div data-note style="display: none; margin-top: 8px;">
        <textarea data-note-text rows="2" maxlength="${MAX_FEEDBACK_MESSAGE_LENGTH}" placeholder="What went wrong?" style="
          width: 100%;
          padding: 6px 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 12px;
          resize: vertical;
          box-sizing: border-box;
        "></textarea>
        <button type="button" data-send-note style="${ISSUE_STYLE} margin-top: 4px;">Send</button>
      </div>
      <div data-trace style="display: none; margin-top: 6px; font-size: 11px; color: #888;"></div>
    </div>
  `;
}

function setStatus(widget: HTMLElement, text: string): void {
  const status = widget.querySelector('[data-status]') as HTMLElement | null;
  if (status) status.textContent = text;
}

function show(widget: HTMLElement, selector: string, display: string): void {
  const el = widget.querySelector(selector) as HTMLElement | null;
  if (el) el.style.display = display;
}

/** Mark which thumb is currently chosen, so a reopened row shows the vote. */
function paintThumbs(widget: HTMLElement, vote: string): void {
  widget.querySelectorAll('[data-thumb]').forEach((el) => {
    const btn = el as HTMLElement;
    const chosen = btn.dataset.thumb === vote;
    btn.style.background = chosen ? '#eef4ff' : '#fafafa';
    btn.style.borderColor = chosen ? '#7aa7f0' : '#ddd';
  });
}

/**
 * In Developer Mode, show the AIQA trace behind this verdict once feedback is in, so a
 * complaint can be taken straight to the prompts. Everyone else just sees "Thanks!".
 */
function revealTrace(widget: HTMLElement, ctx: FeedbackContext): void {
  if (!ctx.developerMode) return;
  const box = widget.querySelector('[data-trace]') as HTMLElement | null;
  if (!box) return;
  box.style.display = 'block';
  if (!ctx.traceId) {
    box.textContent = 'No trace for this analysis (AIQA tracing off or unsampled).';
    return;
  }
  const url = aiqaTraceUrl(ctx.traceId, ctx.aiqaServerUrl, ctx.aiqaOrganisationId);
  // The AIQA trace route needs an organisation. Without one the id is still worth having
  // — it is what a bug report quotes — so show it and say what is missing.
  const link = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener" style="color: #2196f3;">open in AIQA →</a>`
    : '<span style="color: #aaa;">set AIQA organisation in Settings to link</span>';
  box.innerHTML = `
    Trace <code data-copy-trace title="Click to copy" style="cursor: pointer; font-family: monospace;">${escapeHtml(
      ctx.traceId.slice(0, 8)
    )}</code>
    ${link}
  `;
}

async function sendFeedback(
  widget: HTMLElement,
  ctx: FeedbackContext,
  patch: { thumbsUp: boolean; retracted?: boolean; issueId?: string; message?: string }
): Promise<boolean> {
  const target = widget.dataset.target as FeedbackTarget;
  const moduleId = widget.dataset.moduleId || undefined;
  const tags = (widget.dataset.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  setStatus(widget, 'Sending…');
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'BN_SUBMIT_FEEDBACK',
      payload: {
        target,
        thumbsUp: patch.thumbsUp,
        retracted: patch.retracted,
        issueId: patch.issueId,
        issueLabel: patch.issueId ? issueLabel(target, patch.issueId, moduleId) : undefined,
        message: patch.message,
        chunkFingerprint: ctx.chunkFingerprint,
        chunkUrl: ctx.chunkUrl,
        chunkTitle: ctx.chunkTitle,
        pageUrl: ctx.pageUrl,
        chunkCount: ctx.chunkCount,
        moduleId,
        tags,
        problemScore: Number(widget.dataset.score || '0'),
        traceId: ctx.traceId,
        spanId: widget.dataset.spanId || ctx.chunkSpanId,
      },
    });
    if (res?.ok) return true;
    setStatus(widget, res?.error || 'Could not send feedback');
  } catch {
    setStatus(widget, 'Could not send feedback');
  }
  return false;
}

/**
 * One delegated listener for every widget in the modal, so the buttons revealed after a
 * thumbs down need no wiring of their own.
 *
 * A thumb submits straight away — feedback is never lost because the user walked away —
 * and a preset issue or note follows as an update to the same record, which they reach by
 * deriving the same localId from what is being rated (feedback/feedback-client.ts).
 */
function attachFeedbackHandlers(modal: HTMLElement, ctx: FeedbackContext): void {
  modal.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const widget = target.closest('[data-feedback]') as HTMLElement | null;
    if (!widget) return;

    const thumb = target.closest('[data-thumb]') as HTMLElement | null;
    if (thumb) {
      e.preventDefault();
      const vote = thumb.dataset.thumb === 'up' ? 'up' : 'down';
      const retracting = widget.dataset.vote === vote;
      const ok = await sendFeedback(widget, ctx, {
        thumbsUp: vote === 'up',
        retracted: retracting,
      });
      if (!ok) return;
      widget.dataset.vote = retracting ? '' : vote;
      paintThumbs(widget, widget.dataset.vote);
      const showIssues = !retracting && vote === 'down';
      show(widget, '[data-issues]', showIssues ? 'flex' : 'none');
      if (!showIssues) show(widget, '[data-note]', 'none');
      setStatus(widget, retracting ? '' : showIssues ? 'Thanks! What went wrong?' : 'Thanks!');
      if (!retracting) revealTrace(widget, ctx);
      return;
    }

    const issue = target.closest('[data-issue]') as HTMLElement | null;
    if (issue) {
      e.preventDefault();
      const issueId = issue.dataset.issue!;
      if (issueId === OTHER_ISSUE_ID) {
        show(widget, '[data-note]', 'block');
        setStatus(widget, '');
        (widget.querySelector('[data-note-text]') as HTMLTextAreaElement | null)?.focus();
        return;
      }
      if (await sendFeedback(widget, ctx, { thumbsUp: false, issueId })) {
        show(widget, '[data-issues]', 'none');
        setStatus(widget, 'Thanks — noted.');
      }
      return;
    }

    if (target.closest('[data-send-note]')) {
      e.preventDefault();
      const box = widget.querySelector('[data-note-text]') as HTMLTextAreaElement | null;
      const message = box?.value.trim();
      if (!message) {
        setStatus(widget, 'Nothing to send');
        return;
      }
      if (await sendFeedback(widget, ctx, { thumbsUp: false, issueId: OTHER_ISSUE_ID, message })) {
        show(widget, '[data-note]', 'none');
        show(widget, '[data-issues]', 'none');
        setStatus(widget, 'Thanks — noted.');
      }
      return;
    }

    const copy = target.closest('[data-copy-trace]') as HTMLElement | null;
    if (copy && ctx.traceId) {
      e.preventDefault();
      void navigator.clipboard?.writeText(ctx.traceId).then(
        () => {
          copy.textContent = 'copied';
        },
        () => {}
      );
    }
  });
}

function formatAnalysisExplanation(result: ModuleAnalysis): string {
  const text = typeof result.explanation === 'string' ? result.explanation.trim() : '';
  if (text) return escapeHtml(text);
  if (result.error) return escapeHtml(result.error);
  return '<span style="color: #999; font-style: italic;">No explanation available.</span>';
}

function renderFactCheckClaims(factChecks: unknown[]): string {
  if (!factChecks || factChecks.length === 0) {
    return '';
  }

  let html = `
        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e0e0e0;">
          <div style="font-weight: 600; font-size: 13px; color: #333; margin-bottom: 12px;">Fact-Checked Claims:</div>
      `;

  factChecks.forEach((claimResult, index) => {
    const claim = claimResult as Record<string, unknown>;
    const claimText = (claim.claim as string) || `Claim ${index + 1}`;
    const reviews = claim.factChecks as unknown[] | undefined;
    const hasReviews = reviews && reviews.length > 0;

    html += `
          <div style="
            margin-bottom: 12px;
            padding: 10px;
            background: #f9f9f9;
            border-radius: 6px;
            border-left: 3px solid #2196f3;
          ">
            <div style="font-size: 12px; font-weight: 600; color: #333; margin-bottom: 8px;">
              ${truncateText(claimText, 150)}
            </div>
        `;

    if (hasReviews) {
      reviews.forEach((factCheck) => {
        const fc = factCheck as Record<string, unknown>;
        const claimReview = fc.claimReview as Record<string, unknown>[] | undefined;
        const review = claimReview?.[0];
        if (review) {
          const rating = (review.textualRating as string) || 'Unknown';
          const ratingColor = getRatingColor(rating);

          html += `
                <div style="
                  margin-top: 8px;
                  padding: 8px;
                  background: white;
                  border-radius: 4px;
                  border: 1px solid #e0e0e0;
                ">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                    <span style="
                      font-size: 11px;
                      padding: 3px 8px;
                      border-radius: 12px;
                      font-weight: 600;
                      background: ${ratingColor.bg};
                      color: ${ratingColor.text};
                      text-transform: capitalize;
                    ">${rating}</span>
                    <span style="font-size: 11px; color: #666;">${(review.publisher as string) || 'Unknown Publisher'}</span>
                  </div>
                  ${review.title ? `
                    <div style="font-size: 11px; color: #333; margin-bottom: 4px;">
                      ${truncateText(review.title as string, 120)}
                    </div>
                  ` : ''}
                  ${review.url ? `
                    <a href="${review.url}" target="_blank" style="
                      font-size: 11px;
                      color: #2196f3;
                      text-decoration: none;
                    ">View fact-check →</a>
                  ` : ''}
                </div>
              `;
        }
      });
    } else {
      html += `
            <div style="font-size: 11px; color: #999; font-style: italic; margin-top: 4px;">
              No fact-checks found for this claim
            </div>
          `;
    }

    html += `</div>`;
  });

  html += `</div>`;
  return html;
}

/** A chunk's analysis, plus the page-level context the modal needs from content.ts. */
export interface ContentAnalysisModalData extends Partial<ChunkAnalysis> {
  /** Settings → Advanced → Developer Mode. See specs/feedback.md. */
  developerMode?: boolean;
  /** How many chunks the page was split into, for chunker feedback. */
  chunkCount?: number;
  pageUrl?: string;
  aiqaServerUrl?: string;
  aiqaOrganisationId?: string;
}

/** Show or replace the Content Analysis detail modal for a chunk. */
export function showContentAnalysisModal(analysisResults: ContentAnalysisModalData): void {
  const existingModal = document.getElementById('betternet-detail-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const {
    summary,
    analyses = [],
    tags = [],
    title,
    fingerprint,
    url,
    feedbackEnabled,
    traceId,
    spanId,
    developerMode,
    chunkCount,
    pageUrl,
    aiqaServerUrl,
    aiqaOrganisationId,
  } = analysisResults;
  const problemScore = chunkProblemScore(analysisResults);
  const canFeedback = feedbackEnabled && fingerprint && url;
  if ( !canFeedback ) {
    logit('log', 'Content Analysis modal: Feedback is disabled: feedbackEnabled: '+feedbackEnabled+' fingerprint:'+fingerprint+' url:'+url);
  }
  const feedbackContext: FeedbackContext = {
    chunkFingerprint: fingerprint,
    chunkUrl: url,
    chunkTitle: title,
    pageUrl: pageUrl || url,
    chunkCount,
    traceId,
    chunkSpanId: spanId,
    developerMode,
    aiqaServerUrl,
    aiqaOrganisationId,
  };
  const nutritionData = calculateNutritionData(analyses);
  const trafficLight = getTrafficLight(problemScore);
  const modalTitle = title
    ? `Content Analysis: ${escapeHtml(truncateText(title, 60))}`
    : 'Content Analysis';

  const modal = document.createElement('div');
  modal.id = 'betternet-detail-modal';
  modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 24px;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        position: relative;
      `;

  let detailsHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #333;">${modalTitle}</h2>
          <button id="betternet-close-modal" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
            padding: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
          ">×</button>
        </div>

        <div style="margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <div style="
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${trafficLight.color};
              flex-shrink: 0;
            "></div>
            <div>
              <div style="font-weight: 600; color: #333; font-size: 16px;">Overall: ${nutritionData.label}</div>
              <div style="font-size: 14px; color: #666;">Score: ${(problemScore * 100).toFixed(0)}%</div>
            </div>
          </div>
          ${canFeedback ? renderFeedbackWidget({ target: 'summary', problemScore }) : ''}
        </div>

        ${
          tags.length > 0 || canFeedback
            ? `
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #333;">This chunk</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${tags
              .map(
                (tag) => `
              <span style="
                display: inline-block;
                background: ${tag === 'advert' ? '#fff3e0' : '#f5f5f5'};
                color: ${tag === 'advert' ? '#e65100' : '#555'};
                padding: 4px 10px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 500;
                text-transform: capitalize;
              ">${tag.replace(/_/g, ' ')}</span>
            `
              )
              .join('')}
          </div>
          ${canFeedback ? renderFeedbackWidget({ target: 'chunk', spanId }) : ''}
        </div>
        `
            : ''
        }

        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: #333;">Analysis Breakdown</h3>
          <div style="display: flex; flex-direction: column; gap: 12px;">
      `;

  analyses.forEach((result) => {
    if (!result || (result.error && !(typeof result.explanation === 'string' && result.explanation.trim()))) return;

    const moduleId = String(result.metadata?.moduleId ?? result.methodName);
    const typeLabel = ANALYSIS_LABELS[moduleId] || moduleId;
    const score = result.error
      ? 0
      : fractionFromProblemScore(result.problemScore || 'low');
    const scorePercent = (score * 100).toFixed(0);
    const barColor = score >= 0.7 ? '#f44336' : score >= 0.4 ? '#ff9800' : '#4CAF50';

    const factChecks = result.metadata?.factChecks;
    const hasFactChecks =
      moduleId === 'factChecker' &&
      Array.isArray(factChecks) &&
      factChecks.length > 0;
    const factCheckHTML = hasFactChecks ? renderFactCheckClaims(factChecks as unknown[]) : '';
    const explanationHtml = formatAnalysisExplanation(result);
    const tags = issueTagIds(result.tags || []);

    detailsHTML += `
            <div data-analysis-card style="
              border: 1px solid #e0e0e0;
              border-radius: 8px;
              padding: 12px;
            ">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 600; color: #333;">${typeLabel}</span>
                <span style="font-size: 14px; color: #666;">${scorePercent}%</span>
              </div>
              <div style="
                width: 100%;
                height: 8px;
                background: #f0f0f0;
                border-radius: 4px;
                overflow: hidden;
              ">
                <div style="
                  width: ${scorePercent}%;
                  height: 100%;
                  background: ${barColor};
                  transition: width 0.3s ease;
                "></div>
              </div>
              <div style="margin-top: 10px;">
                <div style="font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px;">Explanation</div>
                <div style="font-size: 13px; line-height: 1.45; color: #444;">${explanationHtml}</div>
              </div>
              ${tags && tags.length > 0 ? `
                <div style="margin-top: 8px;">
                  ${tags.map(tag => `
                    <span style="
                      display: inline-block;
                      background: #f5f5f5;
                      padding: 2px 8px;
                      border-radius: 4px;
                      font-size: 11px;
                      color: #666;
                      margin-right: 4px;
                      margin-top: 4px;
                    ">${escapeHtml(tag)}</span>
                  `).join('')}
                </div>
              ` : ''}
              ${factCheckHTML}
              ${
                canFeedback
                  ? renderFeedbackWidget({
                      target: 'module',
                      moduleId,
                      problemScore: score,
                      spanId: result.spanId,
                      tags,
                    })
                  : ''
              }
            </div>
          `;
  });

  detailsHTML += `
          </div>
        </div>
      `;

  if (summary?.summaryText) {
    detailsHTML += `
          <div>
            <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: #333;">Summary</h3>
            <p style="margin: 0; color: #666; font-size: 14px;">${escapeHtml(summary.summaryText)}</p>
          </div>
        `;
  }

  // Chunker feedback is about the page, not this chunk, so it sits on its own in the
  // footer — opened from whichever chunk's modal the user happens to have in front.
  if (canFeedback) {
    detailsHTML += `
          <div style="margin-top: 20px; padding-top: 4px; border-top: 1px solid #e0e0e0;">
            <h3 style="margin: 12px 0 0 0; font-size: 14px; font-weight: 600; color: #333;">
              This page${chunkCount ? ` — ${chunkCount} chunks` : ''}
            </h3>
            ${renderFeedbackWidget({ target: 'chunker' })}
          </div>
        `;
  }

  modalContent.innerHTML = detailsHTML;
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  document.getElementById('betternet-close-modal')!.addEventListener('click', () => {
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  const escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);

  if (canFeedback) {
    attachFeedbackHandlers(modal, feedbackContext);
  }
}
