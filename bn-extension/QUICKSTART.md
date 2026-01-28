# Quick Start Guide

Get BetterNet up and running in 5 minutes.

## Prerequisites

- Node.js installed
- Chrome, Firefox, or Edge browser

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Build Extension

For Chrome/Edge:
```bash
npm run build:chrome
```

For Firefox:
```bash
npm run build:firefox
```

### 3. Load Extension

#### Chrome/Edge:
1. Open `chrome://extensions/` (or `edge://extensions/`)
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `dist/chrome` folder

#### Firefox:
1. Open `about:debugging`
2. Click "This Firefox" in left sidebar
3. Click "Load Temporary Add-on"
4. Navigate to `dist/firefox/manifest.json` and select it

### 4. Test It Out

1. Visit any website (e.g., news article, social media post)
2. Click the BetterNet icon in your browser toolbar
3. Watch the analysis progress in real-time!
4. See detailed results when analysis completes

## What You'll See

- **On-page indicator**: A small badge appears in the top-right showing analysis progress
- **Popup window**: Click the extension icon to see detailed analysis results
- **Progress updates**: Real-time updates as each analysis stage completes

## Current Status

The extension is fully functional with:
- ✅ Cross-browser compatibility (Chrome/Firefox/Edge)
- ✅ Async analysis with intermediate updates
- ✅ Beautiful UI for results display
- ✅ Settings page for configuration
- ⚠️ **Note**: Currently uses mock analysis results - see `src/utils/analysis.js` for integration points

## Next Steps

To add real AI analysis:

1. **Local Model**: Integrate a local LLM library (e.g., transformers.js)
2. **API Integration**: Add OpenAI/Anthropic API calls in `src/background/background.js`
3. **Update Analysis**

See `README.md` for more details.
