// Content Analysis detail modal (opened from chunk nutrition badge)

import type { AspectAnalysis } from '../types/AspectAnalysis.js';
import type { ChunkAnalysis } from '../types/ChunkAnalysis.js';
import { chunkProblemScore } from '../types/ChunkAnalysis.js';

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
  if (score >= 0.7) {
    return { color: '#f44336', border: '#d32f2f', label: 'High Risk' };
  }
  if (score >= 0.4) {
    return { color: '#ff9800', border: '#f57c00', label: 'Caution' };
  }
  return { color: '#4CAF50', border: '#388e3c', label: 'Safe' };
}

export function calculateNutritionData(analyses: AspectAnalysis[]): NutritionData {
  const scores: { type: string; score: number }[] = [];
  const flags: string[] = [];

  analyses.forEach((analysis) => {
    if (!analysis.error && typeof analysis.problemScore === 'number') {
      const type = String(analysis.metadata?.moduleId ?? analysis.methodName);
      scores.push({ type, score: analysis.problemScore });
      if (analysis.flags?.length) {
        flags.push(...analysis.flags);
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

function renderFeedbackRow(type: string, score: number): string {
  return `
    <div data-feedback-row style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px;">
      <div style="font-size: 11px; color: #666; margin-bottom: 6px;">Does this assessment fit?</div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button type="button" data-feedback-btn data-module-id="${escapeHtml(type)}" data-applies="true" data-score="${score}" title="Yes, this applies" style="
          border: 1px solid #c8e6c9;
          background: #f1f8e9;
          border-radius: 6px;
          padding: 4px 10px;
          cursor: pointer;
          font-size: 14px;
        ">👍</button>
        <button type="button" data-feedback-btn data-module-id="${escapeHtml(type)}" data-applies="false" data-score="${score}" title="No, this does not apply" style="
          border: 1px solid #ffcdd2;
          background: #ffebee;
          border-radius: 6px;
          padding: 4px 10px;
          cursor: pointer;
          font-size: 14px;
        ">👎</button>
        <span data-feedback-status style="font-size: 11px; color: #666;"></span>
      </div>
      <details style="margin-top: 6px; font-size: 12px;">
        <summary style="cursor: pointer; color: #555;">Add a note (optional)</summary>
        <textarea data-feedback-message rows="2" maxlength="500" placeholder="What seems off?" style="
          width: 100%;
          margin-top: 6px;
          padding: 6px 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 12px;
          resize: vertical;
          box-sizing: border-box;
        "></textarea>
      </details>
    </div>
  `;
}

function attachFeedbackHandlers(
  modal: HTMLElement,
  ctx: { fingerprint: string; url: string; title?: string }
): void {
  modal.querySelectorAll('[data-feedback-btn]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      const card = el.closest('[data-analysis-card]') as HTMLElement | null;
      const statusEl = card?.querySelector('[data-feedback-status]') as HTMLElement | null;
      const messageEl = card?.querySelector('[data-feedback-message]') as HTMLTextAreaElement | null;
      const moduleId = el.dataset.moduleId || '';
      const applies = el.dataset.applies === 'true';
      const problemScore = Number(el.dataset.score || '0');

      if (statusEl) statusEl.textContent = 'Sending…';
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'BN_SUBMIT_FEEDBACK',
          payload: {
            chunkFingerprint: ctx.fingerprint,
            chunkUrl: ctx.url,
            chunkTitle: ctx.title,
            moduleId,
            applies,
            message: applies ? undefined : messageEl?.value?.trim(),
            problemScore,
          },
        });
        if (res?.ok) {
          if (statusEl) statusEl.textContent = 'Thanks for your feedback!';
        } else if (statusEl) {
          statusEl.textContent = res?.error || 'Could not send feedback';
        }
      } catch {
        if (statusEl) statusEl.textContent = 'Could not send feedback';
      }
    });
  });
}

function formatAnalysisExplanation(result: AspectAnalysis): string {
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

/** Show or replace the Content Analysis detail modal for a chunk. */
export function showContentAnalysisModal(analysisResults: Partial<ChunkAnalysis>): void {
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
  } = analysisResults;
  const problemScore = chunkProblemScore(analysisResults);
  const canFeedback = feedbackEnabled && fingerprint && url;
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
        </div>

        ${
          tags.length > 0
            ? `
        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #333;">Tags</h3>
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
    const score = result.error ? 0 : (result.problemScore || 0);
    const scorePercent = (score * 100).toFixed(0);
    const barColor = score >= 0.7 ? '#f44336' : score >= 0.4 ? '#ff9800' : '#4CAF50';

    const factChecks = result.metadata?.factChecks;
    const hasFactChecks =
      moduleId === 'factChecker' &&
      Array.isArray(factChecks) &&
      factChecks.length > 0;
    const factCheckHTML = hasFactChecks ? renderFactCheckClaims(factChecks as unknown[]) : '';
    const explanationHtml = formatAnalysisExplanation(result);
    const flags = result.flags;

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
              ${flags && flags.length > 0 ? `
                <div style="margin-top: 8px;">
                  ${flags.map(flag => `
                    <span style="
                      display: inline-block;
                      background: #f5f5f5;
                      padding: 2px 8px;
                      border-radius: 4px;
                      font-size: 11px;
                      color: #666;
                      margin-right: 4px;
                      margin-top: 4px;
                    ">${escapeHtml(flag)}</span>
                  `).join('')}
                </div>
              ` : ''}
              ${factCheckHTML}
              ${canFeedback ? renderFeedbackRow(moduleId, score) : ''}
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
    attachFeedbackHandlers(modal, { fingerprint: fingerprint!, url: url!, title });
  }
}
