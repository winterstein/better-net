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

### Running Tests

The project includes tests for the chunking functionality. To run the tests:

```bash
npm test
```

This will:
1. Find all `.html` files in the `test-data/` directory
2. For each HTML file, look for a corresponding `.chunking.json` file
3. Run the chunking algorithm on the HTML
4. Compare the results against the expected chunks in the JSON file
5. Report any mismatches

### Test Structure

Test files are located in:
- `test/chunking.test.js` - Main test file for chunking functionality
- `test-data/` - Directory containing test HTML files and expected chunk JSON files

### Adding Test Cases

To add a new test case:

1. Place an HTML file in `test-data/` (e.g., `example.com.html`)
2. Create a corresponding JSON file with the expected chunks (e.g., `example.com.chunking.json`)
3. The JSON file should contain an array of chunk objects with the following structure:
   ```json
   [
     {
       "url": "https://example.com",
       "html": "<div>...</div>",
       "text": "Extracted text content",
       "images": [],
       "links": [],
       "metadata": {}
     }
   ]
   ```

The test is lenient and will pass if:
- All expected chunks are found in the actual results (extra chunks are OK)
- Expected text appears in actual chunks (extra text is OK)
- Expected metadata is present (extra metadata is OK)

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
