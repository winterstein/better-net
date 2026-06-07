/**
 * Platform abstraction for on-device inference (extension offscreen vs server none).
 */

export interface ZeroShotParams {
	modelId: string;
	text: string;
	candidateLabels: string[];
	multiLabel?: boolean;
}

export interface ZeroShotResult {
	labels?: string[];
	scores?: number[];
	error?: string;
}

export interface GenerateParams {
	modelId: string;
	prompt: string;
	maxNewTokens?: number;
}

export interface GenerateResult {
	text?: string;
	error?: string;
}

export interface LocalModelBackend {
	zeroShot(params: ZeroShotParams): Promise<ZeroShotResult>;
	generate(params: GenerateParams): Promise<GenerateResult>;
}

let cachedOffscreenBackend: LocalModelBackend | null | undefined;

/** Lazy-load Chrome offscreen backend; null when unavailable (e.g. Node server). */
export async function getOffscreenLocalBackend(): Promise<LocalModelBackend | null> {
	if (cachedOffscreenBackend !== undefined) {
		return cachedOffscreenBackend;
	}
	if (typeof chrome === 'undefined' || !chrome.offscreen?.createDocument) {
		cachedOffscreenBackend = null;
		return null;
	}
	try {
		const mod = await import('./local-model-offscreen.js');
		cachedOffscreenBackend = mod.offscreenLocalBackend;
	} catch {
		cachedOffscreenBackend = null;
	}
	return cachedOffscreenBackend;
}
