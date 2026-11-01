# BetterNet extension

MV3 browser extension: chunk pages, analyse for misleading / manipulative content, show
Nutrient Labels. Status of what works: [`status.md`](./status.md).

## Setup

```bash
cd bn-extension
npm install
npm run build          # or build:chrome / build:firefox / build:edge
```

Load unpacked from `dist/chrome` (or `dist/firefox`) in the browser's extensions page.

Optional keys in Settings → Advanced, or `chrome.storage.sync`: `BN_GOOGLE_API_KEY`,
`BN_OPENAI_API_KEY`, `BN_ANTHROPIC_API_KEY`.

## Test

```bash
npm test               # unit suite (tsx)
npm run test:e2e:smoke # Playwright smoke
```

`npm run type-check` is noisy; build + test are the gates.

## Using with Ollama

Mac?
See https://cognetic.app/docs/ollama/mac

launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
mkdir -p ~/Library/LaunchAgents

ps -ef | grep ollama
kill 


cat > ~/Library/LaunchAgents/com.ollama.origins.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ollama.origins</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>OLLAMA_ORIGINS</string>
    <string>chrome-extension://*</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF
