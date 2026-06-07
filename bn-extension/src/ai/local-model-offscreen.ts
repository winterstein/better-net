/**
 * Extension-only: routes local inference to the offscreen transformers worker.
 */

import { sendToOffscreen } from './local-inference-client.js';
import type { LocalModelBackend } from './local-model-backend.js';

export const offscreenLocalBackend: LocalModelBackend = {
	async zeroShot(params) {
		return sendToOffscreen('ZERO_SHOT', { ...params }) as Promise<import('./local-model-backend.js').ZeroShotResult>;
	},
	async generate(params) {
		return sendToOffscreen('GENERATE', { ...params }) as Promise<import('./local-model-backend.js').GenerateResult>;
	},
};
