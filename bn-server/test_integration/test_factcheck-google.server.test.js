/**
 * Server-side tap tests for Google Fact Check API
 * These tests make real API calls and require a Google Fact Check API key.
 * 
 * To run these tests:
 * 1. Get a Google Fact Check API key from: https://console.cloud.google.com/apis/api/factchecktools.googleapis.com
 * 2. Set: export BN_GOOGLE_API_KEY=your-api-key-here
 *    OR place the key in auth.txt file in the project root (as BN_GOOGLE_API_KEY=your-key)
 * 3. Run: npm test
 * 
 * Note: These tests make real API calls and may consume API quota
 */

import tap from 'tap';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractClaims } from '../../better-net/src/factcheck/extract-claims.js';
import { searchFactChecks, factCheckContent } from '../../better-net/src/factcheck/factcheck-google.js';

// Load .env and .env.test for test configuration
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.test', override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get API key from environment variable or auth.txt
const API_KEY = process.env.BN_GOOGLE_API_KEY;

/**
 * Check if API key is available
 */
function hasApiKey() {
  return !!API_KEY && API_KEY.length > 0;
}

tap.test('API key is available', t => {	
  t.ok(API_KEY, 'API key should be available');
  t.end();
});

// Extract Claims Tests
tap.test('extractClaims - news article style text', t => {
  const text = `According to a new study published in Nature, climate change is accelerating faster than previously predicted. 
    Scientists say that the Earth's temperature has increased by 1.5 degrees Celsius. 
    Research indicates that this is primarily due to human activity. 
    Experts claim that immediate action is required to prevent catastrophic consequences.`;
  
  const claims = extractClaims(text);
  
  t.ok(claims.length > 0 && claims.length <= 3, 'Should extract 1-3 claims from news article');
  t.end();
});

tap.test('extractClaims - social media style text', t => {
  const text = 'OMG you won\'t believe this! Doctors hate this one secret trick! This is a proven fact that will shock you!';
  
  const claims = extractClaims(text);
  
  t.ok(claims.length > 0, 'Should extract claims from social media text');
  t.end();
});

tap.test('extractClaims - mixed content', t => {
  const text = `The weather is nice today. According to experts, this is normal for this time of year. 
    Studies show that seasonal patterns are changing. I went to the store earlier.`;
  
  const claims = extractClaims(text);
  
  t.ok(claims.length > 0 && claims.length <= 3, 'Should extract claims from mixed content');
  t.end();
});

// Search Fact Checks Tests
tap.test('searchFactChecks - well-known fact-checked claim', async t => {
  if (!hasApiKey()) {
    t.skip('No API key available');
    return;
  }

  const query = 'vaccines cause autism';
  const result = await searchFactChecks(query, API_KEY, 'en');
  
  if (result.error) {
    // Check for temporary service errors (503, 429) vs permanent errors
    if (result.error.includes('503') || result.error.includes('Service Unavailable')) {
      t.skip('Service temporarily unavailable');
      return;
    }
    // Authentication/permission errors should cause test failure
    t.fail(`Authentication/API error: ${result.error}`);
    if (result.error.includes('SERVICE_DISABLED') || result.error.includes('has not been used')) {
      t.comment('The Fact Check Tools API is not enabled for this project.');
      t.comment('Enable it at: https://console.cloud.google.com/apis/api/factchecktools.googleapis.com');
    }
  } else {
    t.ok(result.claims && Array.isArray(result.claims), 'Should return claims array');
    if (result.claims.length > 0) {
      t.ok(result.claims[0].text, 'First claim should have text');
    }
  }
  t.end();
});

tap.test('searchFactChecks - unlikely claim (no results)', async t => {
  if (!hasApiKey()) {
    t.skip('No API key available');
    return;
  }

  const query = 'xyzabc123 random claim that probably does not exist in fact check database';
  const result = await searchFactChecks(query, API_KEY, 'en');
  
  if (result.error) {
    if (result.error.includes('SERVICE_DISABLED') || result.error.includes('has not been used')) {
      t.fail(`Authentication/API error: ${result.error}`);
    } else {
      t.fail(`Unexpected error: ${result.error}`);
    }
  } else {
    t.ok(result.claims && Array.isArray(result.claims), 'Should return claims array (even if empty)');
  }
  t.end();
});

tap.test('searchFactChecks - with language code', async t => {
  if (!hasApiKey()) {
    t.skip('No API key available');
    return;
  }

  const query = 'climate change is real and caused by human activity';
  const result = await searchFactChecks(query, API_KEY, 'en');
  
  if (result.error) {
    if (result.error.includes('SERVICE_DISABLED') || result.error.includes('has not been used')) {
      t.fail(`Authentication/API error: ${result.error}`);
    } else {
      t.fail(`Unexpected error: ${result.error}`);
    }
  } else {
    t.ok(result.claims && Array.isArray(result.claims), 'Should return claims array');
  }
  t.end();
});

// Fact Check Content Tests
tap.test('factCheckContent - false claim', async t => {
  if (!hasApiKey()) {
    t.skip('No API key available');
    return;
  }

  const chunk = {
    text: 'According to experts, vaccines cause autism. This is a proven fact that has been verified by multiple studies.',
    id: 'test-1'
  };
  
  const result = await factCheckContent(chunk, {}, {
    apiKey: API_KEY,
    languageCode: 'en'
  });
  
  t.ok(result.score !== undefined, 'Should have score');
  t.ok(result.confidence !== undefined, 'Should have confidence');
  t.ok(result.flags, 'Should have flags');
  t.ok(Array.isArray(result.flags), 'Flags should be an array');
  t.ok(Array.isArray(result.factChecks), 'Should have factChecks array');
  
  if (result.metadata) {
    t.ok(typeof result.metadata.claimsChecked === 'number', 'Should have claimsChecked in metadata');
  }
  
  t.end();
});

tap.test('factCheckContent - true claim', async t => {
  if (!hasApiKey()) {
    t.skip('No API key available');
    return;
  }

  const chunk = {
    text: 'Studies show that climate change is real and caused by human activity. Scientists agree on this fact.',
    id: 'test-2'
  };
  
  const result = await factCheckContent(chunk, {}, {
    apiKey: API_KEY,
    languageCode: 'en'
  });
  
  t.ok(result.score !== undefined, 'Should have score');
  t.ok(result.confidence !== undefined, 'Should have confidence');
  t.ok(Array.isArray(result.factChecks), 'Should have factChecks array');
  
  t.end();
});

tap.test('factCheckContent - multiple claims', async t => {
  if (!hasApiKey()) {
    t.skip('No API key available');
    return;
  }

  const chunk = {
    text: 'According to research, the Earth is round. Studies show that vaccines are safe. Experts claim that climate change is real.',
    id: 'test-3'
  };
  
  const result = await factCheckContent(chunk, {}, {
    apiKey: API_KEY,
    languageCode: 'en',
    maxClaims: 3
  });
  
  t.ok(result.metadata, 'Should have metadata');
  if (result.metadata) {
    t.ok(result.metadata.claimsChecked > 0, 'Should have checked at least one claim');
    t.ok(typeof result.metadata.factChecksFound === 'number', 'Should have factChecksFound in metadata');
  }
  
  t.end();
});

tap.test('factCheckContent - invalid API key handling', async t => {
  const chunk = {
    text: 'This is a test claim that should fail with invalid key.',
    id: 'test-4'
  };
  
  const result = await factCheckContent(chunk, {}, {
    apiKey: 'invalid-key-12345',
    languageCode: 'en'
  });
  
  // Should handle error gracefully - the function catches API errors and returns
  // a result with no_fact_checks_found flag, which is acceptable behavior
  const hasErrorHandling = result.error || 
    result.flags?.includes('no_api_key') || 
    result.flags?.includes('no_fact_checks_found') || 
    result.confidence === 0;
  
  t.ok(hasErrorHandling, 'Should handle invalid API key gracefully');
  
  t.end();
});
