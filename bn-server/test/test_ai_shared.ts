import tap from 'tap';
import { createLLMClient } from '../src/bn-extension-src/ai/llm-client.js';
import { buildServerAnalysisOptions } from '../src/ai/server-analysis.js';

tap.test('createLLMClient returns null without keys', (t) => {
	t.equal(createLLMClient('openai', {}), null);
	t.equal(createLLMClient('anthropic', {}), null);
	t.equal(createLLMClient('local', {}), null);
	t.end();
});

tap.test('buildServerAnalysisOptions defaults to heuristic', (t) => {
	const prev = { ...process.env };
	delete process.env.BN_OPENAI_API_KEY;
	delete process.env.BN_ANTHROPIC_API_KEY;

	const opts = buildServerAnalysisOptions({});
	t.equal(opts.mode, 'heuristic');
	t.equal(opts.localBackend, null);

	process.env.BN_OPENAI_API_KEY = prev.BN_OPENAI_API_KEY;
	process.env.BN_ANTHROPIC_API_KEY = prev.BN_ANTHROPIC_API_KEY;
	t.end();
});
