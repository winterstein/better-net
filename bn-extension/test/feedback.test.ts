/**
 * Unit tests for chunk-aspect feedback client.
 */

import assert from 'node:assert/strict';
import { moduleToAspect, MODULE_ASPECT_MAP } from '../src/feedback/aspect-map.js';
import {
	buildFeedbackSubmission,
	isFeedbackEnabled,
	MAX_FEEDBACK_MESSAGE_LENGTH,
} from '../src/feedback/feedback-client.js';
import { AspectType } from '../src/types/AspectAnalysis.js';

assert.equal(moduleToAspect('factChecker'), AspectType.ACCURACY);
assert.equal(moduleToAspect('biasDetector'), AspectType.BIAS);
assert.equal(moduleToAspect('defuseRagebait'), AspectType.TOXICITY);
assert.equal(moduleToAspect('clickUnbait'), AspectType.CLICKBAIT);
assert.equal(moduleToAspect('unknown'), undefined);
assert.ok(Object.keys(MODULE_ASPECT_MAP).length >= 5);

assert.equal(isFeedbackEnabled({ shareAnonymous: false, serverEndpoint: 'http://x' }), false);
assert.equal(isFeedbackEnabled({ shareAnonymous: true, serverEndpoint: '' }), false);
assert.equal(isFeedbackEnabled({ shareAnonymous: true, serverEndpoint: 'http://localhost:3001' }), true);

const ok = buildFeedbackSubmission(
	{
		chunkFingerprint: 'abc',
		chunkUrl: 'https://example.com',
		moduleId: 'factChecker',
		applies: false,
		message: 'Looks fine to me',
		problemScore: 0.8,
	},
	'user-1'
);
assert.ok(!('error' in ok));
assert.equal(ok.aspectType, AspectType.ACCURACY);
assert.equal(ok.applies, false);
assert.equal(ok.message, 'Looks fine to me');

const tooLong = buildFeedbackSubmission(
	{
		chunkFingerprint: 'abc',
		chunkUrl: 'https://example.com',
		moduleId: 'factChecker',
		applies: false,
		message: 'x'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 1),
	},
	'user-1'
);
assert.ok('error' in tooLong);

const thumbsUp = buildFeedbackSubmission(
	{
		chunkFingerprint: 'abc',
		chunkUrl: 'https://example.com',
		moduleId: 'biasDetector',
		applies: true,
		message: 'should be dropped',
	},
	'user-1'
);
assert.ok(!('error' in thumbsUp));
assert.equal(thumbsUp.message, undefined);

console.log('✅ feedback tests passed');
