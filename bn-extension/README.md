# BetterNet

A cross-browser extension that analyzes web pages for fake news, scams, toxicity, misinformation, and AI-generated content. Provides real-time analysis with intermediate progress updates.

## Status

Extracts chunks/articles from duckduckgo, bbc
Crude regex extract-claims
Calls Google fact-check (badly)
Shows badge

TODO
Facebook, Twitter
high-negative-emotion
manipulative content
categorise news / opinion / satire / non-news
anti click-bait: resolve click vait headlines into more informative headlines
Link with server to use cache


Issues:
Too much mock data and hard-coded score values 
Treats null results as if meaningful

## Features

- 🔍 **Automated Page Analysis**: Automatically analyzes web pages you visit
- ⚡ **Async Analysis with Updates**: Real-time progress updates during analysis
- 🎯 **Multi-Factor Detection**: Checks for fake news, scams, toxicity, bias, AI-generated content, and reasoning quality
- 🌐 **Cross-Browser Support**: Works on Chrome, Firefox, and Edge
- 🔒 **Privacy-Focused**: Option to use local AI models for private analysis
- 📊 **Detailed Results**: Shows comprehensive analysis results with confidence scores

## Project Structure

```
better-net/
├── src/
│   ├── background/          # Background service worker
│   │   └── background.js     # Main analysis coordinator
│   ├── content/              # Content scripts
│   │   └── content.js        # Page content extraction & UI
│   ├── popup/                # Extension popup UI
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── options/              # Settings page
│       ├── options.html
│       ├── options.css
│       └── options.js
├── icons/                    # Extension icons (create these)
├── manifest.json             # Chrome/Edge manifest (v3)
├── manifest.firefox.json     # Firefox manifest (v2)
├── scripts/
│   └── build.js              # Build script
└── package.json
```

## Setup

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd better-net
```

2. Install dependencies:
```bash
npm install
```

3. Create icons directory and add extension icons:
   - `icons/icon16.png` (16x16)
   - `icons/icon48.png` (48x48)
   - `icons/icon128.png` (128x128)

   You can use the existing `betternet.64.png` as a reference or convert it to the required sizes.

### Build

Build for all browsers:
```bash
npm run build
```

Build for a specific browser:
```bash
npm run build:chrome
npm run build:firefox
npm run build:edge
```

This creates browser-specific builds in the `dist/` directory.

## Installation in Browsers

### Chrome/Edge

1. Build the extension:
   ```bash
   npm run build:chrome
   ```

2. Open Chrome/Edge and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top right)

4. Click "Load unpacked"

5. Select the `dist/chrome` directory

### Firefox

1. Build the extension:
   ```bash
   npm run build:firefox
   ```

2. Open Firefox and navigate to `about:debugging`

3. Click "This Firefox" in the left sidebar

4. Click "Load Temporary Add-on"

5. Navigate to `dist/firefox` and select `manifest.json`

## How It Works

1. **Content Script**: When you visit a page, the content script extracts page content (text, images, metadata)

2. **Background Worker**: The background service worker coordinates the analysis process:
   - Receives analysis requests from content scripts
   - Performs async analysis with intermediate updates
   - Manages analysis state per tab
   - Broadcasts progress updates to popup and content scripts

3. **Analysis Process**: The analysis runs through multiple stages:
   - Content Extraction
   - Fake News Detection
   - Scam Detection
   - Toxicity Analysis
   - Bias Detection
   - AI-Generated Content Detection
   - Reasoning Quality Evaluation

4. **Real-Time Updates**: During analysis, progress updates are sent via:
   - Chrome messaging API (to content scripts and popup)
   - Chrome storage API (for popup persistence)

5. **Results Display**: Final results are shown in:
   - Extension popup (detailed view)
   - On-page indicator (brief status)

## Development

### Analysis Implementation

The current implementation uses mock analysis results. To implement real analysis:

1. **Local Model**: Integrate a local LLM (e.g., using transformers.js or similar)****
2. **API Integration**: Add OpenAI/Anthropic API calls in `src/background/background.js`
3. **Analysis Functions**: Replace the `analyzeStage()` method with actual analysis logic

## Testing

Run from `bn-extension/` after `npm install`.

| Command | When to run | What it does |
|---------|-------------|--------------|
| `npm test` | Every change; CI default | Fast unit tests (chunking, tags, ad-blocker, update-manager, …). Builds HTML fixtures from `test-data/*.chunking.json` first. |
| `npm run test:e2e:smoke` | After popup/options/background changes; quick CI gate | Playwright smoke: service worker, popup init, options init, settings navigation (~10s). |
| `npm run test:e2e` | Before release; after content/background/popup changes | Smoke tests + fixture analysis on `test-data/` pages. |
| `npm run test:online` | Manual smoke; optional CI job with network | Playwright against live sites (e.g. bbc.co.uk). Needs network; may flake if a site changes or blocks bots. |
| `npm run test:mobilebert` | Manual only | Downloads real MobileBERT model (~25–80 MB). Not part of default CI. |

### Unit tests (`npm test`)

1. `scripts/build-fixture-html.js` writes `test-data/*.html` from each `*.chunking.json`
2. Chunking tests compare extracted chunks to the JSON expectations (lenient match)
3. Other tests cover tags, ad-blocker, local-inference client, update-manager, etc.

### Smoke tests (`npm run test:e2e:smoke`)

Fast extension UI checks (~10s). Catches broken popup/options pages, dead service worker, or missing toolbar popup wiring.

1. Service worker loads; `chrome.action.getPopup` points at `popup/popup.html`; background answers `GET_ANALYSIS_STATUS`
2. Options page builds nav and form (not stuck loading)
3. Popup leaves the loading spinner when the active tab is an analyzable page
4. Popup settings button opens the options page

Playwright cannot click the browser toolbar icon; popup tests open `chrome-extension://…/popup/popup.html` directly and refocus the content tab via CDP.

### E2E tests (`npm run test:e2e`)

Uses [Playwright](https://playwright.dev/docs/chrome-extensions) with Playwright’s bundled Chromium (`channel: 'chromium'`). Requires a prior build (`dist/chrome/`).

1. Runs smoke tests first
2. Builds the extension and regenerates fixture HTML
3. Starts a local fixture server on port 8765
4. Loads the extension, opens each fixture page, waits for the content script and analysis to finish
5. Asserts analysis status is `completed` and at least one chunk was found

Fixture pages: `duckduckgo.com.hello.html`, `bbc.co.uk-news.1.html`, `google.com.edinburgh - Google Search.html`.

Install browsers once: `npx playwright install chromium`

### Online tests (`npm run test:online`)

Same Playwright + extension setup, but navigates to live URLs (currently BBC News). Longer timeouts (120s). Run when you want a real-site smoke test—not in the default fast CI loop.

### Adding fixture test cases

1. Add `test-data/example.com.chunking.json` (array of expected chunk objects)
2. Run `node scripts/build-fixture-html.js` to generate `example.com.html`
3. Add the HTML filename to `e2e/fixtures.spec.ts` if it should run in e2e

Chunk JSON shape:

```json
[
  {
    "url": "https://example.com",
    "html": "<article>...</article>",
    "text": "Extracted text content",
    "images": [],
    "links": [],
    "metadata": {}
  }
]
```

Unit chunking tests pass when all expected chunks are found (extra chunks OK).

## Configuration

Open the extension options page to configure:
- Analysis mode (local/OpenAI/Anthropic)
- API keys (for cloud providers)
- Auto-analysis settings
- Privacy preferences

## Browser Compatibility

- ✅ Chrome/Chromium (Manifest V3)
- ✅ Microsoft Edge (Manifest V3)
- ✅ Firefox (Manifest V2)

## License

MIT

## Contributing

Contributions welcome! Please feel free to submit a Pull Request.

## Roadmap

- [ ] Integrate local LLM for analysis
- [ ] Add OpenAI/Anthropic API integration
- [ ] Implement community-based fact-checking
- [ ] Add more analysis categories
- [ ] Create browser-specific builds automatically
- [x] Add unit tests
- [ ] Performance optimizations
