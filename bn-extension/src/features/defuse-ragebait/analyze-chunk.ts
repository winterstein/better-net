/**
 * Defuse Ragebait
 * Detects outrage-bait and harmful language.
 * Product tags: ragebait, hate-speech, threat, personal-attack, trigger:X (trigger TODO).
 */

import { runFeatureAnalysis } from '../../ai/run-feature-analysis.js';
import {
	isZeroShotPayload,
	problemScoreFromZeroShotPayload,
} from '../zero-shot-score.js';

const PROMPT_ID = 'defuse-ragebait';

// Phrasing calibrated for MNLI zero-shot (avoids false-positives on normal news).
const ZERO_SHOT_LABELS = [
  'This text is toxic hate speech',
  'This text is respectful',
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

  const hateSpeechPatterns = [
    /\b(all|those|them) (.*?) (are|is) (stupid|idiots|worthless|trash|scum)\b/i,
    /\b(deserve|should) (die|burn|suffer)\b/i,
    /\b(race|religion|ethnicity|gender) (.*?) (inferior|superior)\b/i
  ];
  if (hateSpeechPatterns.some(pattern => pattern.test(text))) {
    score += 0.4;
    tags.push('hate-speech');
  }

  const threatPatterns = [
    /\b(i will|i'll|i'm going to) (hurt|harm|kill|attack|destroy) (you|your|them)\b/i,
    /\b(you will|you'll) (regret|pay|suffer)\b/i,
    /\b(watch out|be careful|i'm coming for)\b/i
  ];
  if (threatPatterns.some(pattern => pattern.test(text))) {
    score += 0.4;
    tags.push('threat');
  }

  const attackPatterns = [
    /\b(you are|you're|you) (a|an) (idiot|moron|stupid|dumb|fool)\b/i,
    /\b(kill yourself|kys|off yourself)\b/i,
    /\b(shut up|go away|get lost)\b/i
  ];
  if (attackPatterns.some(pattern => pattern.test(text))) {
    score += 0.25;
    tags.push('personal-attack');
  }

  const ragebaitPatterns = [
    /\b(outraged|infuriating|you won't believe what they|destroyed by|owned by)\b/i,
    /\b(this is why (we|you) can't have)\b/i,
  ];
  if (ragebaitPatterns.some(pattern => pattern.test(text))) {
    score += 0.2;
    tags.push('ragebait');
  }

  return {
    problemScore: Math.min(score, 1.0),
    confidence: 0.6,
    tags,
    explanation: generateExplanation(score, tags),
  };
}

function formatContextForPrompt(context) {
  return `URL: ${context.url || 'N/A'}
Domain: ${context.domain || 'N/A'}
Title: ${context.title || 'N/A'}

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
        const tags = problemScore > 0.45 ? ['hate-speech'] : [];
        return {
          problemScore,
          confidence: Math.max(0.5, Math.min(0.95, parsed.scores?.[0] ?? 0.7)),
          tags,
          metadata: { diagnostic: 'local_zero_shot' },
          explanation: generateExplanation(problemScore, tags),
        };
      }
      return {
        problemScore: Math.max(0, Math.min(1, parsed.problemScore ?? parsed.score ?? 0)),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
        tags: parsed.tags || [],
        explanation: parsed.explanation || 'Analysis completed'
      };
    }
  } catch (e) {
    // Fallback parsing
  }

  const scoreMatch = responseText.match(/score[:\s]+([\d.]+)/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.25;

  return {
    problemScore: Math.max(0, Math.min(1, score)),
    confidence: 0.5,
    tags: [],
    explanation: responseText.substring(0, 200)
  };
}

function generateExplanation(score, tags) {
  if (score < 0.2) {
    return 'Content appears non-toxic and appropriate.';
  } else if (score < 0.5) {
    return `Some concerning language detected: ${tags.join(', ') || 'mild signals'}.`;
  } else {
    return `High toxicity detected: ${tags.join(', ')}.`;
  }
}

function getMockResults(context) {
  return {
    problemScore: 0.25 + Math.random() * 0.15,
    confidence: 0.80 + Math.random() * 0.15,
    tags: [],
    explanation: 'Mock analysis for ragebait detection'
  };
}
