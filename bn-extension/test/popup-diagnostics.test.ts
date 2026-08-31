/**
 * Unit tests for popup diagnostics — the timeout/logging wrapper that keeps a
 * hung chrome.* call from stalling the Toolbar Badge -> Popup path.
 */

import assert from 'node:assert/strict';
import { createPopupLog, runStep } from '../src/popup/popup-diagnostics.js';

function makeSink() {
	const lines: string[] = [];
	const push = (level: string) => (...args: unknown[]) =>
		lines.push(`${level} ${args.map(String).join(' ')}`);
	return {
		lines,
		sink: { debug: push('debug'), log: push('log'), warn: push('warn'), error: push('error') },
	};
}

// --- createPopupLog ---

{
	const { lines, sink } = makeSink();
	let clock = 1000;
	const log = createPopupLog(sink, () => clock);

	log.info('hello');
	clock = 1250;
	log.warn('slow');

	assert.equal(lines[0], 'log [BetterNet][popup] +0ms hello');
	assert.equal(lines[1], 'warn [BetterNet][popup] +250ms slow');
	assert.equal(log.sinceOpen(), 250);
}

// --- runStep: success ---

{
	const { lines, sink } = makeSink();
	const log = createPopupLog(sink);
	const result = await runStep('ok-step', async () => 42, 1000, log);

	assert.equal(result.ok, true);
	assert.equal(result.value, 42);
	assert.equal(result.timedOut, false);
	assert.ok(lines.some((l) => l.includes('step "ok-step" ok')));
}

// --- runStep: timeout resolves rather than hanging ---

{
	const { lines, sink } = makeSink();
	const log = createPopupLog(sink);
	const never = new Promise<number>(() => {});
	const result = await runStep('hung-step', () => never, 20, log);

	assert.equal(result.ok, false);
	assert.equal(result.value, null);
	assert.equal(result.timedOut, true);
	assert.ok(lines.some((l) => l.includes('warn') && l.includes('TIMED OUT')));
}

// --- runStep: rejection is captured, never re-thrown ---

{
	const { lines, sink } = makeSink();
	const log = createPopupLog(sink);
	const result = await runStep(
		'broken-step',
		() => Promise.reject(new Error('boom')),
		1000,
		log
	);

	assert.equal(result.ok, false);
	assert.equal(result.value, null);
	assert.equal(result.timedOut, false);
	assert.equal((result.error as Error).message, 'boom');
	assert.ok(lines.some((l) => l.includes('error') && l.includes('FAILED')));
}

// --- runStep: a synchronous throw is caught too ---

{
	const { sink } = makeSink();
	const log = createPopupLog(sink);
	const result = await runStep(
		'sync-throw',
		() => {
			throw new Error('sync boom');
		},
		1000,
		log
	);

	assert.equal(result.ok, false);
	assert.equal((result.error as Error).message, 'sync boom');
}

console.log('✓ popup-diagnostics tests passed');
