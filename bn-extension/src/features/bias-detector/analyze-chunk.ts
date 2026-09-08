/**
 * Bias Detector
 * Analyzers emit: biased (any significant bias), bias:neutral | bias:left | bias:right | bias:self.
 */

import { runFeatureAnalysis } from '../../ai/run-feature-analysis.js';
import {
	isZeroShotPayload,
	problemScoreFromZeroShotPayload,
} from '../zero-shot-score.js';
import { problemScoreFromFraction } from '../../types/Score.js';

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

function leanTag(direction: 'left' | 'right' | 'neutral'): string {
  if (direction === 'left') return 'bias:left';
  if (direction === 'right') return 'bias:right';
  return 'bias:neutral';
}

function biasTags(direction: 'left' | 'right' | 'neutral', significant: boolean): string[] {
  const lean = leanTag(direction);
  if (!significant) return [lean];
  // `biased` is on for any significant bias; lean is additional key:value detail.
  if (direction === 'neutral') return ['biased', lean];
  return ['biased', lean];
}

function analyzeWithHeuristics(context) {
  const text = context.text.toLowerCase();
  let score = 0;
  const biasDirection = { left: 0, right: 0, neutral: 0 };

  const leftKeywords = ['progressive', 'liberal', 'democratic', 'social justice', 'inequality', 'systemic'];
  const rightKeywords = ['conservative', 'republican', 'traditional', 'free market', 'individual'];
  
  const leftCount = leftKeywords.filter(kw => text.includes(kw)).length;
  const rightCount = rightKeywords.filter(kw => text.includes(kw)).length;
  
  if (leftCount > rightCount * 2) {
    biasDirection.left = 1;
    score += 0.2;
  } else if (rightCount > leftCount * 2) {
    biasDirection.right = 1;
    score += 0.2;
  }

  const loadedWords = ['obviously', 'clearly', 'undoubtedly', 'everyone knows', 'no one can deny'];
  const loadedCount = loadedWords.filter(word => text.includes(word)).length;
  if (loadedCount > 3) {
    score += 0.15;
  }

  const questionWords = ['however', 'although', 'on the other hand', 'alternatively', 'meanwhile'];
  const questionCount = questionWords.filter(word => text.includes(word)).length;
  if (questionCount === 0 && text.length > 500) {
    score += 0.1;
  }

  const emotionalWords = ['outrageous', 'disgusting', 'appalling', 'shocking', 'terrible', 'amazing', 'incredible'];
  const emotionalCount = emotionalWords.filter(word => text.includes(word)).length;
  if (emotionalCount > 5) {
    score += 0.15;
  }

  const direction = biasDirection.left > biasDirection.right ? 'left' :
    biasDirection.right > biasDirection.left ? 'right' : 'neutral';
  const significant = score >= 0.4;
  const tags = biasTags(direction, significant);

  return {
    problemScore: problemScoreFromFraction(score),
    confidence: 0.6,
    tags,
    metadata: { biasDirection: direction },
    explanation: generateExplanation(score, tags),
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
        const fraction = problemScoreFromZeroShotPayload(parsed);
        const significant = fraction > 0.45;
        // Zero-shot only knows biased vs not — never invent bias:left.
        const tags = significant ? ['biased'] : ['bias:neutral'];
        return {
          problemScore: problemScoreFromFraction(fraction),
          confidence: Math.max(0.5, Math.min(0.95, parsed.scores?.[0] ?? 0.7)),
          tags,
          metadata: { biasDirection: 'unknown', diagnostic: 'local_zero_shot' },
          explanation: generateExplanation(fraction, tags),
        };
      }
      const direction = parsed.biasDirection || 'neutral';
      const fraction = Math.max(0, Math.min(1, parsed.problemScore ?? parsed.score ?? 0));
      const tags = parsed.tags?.length
        ? parsed.tags
        : biasTags(direction, fraction >= 0.4);
      return {
        problemScore: problemScoreFromFraction(fraction),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
        tags,
        metadata: { biasDirection: direction },
        explanation: parsed.explanation || 'Analysis completed'
      };
    }
  } catch (e) {
    // Fallback parsing
  }

  const scoreMatch = responseText.match(/score[:\s]+([\d.]+)/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.3;

  return {
    problemScore: problemScoreFromFraction(score),
    confidence: 0.5,
    tags: ['bias:neutral'],
    metadata: { biasDirection: 'neutral' },
    explanation: responseText.substring(0, 200)
  };
}

function generateExplanation(score, tags) {
  const label = Array.isArray(tags) ? tags.join(', ') : String(tags);
  if (score < 0.2) {
    return `Content appears balanced and objective (${label}).`;
  } else if (score < 0.5) {
    return `Some bias detected (${label}).`;
  } else {
    return `Significant bias detected (${label}). Content shows strong ideological slant.`;
  }
}

function getMockResults(context) {
  return {
    problemScore: 'medium' as const,
    confidence: 0.75 + Math.random() * 0.2,
    tags: ['bias:neutral'],
    metadata: { biasDirection: 'neutral' },
    explanation: 'Mock analysis for bias detection'
  };
}
