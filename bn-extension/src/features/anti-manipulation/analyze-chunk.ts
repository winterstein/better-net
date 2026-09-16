/**
 * Anti-manipulation
 * Detects dark patterns, urgency/scarcity tricks, phishing-shaped asks.
 * Product tags: urgency, scarcity, sneaky, fear, too-good-to-be-true, phishing.
 */

import { runFeatureAnalysis } from '../../ai/run-feature-analysis.js';
import {
	isZeroShotPayload,
	problemScoreFromZeroShotPayload,
} from '../zero-shot-score.js';
import { problemScoreFromFraction } from '../../types/Score.js';

const PROMPT_ID = 'anti-manipulation';

// Phrasing calibrated for MNLI zero-shot (avoids false-positives on normal news).
const ZERO_SHOT_LABELS = [
  'spam scam',
  'real content',
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
      links: (c.links || []).map(l => l.url),
      url: meta.url || '',
      domain: meta.domain || '',
      title: meta.title || '',
    }),
    formatContextForPrompt,
    parseAIResponse,
    heuristicFallback: analyzeWithHeuristics,
    mockResults: getMockResults,
  });
}

function analyzeWithHeuristics(context) {
  const text = context.text.toLowerCase();
  let score = 0;
  const tags = [];

  const urgencyPhrases = [
    'limited time', 'act now', 'expires soon', 'only today', 
    'don\'t miss out', 'urgent', 'immediate action required',
    'before it\'s too late', 'last chance'
  ];
  const urgencyCount = urgencyPhrases.filter(phrase => text.includes(phrase)).length;
  if (urgencyCount > 2) {
    score += 0.3;
    tags.push('urgency');
  }

  const scarcityPhrases = ['only 2 left', 'only a few left', 'selling fast', 'almost gone', 'limited stock'];
  if (scarcityPhrases.some(phrase => text.includes(phrase))) {
    score += 0.2;
    tags.push('scarcity');
  }

  const tooGoodPhrases = [
    'guaranteed returns', 'risk-free investment', 'get rich quick',
    'work from home', 'make money fast', 'no experience needed',
    'free money', 'click here to claim', 'you\'ve won'
  ];
  const tooGoodCount = tooGoodPhrases.filter(phrase => text.includes(phrase)).length;
  if (tooGoodCount > 2) {
    score += 0.4;
    tags.push('too-good-to-be-true');
  }

  const personalInfoPhrases = [
    'enter your password', 'verify your account', 'confirm your identity',
    'social security number', 'credit card number', 'bank account',
    'send payment', 'wire transfer', 'gift cards'
  ];
  const personalInfoCount = personalInfoPhrases.filter(phrase => text.includes(phrase)).length;
  if (personalInfoCount > 1) {
    score += 0.35;
    tags.push('phishing');
  }

  return {
    problemScore: problemScoreFromFraction(Math.min(score, 1.0)),
    confidence: 0.65,
    tags,
    explanation: generateExplanation(score, tags),
  };
}

function formatContextForPrompt(context) {
  return `URL: ${context.url || 'N/A'}
Domain: ${context.domain || 'N/A'}
Title: ${context.title || 'N/A'}

Content:
${context.text}

Links found:
${context.links?.join('\n') || 'None'}`;
}

function parseAIResponse(responseText) {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (isZeroShotPayload(parsed)) {
        const problemScore = problemScoreFromZeroShotPayload(parsed);
        const tags = problemScore > 0.45 ? ['phishing'] : [];
        return {
          problemScore,
          confidence: Math.max(0.5, Math.min(0.95, parsed.scores?.[0] ?? 0.7)),
          tags,
          metadata: { diagnostic: 'local_zero_shot' },
          explanation: generateExplanation(problemScore, tags),
        };
      }
      return {
        problemScore: problemScoreFromFraction(Math.max(0, Math.min(1, parsed.problemScore ?? parsed.score ?? 0))),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
        tags: parsed.tags || [],
        explanation: parsed.explanation || 'Analysis completed'
      };
    }
  } catch (e) {
    // Fallback parsing
  }

  const scoreMatch = responseText.match(/score[:\s]+([\d.]+)/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.05;

  return {
    problemScore: problemScoreFromFraction(Math.max(0, Math.min(1, score))),
    confidence: 0.5,
    tags: [],
    explanation: responseText.substring(0, 200)
  };
}

function generateExplanation(score, tags) {
  if (score < 0.2) {
    return 'Content appears legitimate with minimal manipulation indicators.';
  } else if (score < 0.5) {
    return `Some concerning indicators detected: ${tags.join(', ')}. Exercise caution.`;
  } else {
    return `Multiple manipulation indicators detected: ${tags.join(', ')}. High risk of deceptive content.`;
  }
}

function getMockResults(context) {
  return {
    problemScore: problemScoreFromFraction(0.05 + Math.random() * 0.1),
    confidence: 0.90 + Math.random() * 0.1,
    tags: [],
    explanation: 'Mock analysis for anti-manipulation detection'
  };
}
