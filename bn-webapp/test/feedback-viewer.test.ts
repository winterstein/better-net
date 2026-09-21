/**
 * Webapp feedback viewer logic: the link code handoff, the view-state choice, and the API
 * client. See bn-webapp/specs/feedback/feedback-viewer/spec.md.
 *
 * The React components are thin wrappers over these, so the behaviour worth protecting
 * lives here and needs no browser.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { readLinkCode, stripLinkCode } from '../src/auth/link-code';
import { describeFeedback, feedbackView } from '../src/feedback/feedback-state';
import { ApiError, feedbackApi } from '../src/services/api';
import { requireToken } from '../src/auth/token';

describe('link code', () => {
	it('reads the code the extension put in the fragment', () => {
		expect(readLinkCode('#link=ABCD-2345')).toBe('ABCD-2345');
		expect(readLinkCode('link=ABCD-2345')).toBe('ABCD-2345');
		expect(readLinkCode('#link=abcd-2345')).toBe('ABCD-2345', );
	});

	it('is absent for an ordinary visit', () => {
		expect(readLinkCode('')).toBeNull();
		expect(readLinkCode('#')).toBeNull();
		expect(readLinkCode('#other=1')).toBeNull();
	});

	it('removes the code from the URL so it is not left in history', () => {
		const replaceState = vi.fn();
		stripLinkCode({
			location: { hash: '#link=ABCD-2345', pathname: '/feedback', search: '' },
			history: { replaceState },
		});
		expect(replaceState).toHaveBeenCalledWith(null, '', '/feedback');
	});

	it('keeps any other fragment state', () => {
		const replaceState = vi.fn();
		stripLinkCode({
			location: { hash: '#link=ABCD-2345&tab=notes', pathname: '/feedback', search: '?x=1' },
			history: { replaceState },
		});
		expect(replaceState).toHaveBeenCalledWith(null, '', '/feedback?x=1#tab=notes');
	});

	it('leaves a URL without a code alone', () => {
		const replaceState = vi.fn();
		stripLinkCode({
			location: { hash: '#tab=notes', pathname: '/feedback', search: '' },
			history: { replaceState },
		});
		expect(replaceState).not.toHaveBeenCalled();
	});
});

describe('which state to show', () => {
	const base = { isAuthenticated: true, isLoading: false };

	it('asks for sign-in before anything else', () => {
		expect(feedbackView({ isAuthenticated: false, isLoading: false }).kind).toBe('signin');
		expect(feedbackView({ isAuthenticated: false, isLoading: true }).kind).toBe('loading');
	});

	// The distinction the spec calls out: these must not share a message.
	it('separates "no devices linked" from "no feedback yet"', () => {
		expect(feedbackView({ ...base, linkedDevices: 0, rowCount: 0 }).kind).toBe('no-devices');
		expect(feedbackView({ ...base, linkedDevices: 1, rowCount: 0 }).kind).toBe('empty');
	});

	it('shows rows when there are any', () => {
		expect(feedbackView({ ...base, linkedDevices: 1, rowCount: 3 }).kind).toBe('rows');
	});

	it('reports an expired link without losing the signed-in state', () => {
		expect(feedbackView({ ...base, linkExpired: true, linkedDevices: 0 }).kind).toBe('link-expired');
	});

	it('reports errors', () => {
		const view = feedbackView({ ...base, error: 'boom' });
		expect(view).toEqual({ kind: 'error', message: 'boom' });
	});
});

describe('describing a correction', () => {
	it('reads a tag edit as the statement it is', () => {
		expect(describeFeedback({ tag: 'clickbait', tagOn: false })).toBe('Not "clickbait"');
		expect(describeFeedback({ tag: 'clickbait', tagOn: true })).toBe('Should be tagged "clickbait"');
	});

	it('reads a thumb, with its preset issue if there is one', () => {
		expect(describeFeedback({ thumbsUp: true })).toBe('Marked right');
		expect(describeFeedback({ thumbsUp: false, issueLabel: 'Score too high' })).toBe(
			'Marked wrong — Score too high'
		);
	});

	it('reads a retraction', () => {
		expect(describeFeedback({ thumbsUp: false, retracted: true })).toBe('Rating withdrawn');
	});
});

describe('api client', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubFetch(status: number, body: unknown) {
		const fetchMock = vi.fn(async () => ({
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
		}));
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	it('sends the token as a Bearer header, not a cookie', async () => {
		const fetchMock = stubFetch(200, { rows: [], total: 0, linkedDevices: 1 });
		await feedbackApi.myFeedback('tok-123');
		const [, init] = fetchMock.mock.calls[0] as any[];
		expect(init.headers.Authorization).toBe('Bearer tok-123');
		// Cookies would mean the API needs credentialed CORS; it deliberately does not.
		expect(init.credentials).toBeUndefined();
	});

	it('keeps 401, 403 and 410 distinguishable', async () => {
		stubFetch(403, { error: 'Staff only' });
		await expect(feedbackApi.allFeedback('tok')).rejects.toMatchObject({
			status: 403,
			message: 'Staff only',
		});

		stubFetch(410, { error: 'That link has expired' });
		await expect(feedbackApi.linkDevice('tok', 'ABCD-2345')).rejects.toBeInstanceOf(ApiError);
	});

	it('only sends filters that have a value', async () => {
		const fetchMock = stubFetch(200, { rows: [], total: 0 });
		await feedbackApi.allFeedback('tok', { target: 'module', moduleId: undefined, limit: 100 });
		const [url] = fetchMock.mock.calls[0] as any[];
		expect(url).toContain('target=module');
		expect(url).toContain('limit=100');
		expect(url).not.toContain('moduleId');
	});
});

describe('token guard', () => {
	it('treats a missing token as not signed in', async () => {
		await expect(requireToken(async () => undefined)).rejects.toThrow('Sign-in required');
		await expect(requireToken(async () => 'tok')).resolves.toBe('tok');
	});
});
