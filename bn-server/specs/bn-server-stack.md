
OS: Linux, Ubuntu flavour

Databases:
 - PostgreSQL for accounts
 - ElasticSearch for chunks (cached analysis, feedback)

Server:
 - Typescript, Fastify

AI:
 - Support local small-ish LLM (e.g. BERT) or API to Claude or ChatGPT. Switching model should be easy (achieved via minimal wrapper code to align on a shared interface).
 - Local models: add thin wrappers to align use of local models with standard OpenAI style API calls. 
 - We want code reuse (analyzers) with bn-extension - which will not have an agent layer.
 - Avoid vendor lock-in.
 - AIQA (https://aiqa.winterwell.com/) for observability

API:
 - RESTful json over https

Front-end: bn-webapp

DevOps:
 - GitHub inc GitHub Actions

Testing:
 - Fast unit tests. Full coverage is not essential. Must cover basics. Run on git commit. Agents should write tests and run them to check code functioning.

Code Reuse
There is a sym-linked folder bn-extension-src to allow easy reuse of types and analyzers from the browser extension.

General principles:

Keep it simple (KISS).
Do not repeat yourself (DRY).
Modular code.

Unit tests - which should be fast, reliable, and run on git commit.

Avoid making lots of types. Prefer a few core types for simplicity.

Avoid short functions that are only used in a single location — such code is often clearer and easier to follow if kept inline instead. Use helper functions where they genuinely improve reuse, readability, or testing, but avoid unnecessary indirection.