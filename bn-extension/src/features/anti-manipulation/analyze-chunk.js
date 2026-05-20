/**
 * Scams Analyzer
 * Analyzes content for scams, fraud, or deceptive practices
 * Browser-agnostic module
 */

import { analyzeWithLocalLLM } from '../../ai/analyze-local.js';

const ZERO_SHOT_LABELS = [
  'scam fraud or deceptive content',
  'legitimate trustworthy content',
];

/**
 * Analyze content for scam indicators
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
  const links = chunk.links || [];
  const combinedContext = {
    text,
    links: links.map(l => l.url),
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

  // Urgency indicators
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

  // Financial scam indicators
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

  // Suspicious URL patterns
  if (context.domain) {
    const suspiciousPatterns = [
      /\.tk$/, /\.ml$/, /\.ga$/, /\.cf$/, // Free domains often used for scams
      /bit\.ly/, /tinyurl/, /short\.link/, // URL shorteners
      /[0-9]{4,}/ // Long numeric domains
    ];
    const hasSuspiciousDomain = suspiciousPatterns.some(pattern => pattern.test(context.domain));
    if (hasSuspiciousDomain) {
      score += 0.2;
      flags.push('suspicious_domain');
    }
  }

  // Check for suspicious links
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

  // Request for personal information
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

  // Grammar/spelling errors (common in scams)
  const commonErrors = ['congratulation', 'your account has been', 'click below'];
  const errorCount = commonErrors.filter(phrase => text.includes(phrase)).length;
  if (errorCount > 0 && text.length < 300) {
    score += 0.1;
    flags.push('poor_grammar_quality');
  }

  return {
    score: Math.min(score, 1.0),
    confidence: 0.65,
    flags,
    explanation: generateExplanation(score, flags)
  };
}

function getSystemPrompt() {
  return `You are a security expert. Analyze the following content for scams, fraud, or deceptive practices.

Consider:
- Urgency or pressure tactics
- Promises of easy money or guaranteed returns
- Requests for personal or financial information
- Suspicious URLs or domains
- Poor grammar or spelling (common in scam emails)
- Too-good-to-be-true offers
- Impersonation attempts
- Phishing indicators

Respond with a JSON object containing:
- score: float between 0 (legitimate) and 1 (likely scam)
- confidence: float between 0 and 1
- flags: array of specific scam indicators found
- explanation: brief explanation of findings`;
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
      return {
        score: Math.max(0, Math.min(1, parsed.score || 0)),
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
    score: Math.max(0, Math.min(1, score)),
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
    score: 0.05 + Math.random() * 0.1,
    confidence: 0.90 + Math.random() * 0.1,
    flags: [],
    explanation: 'Mock analysis for scam detection'
  };
}

