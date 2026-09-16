import type { TopLevelItem } from "./TopLevelItem.js";
import type { Classification, PageType, SiteType } from "./Classification.js";

/**
 * Page metadata extracted from the page
 */
export interface PageMetadata {
	url: string;
	title?: string;
	domain?: string;
	author?: string;
	description?: string;
	/**
	 * Content Classifier output (specs/content-classification.md). Absent = unknown, which
	 * routing reads as "analyze anyway" rather than as a reason to skip. No classifier
	 * populates these yet — the routing that consumes them is in features/module-routing.ts.
	 */
	pageType?: Classification<PageType>;
	siteType?: Classification<SiteType>;
  }

export interface Page extends TopLevelItem, PageMetadata {
}
