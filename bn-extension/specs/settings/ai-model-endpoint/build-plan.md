# AI Model HTTP Endpoint Implementation

## Overview
Implement the feature allowing users to configure and utilize a custom HTTP endpoint for AI model inference, enabling support for local services like Ollama or other custom APIs.

## Status
planning

## Relevant links
- `ai-models.md` (Current design overview)
- `settings/spec.md` (Current settings structure)

## Examples
[No immediate examples needed for the build plan]

## Out of scope
- Complete unit testing of all third-party APIs.
- Advanced error handling for non-standard HTTP errors beyond 4xx/5xx.

## Build plan
1. **UI/Frontend:** Add fields to the AI Model settings UI for "HTTP Endpoint URL" and optional "API Key".
    *Status: planning*
2. **Integration Logic:** Implement a new service/client in `src/ai/` capable of accepting the custom endpoint URL and API Key.
    *Status: planning*
3. **Header Handling:** Update the network request logic to correctly include the API Key as an `Authorization` header if provided and using the custom endpoint, otherwise proceed without authentication.
    *Status: planning*
4. **Compatibility Check:** Ensure the new client logic correctly falls back to local/built-in models if the custom endpoint is not provided or fails connection/auth checks.
    *Status: planning*
5. **Testing:** Write integration tests covering successful calls, authentication failures, and network timeouts for the new endpoint configuration.
    *Status: planning*

## Test plan
- Unit tests for the new endpoint client logic.
- Integration tests verifying a successful request to a mock remote endpoint.
- Manual check: Verify the UI correctly captures and saves the endpoint/key.