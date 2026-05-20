# AI models (better:net)

LLM calls use external APIs (OpenAI, Anthropic) or **local models** per user settings.

## Local models

- Small ONNX models via [Transformers.js](https://huggingface.co/docs/transformers.js) in an **offscreen document** (keeps the service worker light).
- User downloads from **Settings → AI Model → Local models**; weights cache in the browser (IndexedDB + Cache API).
- Catalog: `src/ai/model-catalog.js` (default: MobileBERT zero-shot; optional: FLAN-T5 Small for generative JSON).
- Inference: `src/offscreen/offscreen.js`; background client: `src/ai/local-inference-client.js`.
- WASM runtime bundled under `wasm/` (no CDN) for MV3 compliance. Offscreen sets explicit `wasmPaths`, `proxy: false`, `numThreads: 1` (extension pages are not cross-origin isolated).

## External APIs

API keys stored in `chrome.storage.sync` (options page). Fact-check uses Google Fact Check API separately.
