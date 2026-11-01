---
name: spec-simple
description: >-
  Simple spec-driven development for BetterNet. Collects requirements by talking
  to the user, then writes short human-friendly specs under
  specs/{broad-feature}/{specific-feature}/spec.md. Use when drafting or
  updating a feature spec, starting SDD, or when the user asks for a spec /
  build plan / test plan before coding.
version: 0.2.0
---

# Spec-driven development (simple)

Write short specs humans will actually read. 

Short specs - better projects. Do not over-document. The spec is a living description of the feature, updated as the project develops.

## Folder and File Layout

Folders: 

For most projects:

specs/{broad-feature-name}/{specific-feature-name}/

For monorepos with distinct sub-projects or applications:

{sub-project}/specs/{broad-feature-name}/{specific-feature-name}/

Each feature folder contains:

 - `spec.md` - required; the source of truth for that feature.
 - `build-plan.md` - optional.
 - `test-plan.md` - optional
 - `example-*.md` - optional, for larger examples.

The broad feature folder also has a spec.md:

specs/{broad-feature-name}/spec.md

This describes the broad feature at a high level. Specific feature specs describe individual slices. Do not duplicate content between them; link or refer to the broad spec where useful.

Rules: 

- Use kebab-case folder names
- One feature slice per folder.
- `spec.md` is required, and is the source of truth for the feature.
- Extra example files live in the same folder and are linked from the Examples section
- Prefer the simplest folder structure that fits the project.

The project may have spec files in a different format. Treat those as valid specs in a legacy format. Use the layout above for new work. Migrate legacy format specs only if the user asks.

## Workflow

1. Confirm package and feature names (broad + specific). Suggest names if unclear; ask before inventing.
2. Ask the user — do not invent product intent. Use a few focused questions - only enough to understand the feature.
3. Identify the spec file. Create `spec.md` or update the existing spec, using the template below. Leave unknown sections blank - do not invent answers (keep the heading for blank sections).
4. Show the draft (or a short summary) and revise with the user before treating it as agreed.
5. Create the build-plan.md and test-plan.md files, or update them if they exist. Keep them in sync with the spec. Keep them short and high-level. Check them with the user.
6. Implementation follows the build-plan; tests follow the test-plan. Update `build-plan.md` and `test-plan.md` as work progresses. Keep `bn-*/status.md` in sync for package-level blockers/next steps (see AGENTS.md).

### What to ask
Ask only as needed: 
- Goal and who it is for
- Happy path (start → end)
- Inputs / outputs or UI behaviour
- Must-nots (out of scope)
- Links (tickets, related specs, APIs)
- How we will know it works (tests / manual checks)

Stop asking once there is enough information for: overview, examples, out-of-scope, and a rough build/test plan. Blank is fine for the rest.

Stop asking once there is enough information for:

- Overview
- Examples
- Out of scope
- Rough build plan
- Rough test plan

Blank is fine for everything else.

Do not silently invent product intent, or resolve design or technical decisions.

Technical implementation choices can normally be made during implementation
without asking unless they materially affect behaviour, architecture, security,
data, compatibility, or scope.

## Spec style

- Short, human, and scannable.
- Prefer lists over tables. Use minimal formatting.
- Audience: a developer (or future you), not a process auditor.
- Prefer concrete examples over abstract requirements.
- Do include links to key code files - but not too many: helpful entrypoints not code documentation. 
- For a list of values, prefer referring to an existing code enum or doc rather than duplicating it (DRY).
- No Speckit-style ceremony, no huge checklists, no duplicated AGENTS.md content.
- If a section has nothing useful yet, leave it empty under the heading

### Anti-patterns

- Long specs nobody will finish reading.
- Filling sections just to look complete.
- Specs that restate the whole product.
- Letting the spec files get out-of-date. If the user requests a product change, then consider updating the specs.
- Separate files for tiny features.
- Recording minor changes.
- Silently changing product intent during implementation. Remember that the user controls the spec.
- Assuming passing tests is sufficient verification.


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

{input/output, or start/end use-cases. Keep simplex examples inline. For larger examples, link to files in this folder - e.g.}



- [example-happy-path.md](./example-happy-path.md)

## Out of scope

- {Explicit non-goals}



## Decision history

Record only decisions that are likely to make a future developer ask:
> "Why did we do it this way?"

Good candidates include:

- difficult choices
- surprising constraints
- deliberately rejected alternatives that are likely to be reconsidered

Do not record:

- routine coding choices
- small or easy decisions
- information already clear from the spec or Git history

Keep entries short: date + 1-2 lines on what & why.
```





## Build plan

1. {Each step should have status: planning | todo | building | MVP | done}  {Small ordered steps — enough to start, not a novel. Do not repeat the spec.}

2. {Next step}

Example:

1. MVP - Bare-bones react webapp using Vite
2. building - login using Auth0
3. todo - header and left-hand navigation

## Test plan
Describe the checks needed to demonstrate that the examples
and important behaviour work.

- {Unit / integration / manual checks that prove the examples}

## Examples folder extras

When inline examples are awkward (JSON payloads, HTML fixtures, multi-step flows), add files next to `spec.md`:

- `example-*.md` — narrative start/end use-cases
- `fixture.*` / `sample-*.json` — sample input/output
- Link them from **Examples**; do not dump large blobs into `spec.md`






