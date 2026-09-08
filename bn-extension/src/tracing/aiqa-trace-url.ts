/**
 * Link from a trace id to the AIQA UI, shown on feedback in Developer Mode
 * (specs/feedback.md). Kept out of aiqa-tracer.ts so the content script can use it
 * without pulling in OpenTelemetry.
 */

/** AIQA's UI host. Settings holds the API host (server-aiqa.…), which serves no UI. */
const DEFAULT_AIQA_UI_URL = 'https://aiqa.winterwell.com';

/**
 * @param serverUrl the configured AIQA API url, if any. The UI host is the same host
 *   without the `server-` prefix, so a self-hosted AIQA still links to its own UI.
 * @returns null when there is no trace to link to.
 */
export function aiqaTraceUrl(traceId?: string, serverUrl?: string): string | null {
  if (!traceId) return null;
  let base = DEFAULT_AIQA_UI_URL;
  const configured = serverUrl?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      url.hostname = url.hostname.replace(/^server-/, '');
      base = url.origin;
    } catch {
      // Malformed setting: fall back to the default host rather than a broken link.
    }
  }
  // TODO confirm the trace path against the AIQA UI's own routes.
  return `${base}/trace/${traceId}`;
}
