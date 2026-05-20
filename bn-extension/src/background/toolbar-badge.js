/**
 * Toolbar icon badge — subtle per-tab status (AdBlock-style).
 * Progress and counts live here; details are in the popup.
 */

const COLORS = {
  analyzing: '#1976D2',
  safe: '#4CAF50',
  caution: '#FF9800',
  highRisk: '#E53935',
  off: '#9E9E9E',
  error: '#E53935',
};

function formatCount(n) {
  if (n == null || n <= 0) return '';
  return n > 999 ? '999+' : String(n);
}

/**
 * @param {number} tabId
 * @param {Object} opts
 * @param {'analyzing'|'completed'|'excluded'|'error'|'no_chunks'|'idle'} opts.status
 * @param {number} [opts.progress]
 * @param {number} [opts.neutralisedCount]
 * @param {number} [opts.adsHidden]
 * @param {string} [opts.summaryOverall]
 * @param {boolean} [opts.siteEnabled]
 */
export function updateToolbarBadge(tabId, opts) {
  if (tabId == null) return;

  const {
    status,
    progress = 0,
    neutralisedCount = 0,
    adsHidden = 0,
    summaryOverall,
    siteEnabled = true,
  } = opts;

  const flagged = neutralisedCount + adsHidden;

  let text = '';
  let color = COLORS.safe;
  let title = 'BetterNet';

  if (!siteEnabled || status === 'excluded') {
    text = '';
    color = COLORS.off;
    title = 'BetterNet is off for this site';
  } else if (status === 'error') {
    text = '!';
    color = COLORS.error;
    title = 'BetterNet — analysis failed';
  } else if (status === 'no_chunks') {
    text = '';
    color = COLORS.off;
    title = 'BetterNet — no content to analyze';
  } else if (status === 'analyzing') {
    text = '…';
    color = COLORS.analyzing;
    title = `BetterNet — analyzing page (${progress}%)`;
  } else if (status === 'completed') {
    text = formatCount(flagged);
    if (summaryOverall === 'high-risk') color = COLORS.highRisk;
    else if (summaryOverall === 'caution') color = COLORS.caution;
    else color = COLORS.safe;

    if (flagged > 0) {
      const parts = [];
      if (neutralisedCount > 0) parts.push(`${neutralisedCount} labelled`);
      if (adsHidden > 0) parts.push(`${adsHidden} ads hidden`);
      title = `BetterNet — ${parts.join(', ')} on this page`;
    } else {
      title = 'BetterNet — analysis complete, nothing flagged';
    }
  } else if (status === 'idle') {
    text = '';
    color = COLORS.off;
    title = 'BetterNet';
  }

  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setTitle({ title, tabId });
}

export function clearToolbarBadge(tabId) {
  updateToolbarBadge(tabId, { status: 'idle' });
}
