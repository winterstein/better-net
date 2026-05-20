/**
 * Google Fact Check Tools API Client
 * Queries Google's Fact Check API to verify claims against fact-checked content
 * Browser-agnostic module
 */

import { extractClaims } from './extract-claims.js';
import { FactCheckResults } from './factcheck.js';
import { getGoogleFactCheckKey } from '../../utils/env-utils.js';
import { logit } from '../../utils/logger.js';

const FACT_CHECK_API_BASE = 'https://factchecktools.googleapis.com/v1alpha1';
const MAX_CLAIMS_TO_CHECK = 3; // Limit number of claims to check per chunk
const MIN_CLAIM_LENGTH = 10; // Minimum length for a claim to be worth checking

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
export async function factCheckContent(chunk, pageMetadata = {}, options = {}) {
  const {
    languageCode = 'en',
    maxClaims = MAX_CLAIMS_TO_CHECK
  } = options;

  const apiKey = Object.prototype.hasOwnProperty.call(options, 'apiKey')
    ? options.apiKey
    : getGoogleFactCheckKey();

  if (!apiKey) {
    return new FactCheckResults(
      0.5,
      0.0,
      ['no_api_key'],
      'Google Fact Check API key not configured',
      [],
      {}
    );
  }

  const text = chunk.text || '';
  if (text.length < MIN_CLAIM_LENGTH) {
    return new FactCheckResults(
      0.5,
      0.0,
      ['insufficient_content'],
      'Content too short to fact-check',
      [],
      {}
    );
  }

  // Extract claims from content
  const claims = extractClaims(text);
  
  if (claims.length === 0) {
    return new FactCheckResults(
      0.5,
      0.0,
      ['no_claims_found'],
      'No verifiable claims found in content',
      [],
      {}
    );
  }

  // Search for fact-checks for each claim
  const factCheckResults = [];
  let totalRatingScore = 0;
  let checkedClaims = 0;

  for (const claim of claims.slice(0, maxClaims)) {
    try {
      const result = await searchFactChecks(claim, apiKey, languageCode);
      
      if (result.claims && result.claims.length > 0) {
        factCheckResults.push({
          claim,
          factChecks: result.claims,
          totalResults: result.totalResults
        });

        // Use the first claim's rating as representative
        if (result.claims[0].ratingScore !== undefined) {
          totalRatingScore += result.claims[0].ratingScore;
          checkedClaims++;
        }
      }
    } catch (error) {
      console.error('[BetterNet] [FACT_CHECK] Error checking claim:', claim, error);
    }
  }

  // Calculate overall score
  // Lower score = more false/misleading (inverted for fake news detection)
  // If rating is low (false), fake news score should be high
  const avgRating = checkedClaims > 0 ? totalRatingScore / checkedClaims : 0.5;
  const fakeNewsScore = 1.0 - avgRating; // Invert: false claims = high fake news score

  // Generate flags and explanation
  const flags = [];
  if (factCheckResults.length === 0) {
    flags.push('no_fact_checks_found');
  } else {
    flags.push('fact_checked');
    if (avgRating < 0.3) {
      flags.push('mostly_false');
    } else if (avgRating < 0.5) {
      flags.push('partially_false');
    } else if (avgRating > 0.7) {
      flags.push('mostly_true');
    }
  }

  const explanation = generateExplanation(factCheckResults, avgRating, fakeNewsScore);

  return new FactCheckResults(
    fakeNewsScore,
    factCheckResults.length > 0 ? 0.8 : 0.3,
    flags,
    explanation,
    factCheckResults,
    {
      claimsChecked: claims.length,
      factChecksFound: factCheckResults.length,
      averageRating: avgRating
    }
  );
}

/**
 * Generate explanation from fact-check results
 * @param {Array<Object>} factCheckResults - Fact-check results
 * @param {number} avgRating - Average rating score
 * @param {number} fakeNewsScore - Calculated fake news score
 * @returns {string} Human-readable explanation
 */
function generateExplanation(factCheckResults, avgRating, fakeNewsScore) {
  if (factCheckResults.length === 0) {
    return 'No fact-checks found for claims in this content. Unable to verify claims independently.';
  }

  const totalChecks = factCheckResults.reduce((sum, result) => sum + result.totalResults, 0);
  
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

