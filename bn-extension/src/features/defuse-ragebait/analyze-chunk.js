/**
 * Toxicity Analyzer
 * Analyzes content for toxicity, hate speech, or harmful language
 * Browser-agnostic module
 */

import { analyzeWithLocalLLM } from '../../ai/analyze-local.js';

const ZERO_SHOT_LABELS = [
  'toxic hateful or harassing content',
  'respectful appropriate content',
];

/**
 * Analyze content for toxicity indicators
 * @param {Object} chunk - Content chunk with text and metadata
 * @param {Object} pageMetadata - Page-level metadata
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Analysis results
 */
export async function analyzeChunk(chunk, pageMetadata = {}, options = {}) {
  const {
    mode = 'local',
    config = {}
  } = options;

  const text = chunk.text || '';
  const combinedContext = {
    text,
    url: pageMetadata.url || '',
    domain: pageMetadata.domain || '',
    title: pageMetadata.title || ''
  };

  switch (mode) {
    case 'local':
      return await analyzeWithLocalModel(combinedContext, config);
    case 'openai':
      return await analyzeWithOpenAI(combinedContext, config);
    case 'anthropic':
      return await analyzeWithAnthropic(combinedContext, config);
    default:
      return getMockResults(combinedContext);
  }
}

async function analyzeWithLocalModel(context, config) {
  return analyzeWithLocalLLM({
    modelId: config.localModelId,
    systemPrompt: getSystemPrompt(),
    context,
    candidateLabels: ZERO_SHOT_LABELS,
    parseResponse: parseAIResponse,
    fallback: () => analyzeWithHeuristics(context),
  });
}

async function analyzeWithOpenAI(context, config) {
  if (!config.apiKey) {
    return getMockResults(context);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4',
        messages: [
          {
            role: 'system',
            content: getSystemPrompt()
          },
          {
            role: 'user',
            content: formatContextForPrompt(context)
          }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return parseAIResponse(data.choices[0]?.message?.content || '');
  } catch (error) {
    console.error('OpenAI analysis error:', error);
    return analyzeWithHeuristics(context);
  }
}

async function analyzeWithAnthropic(context, config) {
  if (!config.apiKey) {
    return getMockResults(context);
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model || 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `${getSystemPrompt()}\n\n${formatContextForPrompt(context)}`
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const data = await response.json();
    return parseAIResponse(data.content[0]?.text || '');
  } catch (error) {
    console.error('Anthropic analysis error:', error);
    return analyzeWithHeuristics(context);
  }
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

  // Profanity detection (simplified - in production use comprehensive word lists)
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

  // Hate speech indicators (simplified patterns)
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

  // Harassment indicators
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

  // Threat indicators
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

  // Check for excessive caps (often indicates anger)
  const capsRatio = (text.match(/[A-Z]{3,}/g) || []).length / Math.max(text.split(' ').length, 1);
  if (capsRatio > 0.1 && text.length > 100) {
    score += 0.1;
    flags.push('excessive_caps');
  }

  // Check for personal attacks
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
    score: Math.min(score, 1.0),
    confidence: 0.6,
    flags,
    categories,
    explanation: generateExplanation(score, flags, categories)
  };
}

function getSystemPrompt() {
  return `You are a content moderation expert. Analyze the following content for toxicity, hate speech, or harmful language.

Consider:
- Profanity or offensive language
- Hate speech targeting protected groups
- Harassment or bullying
- Threats of violence
- Personal attacks
- Excessive hostility or aggression
- Context is important - distinguish between discussion of sensitive topics and actual harmful content

Respond with a JSON object containing:
- score: float between 0 (not toxic) and 1 (highly toxic)
- confidence: float between 0 and 1
- flags: array of specific toxicity indicators
- categories: object with categories like profanity, hate_speech, harassment, threats
- explanation: brief explanation of findings`;
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
        score: Math.max(0, Math.min(1, parsed.score || 0)),
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
    score: Math.max(0, Math.min(1, score)),
    confidence: 0.5,
    flags: [],
    categories: {},
    explanation: responseText.substring(0, 200)
  };
}

function generateExplanation(score, flags, categories) {
  const activeCategories = Object.entries(categories)
    .filter(([_, value]) => value > 0)
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
    score: 0.25 + Math.random() * 0.15,
    confidence: 0.80 + Math.random() * 0.15,
    flags: [],
    categories: {},
    explanation: 'Mock analysis for toxicity detection'
  };
}

