/**
 * Scams Analyzer
 * Analyzes content for scams, fraud, or deceptive practices
 */

import { runFeatureAnalysis } from '../../ai/run-feature-analysis.js';
import {
	isZeroShotPayload,
	problemScoreFromZeroShotPayload,
} from '../zero-shot-score.js';

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
  const flags = [];

  const urgencyPhrases = [
    'limited time', 'act now', 'expires soon', 'only today', 
    'don\'t miss out', 'urgent', 'immediate action required',
    'before it\'s too late', 'last chance'
  ];
  const urgencyCount = urgencyPhrases.filter(phrase => text.includes(phrase)).length;
  if (urgencyCount > 2) {
    score += 0.3;
    flags.push('urgency_pressure');
  }

  const financialScamPhrases = [
    'guaranteed returns', 'risk-free investment', 'get rich quick',
    'work from home', 'make money fast', 'no experience needed',
    'free money', 'click here to claim', 'you\'ve won'
  ];
  const financialCount = financialScamPhrases.filter(phrase => text.includes(phrase)).length;
  if (financialCount > 2) {
    score += 0.4;
    flags.push('financial_scam_indicators');
  }

  if (context.domain) {
    const suspiciousPatterns = [
      /\.tk$/, /\.ml$/, /\.ga$/, /\.cf$/,
      /bit\.ly/, /tinyurl/, /short\.link/,
      /[0-9]{4,}/
    ];
    const hasSuspiciousDomain = suspiciousPatterns.some(pattern => pattern.test(context.domain));
    if (hasSuspiciousDomain) {
      score += 0.2;
      flags.push('suspicious_domain');
    }
  }

  if (context.links && context.links.length > 0) {
    const suspiciousLinks = context.links.filter(url => {
      try {
        const urlObj = new URL(url);
        return /\.tk$|\.ml$|\.ga$|\.cf$|bit\.ly|tinyurl/i.test(urlObj.hostname);
      } catch {
        return false;
      }
    });
    if (suspiciousLinks.length > 0) {
      score += 0.15;
      flags.push('suspicious_links');
    }
  }

  const personalInfoPhrases = [
    'enter your password', 'verify your account', 'confirm your identity',
    'social security number', 'credit card number', 'bank account',
    'send payment', 'wire transfer', 'gift cards'
  ];
  const personalInfoCount = personalInfoPhrases.filter(phrase => text.includes(phrase)).length;
  if (personalInfoCount > 1) {
    score += 0.35;
    flags.push('personal_info_request');
  }

  const commonErrors = ['congratulation', 'your account has been', 'click below'];
  const errorCount = commonErrors.filter(phrase => text.includes(phrase)).length;
  if (errorCount > 0 && text.length < 300) {
    score += 0.1;
    flags.push('poor_grammar_quality');
  }

  return {
    problemScore: Math.min(score, 1.0),
    confidence: 0.65,
    flags,
    explanation: generateExplanation(score, flags),
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
        const flags = problemScore > 0.45 ? ['local_zero_shot'] : [];
        return {
          problemScore,
          confidence: Math.max(0.5, Math.min(0.95, parsed.scores?.[0] ?? 0.7)),
          flags,
          explanation: generateExplanation(problemScore, flags),
        };
      }
      return {
        problemScore: Math.max(0, Math.min(1, parsed.problemScore ?? parsed.score ?? 0)),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
        flags: parsed.flags || [],
        explanation: parsed.explanation || 'Analysis completed'
      };
    }
  } catch (e) {
    // Fallback parsing
  }

  const scoreMatch = responseText.match(/score[:\s]+([\d.]+)/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.05;

  return {
    problemScore: Math.max(0, Math.min(1, score)),
    confidence: 0.5,
    flags: [],
    explanation: responseText.substring(0, 200)
  };
}

function generateExplanation(score, flags) {
  if (score < 0.2) {
    return 'Content appears legitimate with minimal scam indicators.';
  } else if (score < 0.5) {
    return `Some concerning indicators detected: ${flags.join(', ')}. Exercise caution.`;
  } else {
    return `Multiple scam indicators detected: ${flags.join(', ')}. High risk of fraudulent or deceptive content.`;
  }
}

function getMockResults(context) {
  return {
    problemScore: 0.05 + Math.random() * 0.1,
    confidence: 0.90 + Math.random() * 0.1,
    flags: [],
    explanation: 'Mock analysis for scam detection'
  };
}
