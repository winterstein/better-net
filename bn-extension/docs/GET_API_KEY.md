# How to Get a Google Fact Check API Key

This guide walks you through obtaining an API key for the Google Fact Check Tools API.

## Prerequisites

- A Google account
- Access to Google Cloud Console

## Step-by-Step Instructions

### 1. Access Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account

### 2. Select or Create a Project

**If you have the project `better-net-477617`:**
- Click the project dropdown at the top
- Select "better-net-477617"

**If you need to create a new project:**
- Click "Select a project" → "New Project"
- Enter project name: "BetterNet" (or any name you prefer)
- Click "Create"
- Wait for project creation (usually instant)

### 3. Enable the Fact Check Tools API

**Method 1: Direct Link**
- Go to: https://console.cloud.google.com/apis/library/factchecktools.googleapis.com
- Click the "Enable" button

**Method 2: Via Navigation**
1. In Google Cloud Console, go to "APIs & Services" → "Library"
2. Search for "Fact Check Tools API"
3. Click on "Fact Check Tools API"
4. Click the "Enable" button
5. Wait for confirmation (usually a few seconds)

### 4. Create an API Key

1. Go to: https://console.cloud.google.com/apis/credentials
   - Or navigate: "APIs & Services" → "Credentials"

2. Click **"+ CREATE CREDENTIALS"** at the top of the page

3. Select **"API key"** from the dropdown menu

4. Your API key will be created and displayed in a popup
   - The key starts with `AIza...`
   - **⚠️ IMPORTANT**: Copy this key immediately - you won't be able to see the full key again!

5. Click "Close" (you can restrict it later)

### 5. (Recommended) Restrict the API Key

For security, restrict your API key to only the Fact Check Tools API:

1. In the Credentials page, click on your newly created API key name

2. Under **"API restrictions"**:
   - Select "Restrict key"
   - Check "Fact Check Tools API" in the list
   - Uncheck any other APIs

3. Under **"Application restrictions"** (optional but recommended):
   - For local development: Select "None" (or "IP addresses" if you have a static IP)
   - For production: Select appropriate restriction based on your deployment

4. Click **"Save"** at the bottom

### 6. Set the Environment Variable

**For current session:**
```bash
export GOOGLE_FACTCHECK_API_KEY=AIza...your-actual-key-here
```

**To make it permanent (Linux/Mac):**
```bash
# Add to ~/.bashrc or ~/.zshrc
echo 'export GOOGLE_FACTCHECK_API_KEY=AIza...your-actual-key-here' >> ~/.bashrc
source ~/.bashrc
```

**For Windows (PowerShell):**
```powershell
$env:GOOGLE_FACTCHECK_API_KEY="AIza...your-actual-key-here"
```

**For Windows (Command Prompt):**
```cmd
set GOOGLE_FACTCHECK_API_KEY=AIza...your-actual-key-here
```

### 7. Verify the API Key Works

Run the integration tests:
```bash
npm run test:integration
```

If the API key is valid, you should see successful API calls in the test output.

## Quick Links

- **API Dashboard**: https://console.cloud.google.com/apis/api/factchecktools.googleapis.com
- **Credentials Page**: https://console.cloud.google.com/apis/credentials
- **API Library**: https://console.cloud.google.com/apis/library
- **Project Quotas**: https://console.cloud.google.com/apis/api/factchecktools.googleapis.com/quotas

## Troubleshooting

### "API key not valid" Error

- Verify the API key is copied correctly (no extra spaces)
- Check that the Fact Check Tools API is enabled for your project
- Ensure the API key isn't restricted to other APIs only

### "API key expired"

- API keys don't expire, but they can be deleted or restricted
- Check the credentials page to ensure the key is still active
- Create a new API key if needed

### "Quota exceeded" Error

- Check your API quotas: https://console.cloud.google.com/apis/api/factchecktools.googleapis.com/quotas
- You may need to request a quota increase
- Some APIs have daily/monthly limits on the free tier

### "Permission denied" Error

- Ensure billing is enabled for your project (some APIs require it)
- Check that your Google account has proper permissions on the project
- Verify the API is enabled for the correct project

## Security Best Practices

1. **Never commit API keys to version control**
   - Add `.env` files to `.gitignore`
   - Use environment variables instead of hardcoding

2. **Restrict API keys**
   - Limit to specific APIs (Fact Check Tools API only)
   - Add application restrictions when possible

3. **Rotate keys regularly**
   - Delete old keys when creating new ones
   - Update environment variables when rotating

4. **Monitor usage**
   - Check the API dashboard regularly
   - Set up billing alerts if using paid quotas

## Cost Information

- The Fact Check Tools API may have free tier limits
- Check the [pricing page](https://cloud.google.com/fact-check-tools/pricing) for details
- Monitor usage in the [API dashboard](https://console.cloud.google.com/apis/api/factchecktools.googleapis.com)

## Next Steps

Once you have your API key set up:
1. Run the integration tests: `npm run test:integration`
2. Configure the extension: Add the key in the extension's options page
3. Start using fact-checking in your browser extension!

