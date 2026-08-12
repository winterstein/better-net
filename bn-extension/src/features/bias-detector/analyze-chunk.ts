/**
 * Bias Analyzer
 * Analyzes content for political bias, ideological slant, or lack of objectivity
 */

import { runFeatureAnalysis } from '../../ai/run-feature-analysis.js';
import {
	isZeroShotPayload,
	problemScoreFromZeroShotPayload,
} from '../zero-shot-score.js';

const PROMPT_ID = 'bias-detector';

// Phrasing calibrated for MNLI zero-shot (raw "biased vs balanced" false-positives on news).
const ZERO_SHOT_LABELS = [
  'This text is politically biased',
  'This text is objective',
];

export async function analyzeChunk(chunk, pageMetadata: any = {}, options: any = {}) {
  return runFeatureAnalysis({
    chunk,
    pageMetadata,
    options,
    promptId: PROMPT_ID,
    zeroShotLabels: ZERO_SHOT_LABELS,
    buildContext: (c, meta) => ({
      text: c.text || '',
      url: meta.url || '',
      domain: meta.domain || '',
      title: meta.title || '',
      author: meta.author || '',
    }),
    formatContextForPrompt,
    parseAIResponse,
    heuristicFallback: analyzeWithHeuristics,
    mockResults: getMockResults,
  });
}

// Fallback if no LLM is available
function analyzeWithHeuristics(context) {
  const text = context.text.toLowerCase();
  let score = 0;
  const flags = [];
  const biasDirection = { left: 0, right: 0, neutral: 0 };

  const leftKeywords = ['progressive', 'liberal', 'democratic', 'social justice', 'inequality', 'systemic'];
  const rightKeywords = ['conservative', 'republican', 'traditional', 'free market', 'individual'];
  
  const leftCount = leftKeywords.filter(kw => text.includes(kw)).length;
  const rightCount = rightKeywords.filter(kw => text.includes(kw)).length;
  
  if (leftCount > rightCount * 2) {
    biasDirection.left = 1;
    flags.push('left_leaning_language');
    score += 0.2;
  } else if (rightCount > leftCount * 2) {
    biasDirection.right = 1;
    flags.push('right_leaning_language');
    score += 0.2;
  }

  const loadedWords = ['obviously', 'clearly', 'undoubtedly', 'everyone knows', 'no one can deny'];
  const loadedCount = loadedWords.filter(word => text.includes(word)).length;
  if (loadedCount > 3) {
    score += 0.15;
    flags.push('loaded_language');
  }

  const questionWords = ['however', 'although', 'on the other hand', 'alternatively', 'meanwhile'];
  const questionCount = questionWords.filter(word => text.includes(word)).length;
  if (questionCount === 0 && text.length > 500) {
    score += 0.1;
    flags.push('one_sided_argument');
  }

  const emotionalWords = ['outrageous', 'disgusting', 'appalling', 'shocking', 'terrible', 'amazing', 'incredible'];
  const emotionalCount = emotionalWords.filter(word => text.includes(word)).length;
  if (emotionalCount > 5) {
    score += 0.15;
    flags.push('excessive_emotional_language');
  }

  const direction = biasDirection.left > biasDirection.right ? 'left' :
    biasDirection.right > biasDirection.left ? 'right' : 'neutral';
  return {
    problemScore: Math.min(score, 1.0),
    confidence: 0.6,
    flags,
    metadata: { biasDirection: direction },
    explanation: generateExplanation(score, flags, biasDirection),
  };
}

function formatContextForPrompt(context) {
  return `URL: ${context.url || 'N/A'}
Domain: ${context.domain || 'N/A'}
Title: ${context.title || 'N/A'}
Author: ${context.author || 'N/A'}

Content:
${context.text}`;
}

function parseAIResponse(responseText) {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (isZeroShotPayload(parsed)) {
        const problemScore = problemScoreFromZeroShotPayload(parsed);
        const flags = problemScore > 0.45 ? ['local_zero_shot'] : [];
        const biasDirection = { left: 0, right: 0, neutral: 1 };
        return {
          problemScore,
          confidence: Math.max(0.5, Math.min(0.95, parsed.scores?.[0] ?? 0.7)),
          flags,
          metadata: { biasDirection: 'neutral' },
          explanation: generateExplanation(problemScore, flags, biasDirection),
        };
      }
      return {
        problemScore: Math.max(0, Math.min(1, parsed.problemScore ?? parsed.score ?? 0)),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
        flags: parsed.flags || [],
        metadata: { biasDirection: parsed.biasDirection || 'neutral' },
        explanation: parsed.explanation || 'Analysis completed'
      };
    }
  } catch (e) {
    // Fallback parsing
  }

  const scoreMatch = responseText.match(/score[:\s]+([\d.]+)/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.3;

  return {
    problemScore: Math.max(0, Math.min(1, score)),
    confidence: 0.5,
    flags: [],
    metadata: { biasDirection: 'neutral' },
    explanation: responseText.substring(0, 200)
  };
}

function generateExplanation(score, flags, biasDirection) {
  const direction = biasDirection.left > biasDirection.right ? 'left-leaning' :
                    biasDirection.right > biasDirection.left ? 'right-leaning' : 'neutral';

  if (score < 0.2) {
    return `Content appears balanced and objective.`;
  } else if (score < 0.5) {
    return `Some bias detected (${direction}): ${flags.join(', ')}.`;
  } else {
    return `Significant bias detected (${direction}): ${flags.join(', ')}. Content shows strong ideological slant.`;
  }
}

function getMockResults(context) {
  return {
    problemScore: 0.30 + Math.random() * 0.2,
    confidence: 0.75 + Math.random() * 0.2,
    flags: [],
    metadata: { biasDirection: 'neutral' },
    explanation: 'Mock analysis for bias detection'
  };
}
