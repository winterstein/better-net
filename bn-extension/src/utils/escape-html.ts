/**
 * Escape text for HTML text or attribute context.
 * Prefer textContent when building DOM nodes; use this only for template strings.
 */
export function escapeHtml(text: unknown): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
