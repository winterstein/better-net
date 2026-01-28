import type { TopLevelItem } from "./TopLevelItem.js";

/**
 * Page metadata extracted from the page
 */
export interface PageMetadata {
	url: string;
	title?: string;
	domain?: string;
	author?: string;
	description?: string;
  }

export interface Page extends TopLevelItem, PageMetadata {
}