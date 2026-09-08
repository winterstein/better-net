
Specifications for the Anti-manipulation feature

User can override per domain in Off-List.

Detects manipulative patterns in content and UX: dark patterns, urgency/scarcity tricks, misdirection, and emotionally exploitative framing.
Labels manipulative elements via in-page nutrient labels.

Settings module: `antiManipulation`.

## Status

Target tags (terminology.md):

- urgency — phrase heuristics (working, weak)
- scarcity — phrase heuristics (working, weak)
- too-good-to-be-true — financial / free-money style phrases (working, weak)
- phishing — credential / payment ask phrases (working, weak)
- sneaky — to-do (hidden costs, pre-ticked extras)
- fear — to-do (scaring the user; used in demo data only)

Coverage overall: stub / heuristic. Zero-shot path maps high scores to phishing as a coarse stand-in.
