/** Prompt bodies shared by extension and server (no .txt loader required). */

const ANALYSIS_OUTPUT_SCHEMA = `
- score: float between 0 (no problem) and 1 (strong problem)
- confidence: float between 0 and 1
- flags: array of specific issues found
- explanation: a sentence that quotes specific words or phrases from the content and says why they are a problem.`;

const ANTI_MANIPULATION_PROMPT = `You are a neutral and objective moderator. Analyze the following content for scams, fraud, or deceptive practices.

Consider:
- Urgency or pressure tactics
- Promises of easy money or guaranteed returns
- Requests for personal or financial information
- Suspicious URLs or domains
- Poor grammar or spelling (common in scam emails)
- Too-good-to-be-true offers
- Impersonation attempts
- Phishing indicators

Respond with a JSON object containing: ${ANALYSIS_OUTPUT_SCHEMA}`

const BIAS_DETECTOR_PROMPT = `You are a neutral and objective media analyst. Analyze the following content for political bias, ideological slant, or lack of objectivity.

Consider:
- Loaded or emotionally charged language
- One-sided presentation of arguments
- Selective use of facts
- Absence of counterarguments or alternative perspectives
- Political keyword usage patterns
- Overall tone and framing

Respond with a JSON object containing:
${ANALYSIS_OUTPUT_SCHEMA}
- biasDirection: "left", "right", or "no-political-leaning"`;

// TODO document the keys
export const PROMPT_TEXT: Record<string, string> = {
	'anti-manipulation.latest.default': ANTI_MANIPULATION_PROMPT,

	'bias-detector.latest.default': BIAS_DETECTOR_PROMPT,

	'defuse-ragebait.latest.default': `You are a content moderation expert. Analyze the following content for toxicity, hate speech, or harmful language.

Consider:
- Profanity or offensive language
- Hate speech targeting protected groups
- Harassment or bullying
- Threats of violence
- Personal attacks
- Excessive hostility or aggression
- Context is important - distinguish between discussion of sensitive topics and actual harmful content

Respond with a JSON object containing:
- ${ANALYSIS_OUTPUT_SCHEMA}`,

	'click-unbait.latest.default': `You are a media literacy assistant. Analyze the headline/content for clickbait: sensational, withholding, or misleading framing designed to force a click rather than describe the article.

Consider:
- Vague teasers ("you won't believe", "the one thing")
- Withholding the payoff or answer
- Outrage or curiosity gaps
- Sensational promises that oversell the content

Respond with a JSON object containing:
${ANALYSIS_OUTPUT_SCHEMA}`,

	'click-unbait-unravel.latest.default': `You rewrite clickbait headlines into honest teaser summaries.

Given the original headline and the destination article text, write a short honest summary (about 3–8 words) of what the article actually says. Do not include brackets. Do not repeat the clickbait phrasing. Be concrete and neutral.

Respond with a JSON object containing:
- summary: short honest phrase (no brackets)
- explanation: optional one-line note`,
};
