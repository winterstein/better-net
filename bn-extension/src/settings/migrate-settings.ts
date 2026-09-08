/**
 * One-off settings migrations, run on service-worker start (background/background.ts).
 * Each is a no-op once applied, so running on every start is harmless.
 */

import { logit } from '../utils/logger.js';

/**
 * v0.4 → v0.5: Advanced → Console logging became Developer Mode, which now also gates
 * AIQA trace links on feedback (specs/feedback.md). Carry the old value over so anyone
 * who had logging on keeps it, and drop the stale key.
 */
export async function migrateDeveloperMode(): Promise<void> {
	if (typeof chrome === 'undefined' || !chrome.storage?.sync) return;
	try {
		const stored = await chrome.storage.sync.get(['developerMode', 'consoleLogging']);
		if (!('consoleLogging' in stored)) return;
		if (!('developerMode' in stored)) {
			await chrome.storage.sync.set({ developerMode: !!stored.consoleLogging });
		}
		await chrome.storage.sync.remove('consoleLogging');
		logit('log', '[BetterNet] Settings: consoleLogging migrated to developerMode');
	} catch (error) {
		logit('warn', '[BetterNet] Settings: developerMode migration failed:', (error as Error)?.message);
	}
}
