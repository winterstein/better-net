
This file sets general code principles to follow and to check in code reviews.

- Work on one feature at a time. Stay focused.
- DRY KISS and minimal edits for a feature.
- Core UI must be robust and low-latency.
- Prefer modular code with fewer dependencies. This is better for code reuse, testing, clarity, and maintenance.
- Avoid heavily nested functions. Avoid long functions. If these occur, refactor to use a helper function. 

## Comments and Docs

Comments and docs help with specification, testing, and maintenance. Please write them as you work. Keep them brief. A clear reference to a key bit of code is often better than an explanation.

Constant values, especially opaque IDs, should have a comment for maintenance: the why behind numbers, and the provenance for an ID.

Lifecycle flows (init, clean-up), and data-storage sequencing (when data is created and updated), are often worth a comment to clarify expected behaviour.

Avoid obvious comments.
