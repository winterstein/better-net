/**
 * Toxicity Analyzer
 * Analyzes content for toxicity, hate speech, or harmful language
 */

import { runFeatureAnalysis } from '../../ai/run-feature-analysis.js';

const PROMPT_ID = 'defuse-ragebait';

const ZERO_SHOT_LABELS = [
  'toxic hateful or harassing content',
  'respectful appropriate content',
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
  const flags = [];
  const categories = {
    profanity: 0,
    hate_speech: 0,
    harassment: 0,
    threats: 0
  };

  const profanityPatterns = [
    /\b(f\*ck|f\*\*k|damn|hell|b\*tch|sh\*t)\b/i,
    /\b(a\*s|a\*\*|cr\*p)\b/i
  ];
  const profanityMatches = profanityPatterns.filter(pattern => pattern.test(text)).length;
  if (profanityMatches > 0) {
    score += 0.15;
    categories.profanity = 1;
    flags.push('profanity');
  }

  const hateSpeechPatterns = [
    /\b(all|those|them) (.*?) (are|is) (stupid|idiots|worthless|trash|scum)\b/i,
    /\b(deserve|should) (die|burn|suffer)\b/i,
    /\b(race|religion|ethnicity|gender) (.*?) (inferior|superior)\b/i
  ];
  const hateMatches = hateSpeechPatterns.filter(pattern => pattern.test(text)).length;
  if (hateMatches > 0) {
    score += 0.4;
    categories.hate_speech = 1;
    flags.push('hate_speech');
  }

  const harassmentPatterns = [
    /\b(kill yourself|kys|off yourself)\b/i,
    /\b(you should|you deserve) (die|suffer|hurt)\b/i,
    /\b(no one|nobody) (likes|loves|wants) (you|your)\b/i
  ];
  const harassmentMatches = harassmentPatterns.filter(pattern => pattern.test(text)).length;
  if (harassmentMatches > 0) {
    score += 0.35;
    categories.harassment = 1;
    flags.push('harassment');
  }

  const threatPatterns = [
    /\b(i will|i'll|i'm going to) (hurt|harm|kill|attack|destroy) (you|your|them)\b/i,
    /\b(you will|you'll) (regret|pay|suffer)\b/i,
    /\b(watch out|be careful|i'm coming for)\b/i
  ];
  const threatMatches = threatPatterns.filter(pattern => pattern.test(text)).length;
  if (threatMatches > 0) {
    score += 0.4;
    categories.threats = 1;
    flags.push('threats');
  }

  const capsRatio = (text.match(/[A-Z]{3,}/g) || []).length / Math.max(text.split(' ').length, 1);
  if (capsRatio > 0.1 && text.length > 100) {
    score += 0.1;
    flags.push('excessive_caps');
  }

  const attackPatterns = [
    /\b(you are|you're|you) (a|an) (idiot|moron|stupid|dumb|fool)\b/i,
    /\b(shut up|go away|get lost|f\*\*k off)\b/i
  ];
  const attackMatches = attackPatterns.filter(pattern => pattern.test(text)).length;
  if (attackMatches > 0) {
    score += 0.2;
    flags.push('personal_attacks');
  }

  return {
    problemScore: Math.min(score, 1.0),
    confidence: 0.6,
    flags,
    categories,
    explanation: generateExplanation(score, flags, categories)
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
      return {
        problemScore: Math.max(0, Math.min(1, parsed.problemScore ?? parsed.score ?? 0)),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
        flags: parsed.flags || [],
        categories: parsed.categories || {},
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
    flags: [],
    categories: {},
    explanation: responseText.substring(0, 200)
  };
}

function generateExplanation(score, flags, categories) {
  const activeCategories = Object.entries(categories)
    .filter(([_, value]) => (value as number) > 0)
    .map(([key, _]) => key.replace('_', ' '));
  
  if (score < 0.2) {
    return 'Content appears non-toxic and appropriate.';
  } else if (score < 0.5) {
    return `Some concerning language detected: ${flags.join(', ')}.`;
  } else {
    return `High toxicity detected: ${flags.join(', ')}. ${activeCategories.length > 0 ? `Categories: ${activeCategories.join(', ')}.` : ''}`;
  }
}

function getMockResults(context) {
  return {
    problemScore: 0.25 + Math.random() * 0.15,
    confidence: 0.80 + Math.random() * 0.15,
    flags: [],
    categories: {},
    explanation: 'Mock analysis for toxicity detection'
  };
}
