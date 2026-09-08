/**
 * Console output is off unless Settings → Advanced → Developer Mode is on.
 * logit() must be a no-op when the flag is false.
 */

import assert from 'node:assert/strict';
import {
  developerModeFromSettings,
  isDeveloperMode,
  logit,
  setDeveloperMode,
} from '../src/utils/logger.js';

// Developer Mode was called consoleLogging before v0.5; a stored old value still counts.
assert.equal(developerModeFromSettings({ developerMode: true }), true);
assert.equal(developerModeFromSettings({ consoleLogging: true }), true);
assert.equal(developerModeFromSettings({ developerMode: false, consoleLogging: true }), false);
assert.equal(developerModeFromSettings({}), false);

const originalLog = console.log;
const captured: unknown[][] = [];
console.log = (...args: unknown[]) => {
  captured.push(args);
};

try {
  setDeveloperMode(false);
  assert.equal(isDeveloperMode(), false);
  logit('log', 'should not appear');
  assert.equal(captured.length, 0);

  setDeveloperMode(true);
  assert.equal(isDeveloperMode(), true);
  logit('log', 'hello', 42);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0], ['hello', 42]);

  captured.length = 0;
  setDeveloperMode(false);
  logit('log', 'still silent');
  assert.equal(captured.length, 0);
} finally {
  console.log = originalLog;
  setDeveloperMode(false);
}

console.log('✓ logger tests passed');
