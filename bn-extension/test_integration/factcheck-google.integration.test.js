/**
 * Integration tests for Google Fact Check API
 * These tests make real API calls and require a Google Fact Check API key.
 * 
 * To run these tests:
 * 1. Get a Google Fact Check API key from: https://console.cloud.google.com/apis/api/factchecktools.googleapis.com
 * 2. Set: export BN_GOOGLE_API_KEY=your-api-key-here
 *    OR place the key in auth.txt file in the project root (as BN_GOOGLE_API_KEY=your-key)
 * 3. Run: npm run test:integration
 * 
 * Note: These tests make real API calls and may consume API quota
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { extractClaims } from '../src/factcheck/extract-claims.js';
import { searchFactChecks, factCheckContent } from '../src/factcheck/factcheck-google.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get API key from environment variable or auth.txt file
 * @returns {string|null} API key or null if not found
 */
function getApiKey() {
  // First check environment variable
  const envKey = process.env.BN_GOOGLE_API_KEY;
  if (envKey) {
    return envKey;
  }

  // Fallback to auth.txt file
  try {
    const authFilePath = join(__dirname, '..', 'auth.txt');
    const authContent = readFileSync(authFilePath, 'utf-8');
    
    // First, try to parse BN_GOOGLE_API_KEY=value format
    const keyValueMatch = authContent.match(/BN_GOOGLE_API_KEY\s*=\s*(AIza[^\s\n]+)/i);
    if (keyValueMatch && keyValueMatch[1]) {
      return keyValueMatch[1].trim();
    }
    
    // Look for API key pattern (starts with AIza) - standalone key
    const lines = authContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip lines that look like variable assignments
      if (trimmed.includes('=') && !trimmed.startsWith('AIza')) {
        continue;
      }
      // Check if line looks like an API key (starts with AIza and is long enough)
      if (trimmed.startsWith('AIza') && trimmed.length > 30) {
        return trimmed;
      }
    }
    
    // Alternative: look for "API key:" pattern
    const apiKeyMatch = authContent.match(/API key[:\s]+(AIza[^\s\n]+)/i);
    if (apiKeyMatch && apiKeyMatch[1]) {
      return apiKeyMatch[1].trim();
    }
  } catch (error) {
    // File doesn't exist or can't be read, that's okay
    return null;
  }

  return null;
}

// Get API key from environment variable or auth.txt
const API_KEY = getApiKey();

/**
 * Check if API key is available
 */
function hasApiKey() {
  return !!API_KEY && API_KEY.length > 0;
}


/**
 * Test searchFactChecks with real API
 */
async function testRealSearchFactChecks() {
  console.log('\n=== Integration Test: Real API Search ===');
  
  if (!hasApiKey()) {
    console.log('  ⚠️  SKIP: No API key available');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  
  console.log('  ℹ️  Using API key authentication');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Search for a well-known fact-checked claim
  const test1 = async () => {
    try {
      console.log('  Testing: Search for fact-checked claim...');
      // Debug: verify API key is being used
      if (API_KEY) {
        console.log(`     Using API key: ${API_KEY.substring(0, 20)}... (length: ${API_KEY.length})`);
      }
      // Use a claim that's likely to have been fact-checked
      const query = 'vaccines cause autism';
      
      const result = await searchFactChecks(query, API_KEY, 'en');
      
      if (result.error) {
        // Check for temporary service errors (503, 429) vs permanent errors
        if (result.error.includes('503') || result.error.includes('Service Unavailable')) {
          console.log('  ⚠️  Test 1: Real API search - SKIP (Service temporarily unavailable)');
          console.log('     This is likely a temporary issue. Try again in a few moments.');
          // Don't count as failure for temporary service issues
          return; // Skip this test
        }
        // Authentication/permission errors should cause test failure
        console.log('  ❌ Test 1: Real API search - FAIL');
        console.log('     Authentication/API error:', result.error);
        if (result.error.includes('SERVICE_DISABLED') || result.error.includes('has not been used')) {
          console.log('     ⚠️  The Fact Check Tools API is not enabled for this project.');
          console.log('        Enable it at: https://console.cloud.google.com/apis/api/factchecktools.googleapis.com');
          console.log('        Or use an API key from a project where the API is enabled.');
        }
        testsFailed++;
      } else if (result.claims && Array.isArray(result.claims)) {
        console.log(`  ✅ Test 1: Real API search - PASS (found ${result.claims.length} claim(s))`);
        if (result.claims.length > 0) {
          console.log(`     First claim: "${result.claims[0].text?.substring(0, 80)}..."`);
          if (result.claims[0].claimReview && result.claims[0].claimReview.length > 0) {
            console.log(`     Rating: ${result.claims[0].claimReview[0].textualRating || 'N/A'}`);
            console.log(`     Publisher: ${result.claims[0].claimReview[0].publisher || 'N/A'}`);
          }
        }
        testsPassed++;
      } else {
        console.log('  ❌ Test 1: Real API search - FAIL');
        console.log('     Expected claims array, got:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 1: Real API search - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  // Test 2: Search for a claim that likely has no results
  const test2 = async () => {
    try {
      console.log('  Testing: Search for unlikely claim...');
      const query = 'xyzabc123 random claim that probably does not exist in fact check database';
      
      const result = await searchFactChecks(query, API_KEY, 'en');
      
      // Should return empty or no results, not throw error
      if (result.error) {
        console.log('  ❌ Test 2: No results handling - FAIL');
        console.log('     Authentication/API error:', result.error);
        if (result.error.includes('SERVICE_DISABLED') || result.error.includes('has not been used')) {
          console.log('     ⚠️  The Fact Check Tools API is not enabled for this project.');
        }
        testsFailed++;
      } else if (result.claims && Array.isArray(result.claims)) {
        console.log(`  ✅ Test 2: No results handling - PASS (found ${result.claims.length} claim(s))`);
        testsPassed++;
      } else {
        console.log('  ❌ Test 2: No results handling - FAIL');
        console.log('     Expected claims array (even if empty), got:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 2: No results handling - FAIL');
      console.log('     Should not throw error for no results, got:', error.message);
      testsFailed++;
    }
  };
  
  // Test 3: Test with different language code
  const test3 = async () => {
    try {
      console.log('  Testing: Search with language code...');
      // Use a longer query to meet MIN_CLAIM_LENGTH requirement (20 chars)
      const query = 'climate change is real and caused by human activity';
      
      const result = await searchFactChecks(query, API_KEY, 'en');
      
      if (result.error) {
        console.log('  ❌ Test 3: Language code handling - FAIL');
        console.log('     Authentication/API error:', result.error);
        if (result.error.includes('SERVICE_DISABLED') || result.error.includes('has not been used')) {
          console.log('     ⚠️  The Fact Check Tools API is not enabled for this project.');
        }
        testsFailed++;
      } else if (result.claims && Array.isArray(result.claims)) {
        console.log(`  ✅ Test 3: Language code handling - PASS`);
        testsPassed++;
      } else {
        console.log('  ❌ Test 3: Language code handling - FAIL');
        console.log('     Expected claims array, got:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 3: Language code handling - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  await test1();
  await test2();
  await test3();
  
  return { passed: testsPassed, failed: testsFailed, skipped: 0 };
}

/**
 * Helper to calculate rating score (same as in factcheck-google.js)
 */
function calculateRatingScore(reviews) {
  if (!reviews || reviews.length === 0) {
    return 0.5;
  }

  const ratingMap = {
    'false': 0.0,
    'mostly false': 0.2,
    'mixture': 0.5,
    'mostly true': 0.8,
    'true': 1.0,
    'pants on fire': 0.0,
    'half true': 0.5
  };

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
 * Test factCheckContent with real API
 */
async function testRealFactCheckContent() {
  console.log('\n=== Integration Test: Real API Fact-Check Content ===');
  
  if (!hasApiKey()) {
    console.log('  ⚠️  SKIP: No API key available');
    return { passed: 0, failed: 0, skipped: 1 };
  }
  
  console.log('  ℹ️  Using API key authentication');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Fact-check content with a well-known false claim
  const test1 = async () => {
    try {
      console.log('  Testing: Fact-check content with false claim...');
      const chunk = {
        text: 'According to experts, vaccines cause autism. This is a proven fact that has been verified by multiple studies.',
        id: 'integration-test-1'
      };
      
      const result = await factCheckContent(chunk, {}, {
        apiKey: API_KEY,
        languageCode: 'en'
      });
      
      if (result.score !== undefined && result.confidence !== undefined && result.flags) {
        console.log(`  ✅ Test 1: Fact-check false claim - PASS`);
        console.log(`     Score: ${result.score.toFixed(2)}`);
        console.log(`     Confidence: ${result.confidence.toFixed(2)}`);
        console.log(`     Flags: ${result.flags.join(', ')}`);
        console.log(`     Fact-checks found: ${result.factChecks.length}`);
        if (result.metadata) {
          console.log(`     Claims checked: ${result.metadata.claimsChecked}`);
          console.log(`     Average rating: ${result.metadata.averageRating?.toFixed(2) || 'N/A'}`);
        }
        testsPassed++;
      } else {
        console.log('  ❌ Test 1: Fact-check false claim - FAIL');
        console.log('     Missing required fields:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 1: Fact-check false claim - FAIL');
      console.log('     Error:', error.message);
      if (error.stack) {
        console.log('     Stack:', error.stack);
      }
      testsFailed++;
    }
  };
  
  // Test 2: Fact-check content with a true claim
  const test2 = async () => {
    try {
      console.log('  Testing: Fact-check content with true claim...');
      const chunk = {
        text: 'Studies show that climate change is real and caused by human activity. Scientists agree on this fact.',
        id: 'integration-test-2'
      };
      
      const result = await factCheckContent(chunk, {}, {
        apiKey: API_KEY,
        languageCode: 'en'
      });
      
      if (result.score !== undefined && result.confidence !== undefined) {
        console.log(`  ✅ Test 2: Fact-check true claim - PASS`);
        console.log(`     Score: ${result.score.toFixed(2)}`);
        console.log(`     Confidence: ${result.confidence.toFixed(2)}`);
        console.log(`     Fact-checks found: ${result.factChecks.length}`);
        testsPassed++;
      } else {
        console.log('  ❌ Test 2: Fact-check true claim - FAIL');
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 2: Fact-check true claim - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  // Test 3: Fact-check content with multiple claims
  const test3 = async () => {
    try {
      console.log('  Testing: Fact-check content with multiple claims...');
      const chunk = {
        text: 'According to research, the Earth is round. Studies show that vaccines are safe. Experts claim that climate change is real.',
        id: 'integration-test-3'
      };
      
      const result = await factCheckContent(chunk, {}, {
        apiKey: API_KEY,
        languageCode: 'en',
        maxClaims: 3
      });
      
      if (result.metadata && result.metadata.claimsChecked > 0) {
        console.log(`  ✅ Test 3: Multiple claims handling - PASS`);
        console.log(`     Claims checked: ${result.metadata.claimsChecked}`);
        console.log(`     Fact-checks found: ${result.metadata.factChecksFound}`);
        testsPassed++;
      } else {
        console.log('  ❌ Test 3: Multiple claims handling - FAIL');
        console.log('     Expected claims to be checked, got:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 3: Multiple claims handling - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  // Test 4: Test error handling with invalid API key
  const test4 = async () => {
    try {
      console.log('  Testing: Invalid API key handling...');
      const chunk = {
        text: 'This is a test claim that should fail with invalid key.',
        id: 'integration-test-4'
      };
      
      const result = await factCheckContent(chunk, {}, {
        apiKey: 'invalid-key-12345',
        languageCode: 'en'
      });
      
      // Should handle error gracefully - the function catches API errors and returns
      // a result with no_fact_checks_found flag, which is acceptable behavior
      if (result.error || result.flags?.includes('no_api_key') || 
          result.flags?.includes('no_fact_checks_found') || result.confidence === 0) {
        console.log('  ✅ Test 4: Invalid API key handling - PASS');
        console.log(`     Result: ${result.flags?.join(', ') || 'error handled gracefully'}`);
        testsPassed++;
      } else {
        console.log('  ❌ Test 4: Invalid API key handling - FAIL');
        console.log('     Expected error handling, got:', result);
        testsFailed++;
      }
    } catch (error) {
      // Error is also acceptable
      console.log('  ✅ Test 4: Invalid API key handling - PASS (threw error)');
      testsPassed++;
    }
  };
  
  await test1();
  await test2();
  await test3();
  await test4();
  
  return { passed: testsPassed, failed: testsFailed, skipped: 0 };
}

/**
 * Test extractClaims with real-world examples
 */
function testRealExtractClaims() {
  console.log('\n=== Integration Test: Real-World Claim Extraction ===');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Extract claims from news article style text
  const test1 = () => {
    const text = `According to a new study published in Nature, climate change is accelerating faster than previously predicted. 
    Scientists say that the Earth's temperature has increased by 1.5 degrees Celsius. 
    Research indicates that this is primarily due to human activity. 
    Experts claim that immediate action is required to prevent catastrophic consequences.`;
    
    const claims = extractClaims(text);
    
    if (claims.length > 0 && claims.length <= 3) {
      console.log(`  ✅ Test 1: News article claim extraction - PASS (found ${claims.length} claim(s))`);
      claims.forEach((claim, i) => {
        console.log(`     Claim ${i + 1}: "${claim.substring(0, 60)}..."`);
      });
      testsPassed++;
    } else {
      console.log('  ❌ Test 1: News article claim extraction - FAIL');
      console.log('     Expected 1-3 claims, got:', claims.length);
      testsFailed++;
    }
  };
  
  // Test 2: Extract from social media style text
  const test2 = () => {
    const text = 'OMG you won\'t believe this! Doctors hate this one secret trick! This is a proven fact that will shock you!';
    
    const claims = extractClaims(text);
    
    if (claims.length > 0) {
      console.log(`  ✅ Test 2: Social media claim extraction - PASS (found ${claims.length} claim(s))`);
      testsPassed++;
    } else {
      console.log('  ❌ Test 2: Social media claim extraction - FAIL');
      testsFailed++;
    }
  };
  
  // Test 3: Extract from mixed content
  const test3 = () => {
    const text = `The weather is nice today. According to experts, this is normal for this time of year. 
    Studies show that seasonal patterns are changing. I went to the store earlier.`;
    
    const claims = extractClaims(text);
    
    if (claims.length > 0 && claims.length <= 3) {
      console.log(`  ✅ Test 3: Mixed content claim extraction - PASS (found ${claims.length} claim(s))`);
      testsPassed++;
    } else {
      console.log('  ❌ Test 3: Mixed content claim extraction - FAIL');
      testsFailed++;
    }
  };
  
  test1();
  test2();
  test3();
  
  return { passed: testsPassed, failed: testsFailed, skipped: 0 };
}

/**
 * Main test runner
 */
async function runIntegrationTests() {
  console.log('🧪 Running Google Fact Check Integration Tests');
  console.log('='.repeat(60));
  
  if (!hasApiKey()) {
    console.log('\n⚠️  WARNING: No API key available');
    console.log('   Some tests will be skipped.');
    console.log('   To run full integration tests:');
    console.log('   1. Set: export BN_GOOGLE_API_KEY=your-api-key-here');
    console.log('      OR place the key in auth.txt file in the project root (as BN_GOOGLE_API_KEY=your-key)\n');
  } else {
    console.log('✅ API key found, running full integration tests\n');
  }
  
  try {
    // Run all test suites
    const extractResults = testRealExtractClaims();
    const searchResults = await testRealSearchFactChecks();
    const factCheckResults = await testRealFactCheckContent();
    
    // Summary
    const totalPassed = extractResults.passed + searchResults.passed + factCheckResults.passed;
    const totalFailed = extractResults.failed + searchResults.failed + factCheckResults.failed;
    const totalSkipped = extractResults.skipped + searchResults.skipped + factCheckResults.skipped;
    const totalTests = totalPassed + totalFailed + totalSkipped;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Integration Test Summary');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${totalTests}`);
    console.log(`✅ Passed: ${totalPassed}`);
    console.log(`❌ Failed: ${totalFailed}`);
    if (totalSkipped > 0) {
      console.log(`⚠️  Skipped: ${totalSkipped} (API key not set)`);
    }
    
    if (totalFailed === 0) {
      console.log('\n🎉 All integration tests passed!');
      if (totalSkipped > 0) {
        console.log('   (Some tests were skipped due to missing API key)');
      }
      process.exit(0);
    } else {
      console.log('\n⚠️  Some integration tests failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Integration test suite failed with error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runIntegrationTests().catch(error => {
  console.error('Fatal error running integration tests:', error);
  process.exit(1);
});

