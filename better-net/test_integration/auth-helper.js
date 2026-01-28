/**
 * Authentication helper for Google Cloud service accounts
 * Used in integration tests to get OAuth2 access tokens
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let authClient = null;
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Initialize Google Auth client from service account file
 * @param {string} serviceAccountPath - Path to service account JSON file
 * @returns {Promise<GoogleAuth>} Authenticated client
 */
export async function initializeAuth(serviceAccountPath) {
  if (authClient) {
    return authClient;
  }

  try {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
    
    authClient = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/factchecktools']
    });

    return authClient;
  } catch (error) {
    throw new Error(`Failed to initialize auth: ${error.message}`);
  }
}

/**
 * Get OAuth2 access token from service account
 * @param {string} serviceAccountPath - Path to service account JSON file
 * @returns {Promise<string>} Access token
 */
export async function getAccessToken(serviceAccountPath) {
  // Return cached token if still valid (with 5 minute buffer)
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 300000) {
    return cachedToken;
  }

  try {
    const client = await initializeAuth(serviceAccountPath);
    const client_auth = await client.getClient();
    const tokenResponse = await client_auth.getAccessToken();
    
    if (!tokenResponse.token) {
      throw new Error('Failed to get access token');
    }

    // Cache token (tokens typically expire in 1 hour)
    cachedToken = tokenResponse.token;
    tokenExpiry = now + 3600000; // 1 hour from now

    return cachedToken;
  } catch (error) {
    throw new Error(`Failed to get access token: ${error.message}`);
  }
}

/**
 * Get Fact Check API client using service account
 * @param {string} serviceAccountPath - Path to service account JSON file
 * @returns {Promise<Object>} Fact Check API client
 */
export async function getFactCheckClient(serviceAccountPath) {
  try {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
    
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/factchecktools']
    });

    const factchecktools = google.factchecktools({
      version: 'v1alpha1',
      auth: auth
    });

    return factchecktools;
  } catch (error) {
    throw new Error(`Failed to create Fact Check client: ${error.message}`);
  }
}

/**
 * Search for fact-checks using service account (googleapis library)
 * @param {string} query - The claim or query to search for
 * @param {string} serviceAccountPath - Path to service account JSON file
 * @param {string} languageCode - Language code (default: 'en')
 * @returns {Promise<Object>} Fact check results
 */
export async function searchFactChecksWithServiceAccount(query, serviceAccountPath, languageCode = 'en') {
  const MIN_CLAIM_LENGTH = 20;

  if (!query || query.trim().length < MIN_CLAIM_LENGTH) {
    return {
      claims: [],
      totalResults: 0,
      error: 'Query too short'
    };
  }

  try {
    const factchecktools = await getFactCheckClient(serviceAccountPath);
    
    const response = await factchecktools.claims.search({
      query: query.trim(),
      languageCode: languageCode
    });

    return response.data || { claims: [], totalResults: 0 };
  } catch (error) {
    console.error('[BetterNet] [FACT_CHECK] Error searching fact checks with service account:', error);
    return {
      claims: [],
      totalResults: 0,
      error: error.message || 'Failed to search fact checks'
    };
  }
}

/**
 * Get service account file path from environment or default location
 * @returns {string|null} Path to service account file or null
 */
export function getServiceAccountPath() {
  // Check environment variable first
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (envPath) {
    return envPath;
  }

  // Check for default file in project root
  const defaultPath = join(__dirname, '..', 'better-net-477617-d6bd71e360a4.json');
  try {
    // Check if file exists
    readFileSync(defaultPath, 'utf-8');
    return defaultPath;
  } catch {
    return null;
  }
}

