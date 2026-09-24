# Quick start — bn-extension

```bash
cd bn-extension
npm install
npm run build:chrome
```

1. Open `chrome://extensions/` (or Edge equivalent)
2. Enable Developer mode
3. Load unpacked → select `dist/chrome`

Visit a page, open the toolbar popup for progress and results. Nutrient Labels appear on
chunks once analysis finishes.

Local models: Settings → AI Model (first download is large). Demo canned pages are off by
default (`demoMode` in sync storage).

Details and known gaps: [`status.md`](./status.md), [`README.md`](./README.md).
