/**
 * Score enums for module analysis and per-tag strength. See terminology.md.
 * Numeric fractions remain only as bridges to RiskLevel / Nutrient Label thresholds.
 */

/** Per-tag strength (terminology.md). `none` = not this tag / unset. */
export type TagStrength = 'high' | 'medium' | 'low' | 'none';

/** Module-level problem score (terminology.md). Higher = worse. */
export type ProblemScore = 'high' | 'medium' | 'low';

export const TAG_STRENGTHS: TagStrength[] = ['high', 'medium', 'low', 'none'];
export const PROBLEM_SCORES: ProblemScore[] = ['high', 'medium', 'low'];

/** One product tag on a chunk analysis (terminology.md). */
export interface IssueTag {
	tag: string;
	strength: TagStrength;
	/** [0,1] confidence in this tag */
	confidence: number;
}

/** Map legacy / heuristic [0,1] scores onto ProblemScore. */
export function problemScoreFromFraction(n: number): ProblemScore {
	if ((n ?? 0) >= 0.7) return 'high';
	if ((n ?? 0) >= 0.4) return 'medium';
	return 'low';
}

/**
 * Bridge to RiskLevel / Nutrient Label (still keyed on [0,1]).
 *
 * Tolerates a raw [0,1] number, because not every analyzer emits the enum yet and the
 * bare `switch` returned `undefined` for anything else — which reached the UI as "NaN%".
 * Anything unrecognised is treated as the bottom of the range rather than poisoning
 * arithmetic downstream.
 */
export function fractionFromProblemScore(score: ProblemScore | number | undefined): number {
	switch (score) {
		case 'high':
			return 0.75;
		case 'medium':
			return 0.5;
		case 'low':
			return 0.15;
	}
	return typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
}

export function tagStrengthFromFraction(n: number): TagStrength {
	if ((n ?? 0) >= 0.7) return 'high';
	if ((n ?? 0) >= 0.4) return 'medium';
	if ((n ?? 0) > 0) return 'low';
	return 'none';
}

export function strengthRank(strength: TagStrength): number {
	switch (strength) {
		case 'high':
			return 3;
		case 'medium':
			return 2;
		case 'low':
			return 1;
		case 'none':
			return 0;
	}
}

/**
 * Worst (highest) of several module problem scores. Empty → low.
 * Numbers are accepted for the same reason as fractionFromProblemScore: a module that has
 * not moved to the enum yet must not silently count as `low`.
 */
export function worstProblemScore(scores: Array<ProblemScore | number>): ProblemScore {
	if (!scores.length) return 'low';
	const bands = scores.map((s) => (typeof s === 'number' ? problemScoreFromFraction(s) : s));
	if (bands.includes('high')) return 'high';
	if (bands.includes('medium')) return 'medium';
	return 'low';
}

/**
 * Severity rank for picking a primary feedback tag (higher = worse / more specific).
 * Unknown tags rank just above none.
 */
const TAG_SEVERITY: Record<string, number> = {
	'false-claim': 100,
	'hate-speech': 95,
	threat: 94,
	phishing: 90,
	'personal-attack': 88,
	ragebait: 85,
	'fringe-view': 80,
	'suspect-claim': 75,
	biased: 70,
	'bias:left': 65,
	'bias:right': 65,
	'bias:self': 65,
	urgency: 60,
	scarcity: 58,
	sneaky: 56,
	fear: 55,
	'too-good-to-be-true': 54,
	clickbait: 50,
	sponsored: 40,
	advert: 38,
	'consent-ux': 35,
	'verified-claims': 20,
	'bias:neutral': 15,
	'no-claims': 10,
};

export function tagSeverity(tag: string): number {
	if (tag.startsWith('!')) return 0;
	if (tag.startsWith('trigger:')) return 72;
	return TAG_SEVERITY[tag] ?? 30;
}

/** Prefer higher severity, then higher strength. Skips strength none and !negations. */
export function pickPrimaryIssueTag(tags: IssueTag[]): IssueTag | undefined {
	const candidates = tags.filter((t) => t.strength !== 'none' && !t.tag.startsWith('!'));
	if (!candidates.length) return undefined;
	return candidates.reduce((best, t) => {
		const sev = tagSeverity(t.tag) - tagSeverity(best.tag);
		if (sev !== 0) return sev > 0 ? t : best;
		return strengthRank(t.strength) > strengthRank(best.strength) ? t : best;
	});
}

/**
 * Read a tag whether it arrives as an id or a full IssueTag. Analyzers are mid-migration
 * to IssueTag, and `t.tag` on a plain string yields undefined — which reached the UI as
 * blank tag chips and made hasIssueTag() always false.
 */
function asIssueTag(tag: string | IssueTag): IssueTag {
	return typeof tag === 'string' ? { tag, strength: 'medium', confidence: 0.5 } : tag;
}

export function issueTagIds(tags: Array<string | IssueTag> | undefined): string[] {
	return (tags ?? []).map((t) => asIssueTag(t).tag);
}

export function hasIssueTag(tags: Array<string | IssueTag> | undefined, tag: string): boolean {
	return (tags ?? []).some((t) => {
		const it = asIssueTag(t);
		return it.tag === tag && it.strength !== 'none';
	});
}

/** Accept string ids or full IssueTag; fill strength/confidence from module defaults. */
export function normalizeIssueTags(
	tags: Array<string | IssueTag> | undefined,
	strength: TagStrength,
	confidence: number
): IssueTag[] {
	if (!tags?.length) return [];
	return tags.map((t) =>
		typeof t === 'string'
			? { tag: t, strength, confidence }
			: {
					tag: t.tag,
					strength: t.strength ?? strength,
					confidence: typeof t.confidence === 'number' ? t.confidence : confidence,
				}
	);
}
