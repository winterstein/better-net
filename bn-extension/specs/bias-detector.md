
Detects political / ideological / commercial bias at the chunk level.
Draws on content and background info about the publisher.

Bias is not bad - just something to be aware of.

Political bias is:
 - left/right position on political spectrum
 - opinionated or slanted stance (a position not justified by objective facts) on politicised issues like climate change

Settings module: `biasDetector`.

## Status

Target tags (terminology.md) — key:value plus binary:

- biased — any significant bias (working, weak; zero-shot emits this without inventing a lean)
- bias:neutral — heuristic default when no lean detected (working, weak)
- bias:left — keyword / LLM lean (heuristic stub)
- bias:right — keyword / LLM lean (heuristic stub)
- bias:self — to-do (commercial / own-product bias)

Coverage overall: stub / heuristic. Zero-shot local path is coarse; no publisher prior yet.
