/**
 * Unit tests for Nutrient Label risk bands and the display threshold setting.
 */

import assert from 'node:assert/strict';
import {
  DEFAULT_NUTRIENT_LABEL_MIN_RISK,
  RISK_LEVELS,
  minScoreForRiskLevel,
  riskLevelForScore,
  shouldShowNutrientLabel,
} from '../src/types/RiskLevel.js';
import { getTrafficLight } from '../src/content/content-analysis-modal.js';

// --- bands ---

assert.equal(riskLevelForScore(0).id, 'safe');
assert.equal(riskLevelForScore(0.39).id, 'safe');
assert.equal(riskLevelForScore(0.4).id, 'caution');
assert.equal(riskLevelForScore(0.69).id, 'caution');
assert.equal(riskLevelForScore(0.7).id, 'high-risk');
assert.equal(riskLevelForScore(1).id, 'high-risk');

// The traffic light must keep its original thresholds after moving to RiskLevel.ts
assert.equal(getTrafficLight(0.2).label, 'Safe');
assert.equal(getTrafficLight(0.4).label, 'Caution');
assert.equal(getTrafficLight(0.7).label, 'High Risk');
assert.equal(getTrafficLight(0.7).color, '#f44336');

// --- threshold lookup ---

assert.equal(minScoreForRiskLevel('safe'), 0);
assert.equal(minScoreForRiskLevel('caution'), 0.4);
assert.equal(minScoreForRiskLevel('high-risk'), 0.7);
// Unknown/legacy values fall back to the default rather than hiding everything
assert.equal(minScoreForRiskLevel(undefined), 0.4);
assert.equal(minScoreForRiskLevel('nonsense'), 0.4);

// --- the default: safe content is not labelled ---

assert.equal(DEFAULT_NUTRIENT_LABEL_MIN_RISK, 'caution');
assert.equal(shouldShowNutrientLabel(0, DEFAULT_NUTRIENT_LABEL_MIN_RISK), false);
assert.equal(shouldShowNutrientLabel(0.39, DEFAULT_NUTRIENT_LABEL_MIN_RISK), false);
assert.equal(shouldShowNutrientLabel(0.4, DEFAULT_NUTRIENT_LABEL_MIN_RISK), true);
assert.equal(shouldShowNutrientLabel(0.9, DEFAULT_NUTRIENT_LABEL_MIN_RISK), true);

// --- 'safe' shows everything ---

assert.equal(shouldShowNutrientLabel(0, 'safe'), true);
assert.equal(shouldShowNutrientLabel(0.9, 'safe'), true);

// --- 'high-risk' shows only the worst ---

assert.equal(shouldShowNutrientLabel(0.4, 'high-risk'), false);
assert.equal(shouldShowNutrientLabel(0.69, 'high-risk'), false);
assert.equal(shouldShowNutrientLabel(0.7, 'high-risk'), true);

// --- missing score is treated as safe, not as risky ---

assert.equal(shouldShowNutrientLabel(undefined as unknown as number, 'caution'), false);

// --- options list is ordered least to most severe and covers every band ---

assert.deepEqual(
  RISK_LEVELS.map((l) => l.id),
  ['safe', 'caution', 'high-risk']
);
RISK_LEVELS.forEach((level) => {
  assert.ok(level.optionLabel, `${level.id} needs an options-page label`);
});

console.log('✓ risk-level tests passed');
