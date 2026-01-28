# Integration Tests

This directory contains integration tests that make real API calls to external services.

## Google Fact Check Integration Tests

These tests verify that the Google Fact Check API integration works correctly with real API calls.

### Prerequisites

1. **Get a Google Fact Check API Key**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/api/factchecktools.googleapis.com)
   - Create a project or select an existing one
   - Enable the "Fact Check Tools API"
   - Create an API key in "Credentials"
   - Note: The API has usage quotas and may incur costs

2. **Set Environment Variable**:
   ```bash
   echo 'export GOOGLE_FACTCHECK_API_KEY=AIza...your-key-here' >> ~/.bashrc
   source ~/.bashrc
   ```

**Quick Link**: https://console.cloud.google.com/apis/api/factchecktools.googleapis.com/quotas?project=better-net-477617

**Note**: 
- The API has usage quotas (check quotas page for limits)
- Free tier may have daily/monthly limits
- Costs may apply depending on usage and billing setup

#### Option 2: Service Account (More Secure)

1. **Use the service account JSON file**:
   - Place `better-net-477617-d6bd71e360a4.json` in the project root, OR
   - Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable:
     ```bash
     export GOOGLE_APPLICATION_CREDENTIALS=/path/to/better-net-477617-d6bd71e360a4.json
     ```

2. **Ensure the service account has permissions**:
   - The service account needs access to the Fact Check Tools API
   - Verify in Google Cloud Console that the API is enabled for the project

### Running Integration Tests

```bash
npm run test:integration
```

### What These Tests Do

The integration tests:

1. **Real API Search Tests**: Make actual API calls to search for fact-checks
   - Tests searching for well-known fact-checked claims
   - Tests handling of queries with no results
   - Tests language code handling

2. **Real Fact-Check Content Tests**: Tests the full fact-checking workflow
   - Tests fact-checking content with false claims
   - Tests fact-checking content with true claims
   - Tests handling multiple claims in one content chunk
   - Tests error handling with invalid API keys

3. **Real-World Claim Extraction**: Tests claim extraction with realistic content
   - News article style text
   - Social media style text
   - Mixed content

### Important Notes

- ⚠️ **API Quota**: These tests make real API calls and consume your API quota
- ⚠️ **Costs**: Depending on your Google Cloud billing, these tests may incur costs
- ✅ **Graceful Degradation**: Tests will skip if no authentication is available (no failures)
- ✅ **Error Handling**: Tests verify that errors are handled gracefully
- 🔐 **Service Account**: Service account authentication uses OAuth2 tokens via the `googleapis` library
- ⚠️ **Service Account Limitation**: 
  - The `factCheckContent` function currently only supports API keys, not service accounts
  - The Fact Check Tools API may require an API key even when using service account authentication
  - Service account tests will attempt to use OAuth2 but may fail if the API doesn't support it
  - If service account tests fail with "invalid argument" errors, use API key authentication instead

### Test Output

When API key is set:
- Tests make real API calls
- Results show actual fact-check data
- Ratings, publishers, and URLs from real fact-checks are displayed

When API key is not set:
- Tests are skipped (not failed)
- Warning message is displayed
- No API calls are made

### Example Output

```
🧪 Running Google Fact Check Integration Tests
============================================================
✅ API key found, running full integration tests

=== Integration Test: Real API Search ===
  Testing: Search for fact-checked claim...
  ✅ Test 1: Real API search - PASS (found 1 claim(s))
     First claim: "vaccines cause autism..."
     Rating: False
     Publisher: PolitiFact

=== Integration Test: Real API Fact-Check Content ===
  Testing: Fact-check content with false claim...
  ✅ Test 1: Fact-check false claim - PASS
     Score: 0.85
     Confidence: 0.80
     Flags: fact_checked, mostly_false
     Fact-checks found: 1
     Claims checked: 1
     Average rating: 0.20
```

