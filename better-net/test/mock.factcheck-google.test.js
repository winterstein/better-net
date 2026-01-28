/**
 * Test for Google Fact Check functionality
 * Tests claim extraction, API integration, and fact-checking logic
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractClaims } from '../src/factcheck/extract-claims.js';
import { searchFactChecks, factCheckContent } from '../src/factcheck/factcheck-google.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock fetch for Node.js environment
let fetchMock = null;
const originalFetch = globalThis.fetch;

/**
 * Setup fetch mock before tests
 */
function setupFetchMock() {
  fetchMock = (url, options) => {
    const urlObj = new URL(url);
    
    // Mock responses based on URL or query parameters
    if (urlObj.pathname.includes('/claims:search')) {
      const query = urlObj.searchParams.get('query') || '';
      const apiKey = urlObj.searchParams.get('key');
      
      if (!apiKey) {
        return Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: () => Promise.resolve(JSON.stringify({ error: 'API key required' }))
        });
      }
      
      // Mock different responses based on query (case-insensitive partial match)
      const queryLower = query.toLowerCase();
      if (queryLower.includes('false claim') || queryLower.includes('false')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            claims: [{
              text: 'False claim example',
              claimant: 'Test Source',
              claimDate: '2024-01-01',
              claimReview: [{
                publisher: { name: 'PolitiFact' },
                url: 'https://politifact.com/factcheck/1',
                title: 'Fact Check: False Claim',
                reviewDate: '2024-01-02',
                textualRating: 'False',
                languageCode: 'en'
              }]
            }]
          })
        });
      } else if (queryLower.includes('true claim') || queryLower.includes('true')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            claims: [{
              text: 'True claim example',
              claimant: 'Test Source',
              claimDate: '2024-01-01',
              claimReview: [{
                publisher: { name: 'Snopes' },
                url: 'https://snopes.com/factcheck/1',
                title: 'Fact Check: True Claim',
                reviewDate: '2024-01-02',
                textualRating: 'True',
                languageCode: 'en'
              }]
            }]
          })
        });
      } else if (queryLower.includes('mixed claim') || queryLower.includes('mixture')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            claims: [{
              text: 'Mixed claim example',
              claimant: 'Test Source',
              claimDate: '2024-01-01',
              claimReview: [
                {
                  publisher: { name: 'FactCheck.org' },
                  url: 'https://factcheck.org/1',
                  title: 'Fact Check: Mixed Claim',
                  reviewDate: '2024-01-02',
                  textualRating: 'Mixture',
                  languageCode: 'en'
                }
              ]
            }]
          })
        });
      } else if (queryLower.includes('error')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve(JSON.stringify({ error: 'Server error' }))
        });
      } else {
        // No results found
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            claims: []
          })
        });
      }
    }
    
    // Default: return error for unknown endpoints
    return Promise.resolve({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve('Not Found')
    });
  };
  
  globalThis.fetch = fetchMock;
}

/**
 * Restore original fetch after tests
 */
function restoreFetch() {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete globalThis.fetch;
  }
}

/**
 * Test extractClaims function
 */
function testExtractClaims() {
  console.log('\n=== Testing extractClaims ===');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Extract claims from text with claim patterns
  const test1 = () => {
    const text = 'According to scientists, climate change is real. Studies show that the Earth is warming. This is a proven fact.';
    const claims = extractClaims(text);
    
    if (claims.length > 0 && claims.some(c => c.includes('climate change'))) {
      console.log('  ✅ Test 1: Extract claims with patterns - PASS');
      testsPassed++;
    } else {
      console.log('  ❌ Test 1: Extract claims with patterns - FAIL');
      console.log('     Expected claims with patterns, got:', claims);
      testsFailed++;
    }
  };
  
  // Test 2: Extract from text without claim patterns (should fall back to sentences)
  const test2 = () => {
    const text = 'The weather is nice today. I went to the store. Everything is fine.';
    const claims = extractClaims(text);
    
    if (claims.length > 0 && claims.length <= 3) {
      console.log('  ✅ Test 2: Extract claims from plain text - PASS');
      testsPassed++;
    } else {
      console.log('  ❌ Test 2: Extract claims from plain text - FAIL');
      console.log('     Expected 1-3 claims, got:', claims.length);
      testsFailed++;
    }
  };
  
  // Test 3: Short text should return empty
  const test3 = () => {
    const text = 'Short text.';
    const claims = extractClaims(text);
    
    if (claims.length === 0) {
      console.log('  ✅ Test 3: Short text returns empty - PASS');
      testsPassed++;
    } else {
      console.log('  ❌ Test 3: Short text returns empty - FAIL');
      console.log('     Expected empty array, got:', claims);
      testsFailed++;
    }
  };
  
  // Test 4: Empty text should return empty
  const test4 = () => {
    const text = '';
    const claims = extractClaims(text);
    
    if (claims.length === 0) {
      console.log('  ✅ Test 4: Empty text returns empty - PASS');
      testsPassed++;
    } else {
      console.log('  ❌ Test 4: Empty text returns empty - FAIL');
      testsFailed++;
    }
  };
  
  // Test 5: Long text should limit to MAX_CLAIMS_TO_CHECK
  const test5 = () => {
    const longText = Array(10).fill('According to experts, this is a claim. ').join('');
    const claims = extractClaims(longText);
    
    if (claims.length <= 3) {
      console.log('  ✅ Test 5: Long text limits claims - PASS');
      testsPassed++;
    } else {
      console.log('  ❌ Test 5: Long text limits claims - FAIL');
      console.log('     Expected <= 3 claims, got:', claims.length);
      testsFailed++;
    }
  };
  
  test1();
  test2();
  test3();
  test4();
  test5();
  
  return { passed: testsPassed, failed: testsFailed };
}

/**
 * Test searchFactChecks function
 */
async function testSearchFactChecks() {
  console.log('\n=== Testing searchFactChecks ===');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Successful search with false claim
  const test1 = async () => {
    try {
      const result = await searchFactChecks('This is a false claim example', 'test-api-key');
      
      if (result.claims && result.claims.length > 0 && result.claims[0].claimReview) {
        const rating = result.claims[0].ratingScore;
        if (rating !== undefined && rating < 0.5) {
          console.log('  ✅ Test 1: Search false claim - PASS');
          testsPassed++;
        } else {
          console.log('  ❌ Test 1: Search false claim - FAIL');
          console.log('     Expected low rating for false claim, got:', rating);
          testsFailed++;
        }
      } else {
        console.log('  ❌ Test 1: Search false claim - FAIL');
        console.log('     Expected claims with reviews, got:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 1: Search false claim - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  // Test 2: Successful search with true claim
  const test2 = async () => {
    try {
      const result = await searchFactChecks('This is a true claim example', 'test-api-key');
      
      if (result.claims && result.claims.length > 0) {
        const rating = result.claims[0].ratingScore;
        if (rating !== undefined && rating > 0.7) {
          console.log('  ✅ Test 2: Search true claim - PASS');
          testsPassed++;
        } else {
          console.log('  ❌ Test 2: Search true claim - FAIL');
          console.log('     Expected high rating for true claim, got:', rating);
          testsFailed++;
        }
      } else {
        console.log('  ❌ Test 2: Search true claim - FAIL');
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 2: Search true claim - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  // Test 3: No API key should throw error
  const test3 = async () => {
    try {
      await searchFactChecks('Some claim', '');
      console.log('  ❌ Test 3: No API key throws error - FAIL');
      console.log('     Expected error for missing API key');
      testsFailed++;
    } catch (error) {
      if (error.message.includes('API key')) {
        console.log('  ✅ Test 3: No API key throws error - PASS');
        testsPassed++;
      } else {
        console.log('  ❌ Test 3: No API key throws error - FAIL');
        console.log('     Expected API key error, got:', error.message);
        testsFailed++;
      }
    }
  };
  
  // Test 4: Short query should return error
  const test4 = async () => {
    try {
      const result = await searchFactChecks('Short', 'test-api-key');
      
      if (result.error && result.error.includes('too short')) {
        console.log('  ✅ Test 4: Short query returns error - PASS');
        testsPassed++;
      } else {
        console.log('  ❌ Test 4: Short query returns error - FAIL');
        console.log('     Expected error for short query, got:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 4: Short query returns error - FAIL');
      console.log('     Unexpected error:', error.message);
      testsFailed++;
    }
  };
  
  // Test 5: API error handling
  const test5 = async () => {
    try {
      const result = await searchFactChecks('This is an error claim', 'test-api-key');
      
      if (result.error) {
        console.log('  ✅ Test 5: API error handling - PASS');
        testsPassed++;
      } else {
        console.log('  ❌ Test 5: API error handling - FAIL');
        console.log('     Expected error result, got:', result);
        testsFailed++;
      }
    } catch (error) {
      // Error handling is also acceptable
      console.log('  ✅ Test 5: API error handling - PASS (threw error)');
      testsPassed++;
    }
  };
  
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  
  return { passed: testsPassed, failed: testsFailed };
}

/**
 * Test factCheckContent function
 */
async function testFactCheckContent() {
  console.log('\n=== Testing factCheckContent ===');
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Fact-check with false claims
  const test1 = async () => {
    try {
      const chunk = {
        text: 'According to experts, this is a false claim example that needs verification.',
        id: 'test-1'
      };
      
      const result = await factCheckContent(chunk, {}, {
        apiKey: 'test-api-key'
      });
      
      if (result.score !== undefined && result.confidence !== undefined && result.flags) {
        // False claims should have high fake news score (inverted)
        if (result.score > 0.5 || result.factChecks.length > 0) {
          console.log('  ✅ Test 1: Fact-check false claims - PASS');
          testsPassed++;
        } else {
          console.log('  ❌ Test 1: Fact-check false claims - FAIL');
          console.log('     Expected high score or fact-checks, got:', result);
          testsFailed++;
        }
      } else {
        console.log('  ❌ Test 1: Fact-check false claims - FAIL');
        console.log('     Missing required fields:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 1: Fact-check false claims - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  // Test 2: No API key
  const test2 = async () => {
    try {
      const chunk = {
        text: 'This is a test claim that should be checked.',
        id: 'test-2'
      };
      
      const result = await factCheckContent(chunk, {}, {
        apiKey: ''
      });
      
      if (result.flags && result.flags.includes('no_api_key')) {
        console.log('  ✅ Test 2: No API key handling - PASS');
        testsPassed++;
      } else {
        console.log('  ❌ Test 2: No API key handling - FAIL');
        console.log('     Expected no_api_key flag, got:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 2: No API key handling - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  // Test 3: Short content
  const test3 = async () => {
    try {
      const chunk = {
        text: 'Short.',
        id: 'test-3'
      };
      
      const result = await factCheckContent(chunk, {}, {
        apiKey: 'test-api-key'
      });
      
      if (result.flags && result.flags.includes('insufficient_content')) {
        console.log('  ✅ Test 3: Short content handling - PASS');
        testsPassed++;
      } else {
        console.log('  ❌ Test 3: Short content handling - FAIL');
        console.log('     Expected insufficient_content flag, got:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 3: Short content handling - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  // Test 4: Content with no claims (or claims with no fact-checks)
  const test4 = async () => {
    try {
      const chunk = {
        text: 'This is just some regular text without any factual claims or statements that would trigger fact-checking patterns.',
        id: 'test-4'
      };
      
      const result = await factCheckContent(chunk, {}, {
        apiKey: 'test-api-key'
      });
      
      // Should either find claims (fallback to sentences) and return no_fact_checks_found,
      // or return no_claims_found if no sentences are extracted
      if (result.flags && (
        result.flags.includes('no_claims_found') || 
        result.flags.includes('no_fact_checks_found') ||
        result.factChecks.length > 0
      )) {
        console.log('  ✅ Test 4: No claims handling - PASS');
        testsPassed++;
      } else {
        console.log('  ❌ Test 4: No claims handling - FAIL');
        console.log('     Expected no_claims_found, no_fact_checks_found, or fact-checks, got:', result);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 4: No claims handling - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  // Test 5: Result structure validation
  const test5 = async () => {
    try {
      const chunk = {
        text: 'According to research, this is a true claim example that has been verified.',
        id: 'test-5'
      };
      
      const result = await factCheckContent(chunk, {}, {
        apiKey: 'test-api-key'
      });
      
      const requiredFields = ['score', 'confidence', 'flags', 'explanation', 'factChecks', 'metadata'];
      const hasAllFields = requiredFields.every(field => field in result);
      
      if (hasAllFields) {
        console.log('  ✅ Test 5: Result structure validation - PASS');
        testsPassed++;
      } else {
        console.log('  ❌ Test 5: Result structure validation - FAIL');
        const missing = requiredFields.filter(f => !(f in result));
        console.log('     Missing fields:', missing);
        testsFailed++;
      }
    } catch (error) {
      console.log('  ❌ Test 5: Result structure validation - FAIL');
      console.log('     Error:', error.message);
      testsFailed++;
    }
  };
  
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  
  return { passed: testsPassed, failed: testsFailed };
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('🧪 Running Google Fact Check Tests\n');
  
  // Setup fetch mock
  setupFetchMock();
  
  try {
    // Run all test suites
    const extractResults = testExtractClaims();
    const searchResults = await testSearchFactChecks();
    const factCheckResults = await testFactCheckContent();
    
    // Summary
    const totalPassed = extractResults.passed + searchResults.passed + factCheckResults.passed;
    const totalFailed = extractResults.failed + searchResults.failed + factCheckResults.failed;
    const totalTests = totalPassed + totalFailed;
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 Test Summary');
    console.log('='.repeat(50));
    console.log(`Total Tests: ${totalTests}`);
    console.log(`✅ Passed: ${totalPassed}`);
    console.log(`❌ Failed: ${totalFailed}`);
    
    if (totalFailed === 0) {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some tests failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Restore fetch
    restoreFetch();
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});

