/**
 * Console logging is off unless Settings → Advanced → Console logging is on.
 * logit() must be a no-op when the flag is false.
 */

import assert from 'node:assert/strict';
import {
  isConsoleLoggingEnabled,
  logit,
  setConsoleLogging,
} from '../src/utils/logger.js';

const originalLog = console.log;
const captured: unknown[][] = [];
console.log = (...args: unknown[]) => {
  captured.push(args);
};

try {
  setConsoleLogging(false);
  assert.equal(isConsoleLoggingEnabled(), false);
  logit('log', 'should not appear');
  assert.equal(captured.length, 0);

  setConsoleLogging(true);
  assert.equal(isConsoleLoggingEnabled(), true);
  logit('log', 'hello', 42);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0], ['hello', 42]);

  captured.length = 0;
  setConsoleLogging(false);
  logit('log', 'still silent');
  assert.equal(captured.length, 0);
} finally {
  console.log = originalLog;
  setConsoleLogging(false);
}

console.log('✓ logger tests passed');
