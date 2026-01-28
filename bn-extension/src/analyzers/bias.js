/**
 * Bias Analyzer
 * Analyzes content for political bias, ideological slant, or lack of objectivity
 * Browser-agnostic module
 */

/**
 * Analyze content for bias indicators
 * @param {Object} chunk - Content chunk with text and metadata
 * @param {Object} pageMetadata - Page-level metadata
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Analysis results
 */
export async function analyzeBias(chunk, pageMetadata = {}, options = {}) {
  const {
    mode = 'local',
    config = {}
  } = options;

  const text = chunk.text || '';
  const combinedContext = {
    text,
    url: pageMetadata.url || '',
    domain: pageMetadata.domain || '',
    title: pageMetadata.title || '',
    author: pageMetadata.author || ''
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
  return analyzeWithHeuristics(context);
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
  const biasDirection = { left: 0, right: 0, neutral: 0 };

  // Political keywords (simplified - in production, use more comprehensive lists)
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

  // Check for loaded language
  const loadedWords = ['obviously', 'clearly', 'undoubtedly', 'everyone knows', 'no one can deny'];
  const loadedCount = loadedWords.filter(word => text.includes(word)).length;
  if (loadedCount > 3) {
    score += 0.15;
    flags.push('loaded_language');
  }

  // Check for one-sided arguments
  const questionWords = ['however', 'although', 'on the other hand', 'alternatively', 'meanwhile'];
  const questionCount = questionWords.filter(word => text.includes(word)).length;
  if (questionCount === 0 && text.length > 500) {
    score += 0.1;
    flags.push('one_sided_argument');
  }

  // Check for emotional language
  const emotionalWords = ['outrageous', 'disgusting', 'appalling', 'shocking', 'terrible', 'amazing', 'incredible'];
  const emotionalCount = emotionalWords.filter(word => text.includes(word)).length;
  if (emotionalCount > 5) {
    score += 0.15;
    flags.push('excessive_emotional_language');
  }

  return {
    score: Math.min(score, 1.0),
    confidence: 0.6,
    flags,
    biasDirection: biasDirection.left > biasDirection.right ? 'left' : 
                   biasDirection.right > biasDirection.left ? 'right' : 'neutral',
    explanation: generateExplanation(score, flags, biasDirection)
  };
}

function getSystemPrompt() {
  return `You are a media analyst. Analyze the following content for political bias, ideological slant, or lack of objectivity.

Consider:
- Loaded or emotionally charged language
- One-sided presentation of arguments
- Selective use of facts
- Absence of counterarguments or alternative perspectives
- Political keyword usage patterns
- Overall tone and framing

Respond with a JSON object containing:
- score: float between 0 (objective/balanced) and 1 (highly biased)
- confidence: float between 0 and 1
- flags: array of specific bias indicators
- biasDirection: "left", "right", or "neutral"
- explanation: brief explanation of findings`;
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
      return {
        score: Math.max(0, Math.min(1, parsed.score || 0)),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
        flags: parsed.flags || [],
        biasDirection: parsed.biasDirection || 'neutral',
        explanation: parsed.explanation || 'Analysis completed'
      };
    }
  } catch (e) {
    // Fallback parsing
  }

  const scoreMatch = responseText.match(/score[:\s]+([\d.]+)/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.3;

  return {
    score: Math.max(0, Math.min(1, score)),
    confidence: 0.5,
    flags: [],
    biasDirection: 'neutral',
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
    score: 0.30 + Math.random() * 0.2,
    confidence: 0.75 + Math.random() * 0.2,
    flags: [],
    biasDirection: 'neutral',
    explanation: 'Mock analysis for bias detection'
  };
}

