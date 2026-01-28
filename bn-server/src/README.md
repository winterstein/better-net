# BetterNet Server

## Source code structure

plugin-src is a sym-link to the src folder of the browser plugin, to allow easy shared use of data types and common functions

## How to Run Tests

Test files are located in the `test/` and `test_integration/` directories.

The test_integration directory contains tests that make real API calls to rate-limited external services.
They should be run regularly, but not too often, to avoid exceeding the rate limits.

To run the automated tests for the server code, use the following steps:

Preliminary steps:

1. **Install dependencies** (if you haven't already):

   ```
   npm install
   ```

2. **Set up .env and .env.test files**

3. **Run the tests:**

   ```
   npm test
   ```

   Or you can run with [tap](https://www.node-tap.org/):

   ```
   npx tap
   ```
To run a single test file, use the following command:

   ```
   npx tap test/test_chunk.js
   ```

To run a single test, use the following command:

   ```
   npx tap test/test_chunk.js:test_name
   ```