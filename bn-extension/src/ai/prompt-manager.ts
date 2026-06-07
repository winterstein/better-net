/** Manage prompts for AI analysis. Can handle versioning. */

import { PROMPT_TEXT } from '../prompts/prompt-text.js';

export function getPrompt(promptId: string, version = 'latest', variant = 'default'): string {
	const key = `${promptId}.${version}.${variant}`;
	const text = PROMPT_TEXT[key];
	if (!text) {
		throw new Error(`Prompt not found: ${key}`);
	}
	return text;
}
