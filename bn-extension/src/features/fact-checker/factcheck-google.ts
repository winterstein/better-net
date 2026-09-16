/**
 * Google Fact Check Tools API Client
 * Queries Google's Fact Check API to verify claims against fact-checked content
 * Browser-agnostic module
 */

import { extractClaims } from './extract-claims.js';
import type { ModuleAnalysis } from '../../types/ModuleAnalysis.js';
import { getGoogleFactCheckKey } from '../../utils/env-utils.js';
import { logit } from '../../utils/logger.js';
import { normalizeIssueTags, problemScoreFromFraction } from '../../types/Score.js';

const FACT_CHECK_API_BASE = 'https://factchecktools.googleapis.com/v1alpha1';
const MAX_CLAIMS_TO_CHECK = 3; // Limit number of claims to check per chunk
const MIN_CLAIM_LENGTH = 10; // Minimum length for a claim to be worth checking

/** How one claim's lookup went. `unverified` is the common case: nobody has fact-checked it. */
export type ClaimCheckStatus = 'checked' | 'unverified' | 'error';

/**
 * One extracted claim and what came back for it. Every claim we looked at gets one of
 * these, including the ones nothing came back for — the modal and the popup list them,
 * and a claim missing from the list reads as a claim we never checked.
 */
export interface ClaimCheck {
	claim: string;
	status: ClaimCheckStatus;
	/** Matching fact-checked claims from Google, each with its own `claimReview` list. */
	factChecks: unknown[];
	totalResults: number;
	/** Why the lookup failed, when `status` is `error`. */
	error?: string;
}

/**
 * Search for fact-checks related to a claim
 * @param {string} query - The claim or query to search for
 * @param {string} apiKey - Google Fact Check API key
 * @param {string} languageCode - Language code (default: 'en')
 * @returns {Promise<Object>} Fact check results
 */
export async function searchFactChecks(query, apiKey, languageCode = 'en') {
  if (!apiKey) {
    throw new Error('Google Fact Check API key is required');
  }
  logit('log', '[FACT_CHECK via Google] Searching fact checks for query:', query);
  if (!query || query.trim().length < MIN_CLAIM_LENGTH) {
    return {
      claims: [],
      totalResults: 0,
      error: 'Query too short'
    };
  }

  try {
    const url = new URL(`${FACT_CHECK_API_BASE}/claims:search`);
    url.searchParams.append('query', query.trim());
    url.searchParams.append('languageCode', languageCode);
    url.searchParams.append('key', apiKey);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fact Check API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const parsedData = parseFactCheckResponse(data);
    logit('log', '[FACT_CHECK via Google] Parsed fact check response:', parsedData);
    return parsedData;
  } catch (error) {
    console.error('[BetterNet] [FACT_CHECK] Error searching fact checks:', error);
    return {
      claims: [],
      totalResults: 0,
      error: error.message || 'Failed to search fact checks'
    };
  }
}

/**
 * Parse Google Fact Check API response (why not just use as-is??)
 * @param {Object} data - Raw API response
 * @returns {Object} Parsed fact check results
 */
function parseFactCheckResponse(data) {
  if (!data || !data.claims) {
    return {
      claims: [],
      totalResults: 0
    };
  }

  const parsedClaims = data.claims.map(claim => ({
    text: claim.text || '',
    claimant: claim.claimant || '',
    claimDate: claim.claimDate || '',
    claimReview: (claim.claimReview || []).map(review => ({
      publisher: review.publisher?.name || 'Unknown',
      url: review.url || '',
      title: review.title || '',
      reviewDate: review.reviewDate || '',
      textualRating: review.textualRating || '',
      languageCode: review.languageCode || 'en'
    })),
    // Calculate overall rating score (0 = false, 1 = true, 0.5 = unverified/mixed)
    ratingScore: calculateRatingScore(claim.claimReview || [])
  }));

  return {
    claims: parsedClaims,
    totalResults: parsedClaims.length,
    nextPageToken: data.nextPageToken || null
  };
}

/**
 * Calculate a numeric rating score from claim reviews
 * @param {Array<Object>} reviews - Array of claim review objects
 * @returns {number} Score between 0 (false) and 1 (true)
 */
function calculateRatingScore(reviews) {
  if (!reviews || reviews.length === 0) {
    return 0.5; // Unknown/unverified
  }

  // Map textual ratings to numeric scores
  const ratingMap = {
    'false': 0.0,
    'mostly false': 0.2,
    'mixture': 0.5,
    'half true': 0.5,
    'mostly true': 0.8,
    'true': 1.0,
    'pants on fire': 0.0
  };

  // Get average rating from all reviews
  const scores = reviews
    .map(review => {
      const rating = (review.textualRating || '').toLowerCase();
      return ratingMap[rating] !== undefined ? ratingMap[rating] : 0.5;
    })
    .filter(score => score !== undefined);

  if (scores.length === 0) {
    return 0.5;
  }

  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Fact-check content using Google Fact Check API
 * @param {Object} chunk - Content chunk with text
 * @param {Object} pageMetadata - Page metadata
 * @param {Object} options - Options with optional apiKey (will be fetched from env-utils if not provided)
 * @returns {Promise<Object>} Fact-check results
 */
export async function factCheckContent(chunk, pageMetadata: any = {}, options: any = {}) {
  const {
    languageCode = 'en',
    maxClaims = MAX_CLAIMS_TO_CHECK
  } = options;

  const apiKey = Object.prototype.hasOwnProperty.call(options, 'apiKey')
    ? options.apiKey
    : getGoogleFactCheckKey();

  if (!apiKey) {
    return {
      problemScore: problemScoreFromFraction(0.5),
      confidence: 0.0,
      tags: [],
      explanation: 'Google Fact Check API key not configured',
      metadata: { factChecks: [], diagnostic: 'no_api_key' },
    } satisfies Partial<ModuleAnalysis>;
  }

  const text = chunk.text || '';
  if (text.length < MIN_CLAIM_LENGTH) {
    return {
      problemScore: problemScoreFromFraction(0.5),
      confidence: 0.0,
      tags: [],
      explanation: 'Content too short to fact-check',
      metadata: { factChecks: [], diagnostic: 'insufficient_content' },
    } satisfies Partial<ModuleAnalysis>;
  }

  // Extract claims from content
  const claims = extractClaims(text);
  
  if (claims.length === 0) {
    return {
      problemScore: problemScoreFromFraction(0.2),
      confidence: 0.6,
      tags: normalizeIssueTags(['no-claims'], 'high', 0.6),
      explanation: 'No verifiable claims found in content',
      metadata: { factChecks: [] },
    } satisfies Partial<ModuleAnalysis>;
  }

  // Search for fact-checks for each claim. Every claim gets an entry, matched or not:
  // "we looked and found nothing" is a different thing to say than saying nothing.
  const claimChecks: ClaimCheck[] = [];
  let totalRatingScore = 0;
  let checkedClaims = 0;

  for (const claim of claims.slice(0, maxClaims)) {
    let result;
    try {
      result = await searchFactChecks(claim, apiKey, languageCode);
    } catch (error) {
      console.error('[BetterNet] [FACT_CHECK] Error checking claim:', claim, error);
      claimChecks.push({ claim, status: 'error', factChecks: [], totalResults: 0, error: error.message });
      continue;
    }

    const matches = result.claims ?? [];
    if (matches.length === 0) {
      claimChecks.push({
        claim,
        // searchFactChecks reports a failed lookup rather than throwing, so an error here
        // means "we could not check", not "nobody has checked it".
        status: result.error ? 'error' : 'unverified',
        factChecks: [],
        totalResults: 0,
        error: result.error,
      });
      continue;
    }

    claimChecks.push({
      claim,
      status: 'checked',
      factChecks: matches,
      totalResults: result.totalResults ?? matches.length,
    });
    // Use the first match's rating as representative
    if (matches[0].ratingScore !== undefined) {
      totalRatingScore += matches[0].ratingScore;
      checkedClaims++;
    }
  }

  const factCheckResults = claimChecks.filter((c) => c.factChecks.length > 0);

  // Calculate overall score
  // Lower score = more false/misleading (inverted for fake news detection)
  // If rating is low (false), fake news score should be high
  const avgRating = checkedClaims > 0 ? totalRatingScore / checkedClaims : 0.5;
  const fakeNewsScore = 1.0 - avgRating; // Invert: false claims = high fake news score

  const tags: string[] = [];
  const metadata: Record<string, unknown> = {
    factChecks: claimChecks,
    claimsChecked: claimChecks.length,
    factChecksFound: factCheckResults.length,
    averageRating: avgRating,
  };
  if (factCheckResults.length === 0) {
    tags.push('suspect-claim');
    metadata.diagnostic = 'no_fact_checks_found';
  } else if (avgRating < 0.3) {
    tags.push('false-claim');
  } else if (avgRating < 0.5) {
    tags.push('suspect-claim');
  } else if (avgRating > 0.7) {
    tags.push('verified-claims');
  }

  const explanation = generateExplanation(claimChecks, avgRating);

  return {
    problemScore: problemScoreFromFraction(fakeNewsScore),
    confidence: factCheckResults.length > 0 ? 0.8 : 0.3,
    tags: normalizeIssueTags(tags, 'medium', 0.6),
    explanation,
    metadata,
  } satisfies Partial<ModuleAnalysis>;
}

/**
 * Generate explanation from fact-check results. Says how many claims were looked up, so
 * "nothing found" reads as a search that happened rather than a module that did nothing.
 * @param {ClaimCheck[]} claimChecks - Every claim looked up, matched or not
 * @param {number} avgRating - Average rating score
 * @returns {string} Human-readable explanation
 */
function generateExplanation(claimChecks: ClaimCheck[], avgRating: number): string {
  const matched = claimChecks.filter((c) => c.factChecks.length > 0);
  const failed = claimChecks.filter((c) => c.status === 'error');

  if (matched.length === 0) {
    const claimCount = `${claimChecks.length} claim${claimChecks.length === 1 ? '' : 's'}`;
    if (failed.length === claimChecks.length && failed.length > 0) {
      return `Could not reach fact-check sources for ${claimCount} in this content. Unable to verify independently.`;
    }
    return `Checked ${claimCount} against fact-check sources; none of them have been fact-checked. Unable to verify independently.`;
  }

  const totalChecks = matched.reduce((sum, result) => sum + result.totalResults, 0);
  
  if (avgRating < 0.3) {
    return `Fact-checked: Found ${totalChecks} fact-check(s) indicating claims are mostly FALSE or MISLEADING. Exercise extreme caution.`;
  } else if (avgRating < 0.5) {
    return `Fact-checked: Found ${totalChecks} fact-check(s) with mixed or unverified ratings. Verify claims independently.`;
  } else if (avgRating > 0.7) {
    return `Fact-checked: Found ${totalChecks} fact-check(s) indicating claims are mostly TRUE. Content appears credible.`;
  } else {
    return `Fact-checked: Found ${totalChecks} fact-check(s) for claims in this content. Review ratings carefully.`;
  }
}

