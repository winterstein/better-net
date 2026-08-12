// TODO why do this??

/**
 * Map zero-shot classification output → problemScore (higher = more problematic).
 * Risk label is candidateLabels[0]. Used by feature analyzers' parseAIResponse.
 */

export interface ZeroShotPayload {
	labels: string[];
	scores?: number[];
	candidateLabels: string[];
}

export function isZeroShotPayload(parsed: Record<string, unknown>): parsed is ZeroShotPayload {
	return (
		Array.isArray(parsed.labels) &&
		Array.isArray(parsed.candidateLabels) &&
		parsed.candidateLabels.length > 0
	);
}

export function problemScoreFromZeroShotPayload(parsed: ZeroShotPayload): number {
	const riskLabel = parsed.candidateLabels[0];
	const safeLabel = parsed.candidateLabels[1];
	const riskIdx = parsed.labels.indexOf(riskLabel);
	if (riskIdx >= 0) {
		return clamp01(parsed.scores?.[riskIdx] ?? 0);
	}
	if (safeLabel) {
		const safeIdx = parsed.labels.indexOf(safeLabel);
		if (safeIdx >= 0) {
			return clamp01(1 - (parsed.scores?.[safeIdx] ?? 0));
		}
	}
	return 0.5;
}

function clamp01(n: number) {
	return Math.max(0, Math.min(1, n));
}
