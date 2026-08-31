/**
 * Risk bands shared by the Nutrient Label traffic light and the
 * "show labels from" setting, so the two cannot drift apart.
 */

export type RiskLevel = 'safe' | 'caution' | 'high-risk';

export interface RiskLevelSpec {
  id: RiskLevel;
  /** Traffic-light wording used on the label itself. */
  label: string;
  /** Options-page wording for the display threshold. */
  optionLabel: string;
  /** Lowest problemScore in this band (higher score = worse). */
  minScore: number;
  color: string;
  border: string;
}

/** Ordered least to most severe. */
export const RISK_LEVELS: RiskLevelSpec[] = [
  {
    id: 'safe',
    label: 'Safe',
    optionLabel: 'Everything, including Safe',
    minScore: 0,
    color: '#4CAF50',
    border: '#388e3c',
  },
  {
    id: 'caution',
    label: 'Caution',
    optionLabel: 'Caution and High Risk',
    minScore: 0.4,
    color: '#ff9800',
    border: '#f57c00',
  },
  {
    id: 'high-risk',
    label: 'High Risk',
    optionLabel: 'High Risk only',
    minScore: 0.7,
    color: '#f44336',
    border: '#d32f2f',
  },
];

/** Labels are noise on safe content, so Caution is the default floor. */
export const DEFAULT_NUTRIENT_LABEL_MIN_RISK: RiskLevel = 'caution';

export function riskLevelForScore(score: number): RiskLevelSpec {
  let match = RISK_LEVELS[0];
  for (const level of RISK_LEVELS) {
    if ((score ?? 0) >= level.minScore) match = level;
  }
  return match;
}

/** Unknown/legacy values fall back to the default rather than hiding everything. */
export function minScoreForRiskLevel(level: RiskLevel | string | undefined): number {
  const spec = RISK_LEVELS.find((l) => l.id === level);
  if (spec) return spec.minScore;
  return RISK_LEVELS.find((l) => l.id === DEFAULT_NUTRIENT_LABEL_MIN_RISK).minScore;
}

/** True when a chunk scoring `score` is risky enough to earn a Nutrient Label. */
export function shouldShowNutrientLabel(
  score: number,
  minLevel: RiskLevel | string | undefined
): boolean {
  return (score ?? 0) >= minScoreForRiskLevel(minLevel);
}
