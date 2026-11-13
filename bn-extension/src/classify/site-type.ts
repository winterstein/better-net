/**
 * Site-type classifier. Today it answers one question — is this an adult site? — because
 * shared analysis must not send such pages to the server (sharing/share-rules.ts). Every
 * other site is left unknown, which routing and sharing both read as "carry on".
 *
 * Simple on purpose: the page's own label, or the domain. A big unlabelled site belongs
 * on the server's block-list, not in a list here.
 */

import type { Classification, SiteType } from '../types/Classification.js';

/** The site declares it: a rating meta tag or the RTA label. Self-labelling, so it is trusted. */
const CONFIDENCE_LABEL = 0.9;
/** Top-level domains reserved for adult content. */
const CONFIDENCE_TLD = 0.85;

/** The Restricted To Adults label (rtalabel.org): a fixed string sites put in a meta tag. */
const RTA_LABEL = 'RTA-5042-1996-1400-1577-RTA';

const ADULT_TLD = /\.(xxx|adult|porn|sex)$/;

export const UNKNOWN_SITE_TYPE: Classification<SiteType> = { value: 'unknown', confidence: 0, source: 'none' };

/** Never throws: a page we cannot read is `unknown`. */
export function classifySiteType(doc: Document | null, url: string): Classification<SiteType> {
	try {
		for (const meta of doc?.querySelectorAll('meta[name="rating" i]') ?? []) {
			const rating = (meta.getAttribute('content') ?? '').trim();
			if (/^(adult|mature)$/i.test(rating) || rating.toUpperCase() === RTA_LABEL) {
				return { value: 'adult', confidence: CONFIDENCE_LABEL, source: 'rating-meta' };
			}
		}
		if (ADULT_TLD.test(new URL(url).hostname.toLowerCase())) {
			return { value: 'adult', confidence: CONFIDENCE_TLD, source: 'tld' };
		}
	} catch {
		// No usable DOM or url: unknown.
	}
	return UNKNOWN_SITE_TYPE;
}
