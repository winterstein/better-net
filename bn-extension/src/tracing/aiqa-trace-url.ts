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
 * @param organisationId the AIQA organisation the traces belong to (Settings → Advanced).
 * @returns null when there is nothing to link to — no trace, or no organisation.
 */
export function aiqaTraceUrl(
	traceId?: string,
	serverUrl?: string,
	organisationId?: string
): string | null {
	if (!traceId) return null;
	/*
	 * The UI has no route for a bare trace id. `/organisation/:organisationId/traces/:traceId`
	 * is the only way in (aiqa webapp/src/pages/app.tsx), and every unmatched path redirects
	 * to the login page — so without the organisation there is no link to offer, only a
	 * dead one. The caller shows the copyable trace id instead.
	 */
	const org = organisationId?.trim();
	if (!org) return null;

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
	return `${base}/organisation/${encodeURIComponent(org)}/traces/${encodeURIComponent(traceId)}`;
}
