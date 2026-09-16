---
name: spec-simple
description: >-
  Simple spec-driven development for BetterNet. Collects requirements by talking
  to the user, then writes short human-friendly specs under
  bn-*/specs/{broad-feature}/{specific-feature}/spec.md. Use when drafting or
  updating a feature spec, starting SDD, or when the user asks for a spec /
  build plan / test plan before coding.
version: 0.1.0
---

# Spec-driven development (simple)

Write short specs people will actually read. Talk first; file second. Do not over-document.
Update existing specs as the project develops.

## Layout

```
bn-<package>/specs/{broad-feature-name}/{specific-feature-name}/
  spec.md
  # optional: example-*.md, fixtures, diagrams, sample payloads
```

- Package: `bn-extension`, `bn-server`, `bn-webapp`, etc.
- `broad-feature-name` — area (e.g. `fact-checker`, `ads`, `cache`)
- `specific-feature-name` — this slice (e.g. `claim-extraction`, `nutrient-label`)
- Use kebab-case folder names
- One feature slice per folder; `spec.md` is required
- Extra example files live in the same folder and are linked from the Examples section

Existing flat files under `bn-*/specs/*.md` are legacy. New work uses the folder layout above. Migrate only if the user asks.

## Workflow

1. Confirm package and feature names (broad + specific). Suggest names if unclear; ask before inventing.
2. Ask the user — do not invent product intent. Prefer a few focused questions over a long questionnaire.
3. Draft `spec.md` with the template below. Leave unknown sections blank (keep the heading).
4. Show the draft (or a short summary) and revise with the user before treating it as done.
5. Implementation follows the build-plan; tests follow the test-plan. Update `status` as work progresses. Keep `bn-*/status.md` in sync for package-level blockers/next steps (see AGENTS.md).

### What to ask (as needed)

- Goal and who it is for
- Happy path (start → end)
- Inputs / outputs or UI behaviour
- Must-nots (out of scope)
- Links (tickets, related specs, APIs)
- How we will know it works (tests / manual checks)

Stop asking once you can fill overview, examples, out-of-scope, and a rough build/test plan. Blank is fine for the rest.

## Spec style

- Short, human, scannable.
- Prefer lists over tables. Use minimal formatting.
- Audience: a developer (or future you), not a process auditor
- Prefer concrete examples over abstract requirements
- Do include links to key code files - but not too many: helpful entrypoints not code documentation. 
- For a list of values, a spec can refer to a code file enum (DRY).
- No Speckit-style ceremony, no huge checklists, no duplicated AGENTS.md content
- If a section has nothing useful yet, leave it empty under the heading

### Anti-patterns

- Long specs nobody will finish reading
- Filling sections just to look complete
- Specs that restate the whole product
- Coding the feature before agreeing the overview / examples / out-of-scope (unless the user explicitly wants code-first)

## `spec.md` template

```markdown
# {Title}

## Overview

{What it does and why, in a few sentences.}

## Status

{e.g. draft | ready | in progress | done — plus one line of context if useful}

## Relevant links

- {spec, ticket, API docs, related code — or leave blank}

## Examples

{Inline input/output, or start/end use-cases. Or link to files in this folder:}

- [example-happy-path.md](./example-happy-path.md)

## Out of scope

- {Explicit non-goals}

## Build plan

1. {Small ordered steps — enough to start, not a novel}
{Each step should have status: planning | building | MVP | done}

## Test plan

- {Unit / integration / manual checks that prove the examples}
```

## Examples folder extras

When inline examples are awkward (JSON payloads, HTML fixtures, multi-step flows), add files next to `spec.md`:

- `example-*.md` — narrative start/end use-cases
- `fixture.*` / `sample-*.json` — sample input/output
- Link them from **Examples**; do not dump large blobs into `spec.md`
