/**
 * Shared analysis, extension side (bn-server/specs/shared-analysis/spec.md).
 *
 * Lifecycle for one page, driven by the background worker:
 * 1. openSharedAnalysis() — if the user opted in and the page is suitable, one lookup
 *    by url. Otherwise null, and nothing is sent.
 * 2. The engine reads hits and queues fresh results through the returned object
 *    (analysis/engine.ts analyzeFeature).
 * 3. upload() at the end of each pass sends what was queued.
 *
 * The server is a cache, so every failure here is quiet: a lookup that fails means the
 * page is analysed as usual, and an upload that fails is dropped rather than retried.
 *
 * What is sent: the normalised page url, content hashes, and results. Never chunk text.
 */

import { logit } from '../utils/logger.js';
import { modelRank } from '../ai/model-info.js';
import type { ModuleAnalysis } from '../types/ModuleAnalysis.js';
import type { SharedAnalysis } from '../types/AnalysisOptions.js';
import { DEFAULT_SITE_LIST, normalizeShareUrl, sharePageBlockReason } from './share-rules.js';
import type { SharePage, SiteListEntry } from './share-rules.js';

const SHARE_ID_KEY = 'bnShareId';
const SITE_LIST_KEY = 'bnSiteList';

/** The server's site list changes rarely; a day-old copy is fine. */
const SITE_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A slow cache is worse than no cache: past this, analyse locally. */
const LOOKUP_TIMEOUT_MS = 3000;

export interface SharedResult {
	featureId: string;
	chunkKey: string;
	model: string;
	result: Partial<ModuleAnalysis>;
}

/** The single opt-in, covering lookup and upload. Off by default (settings/defaults.ts). */
export function isSharingEnabled(settings: { useServerCache?: boolean; serverEndpoint?: string }): boolean {
	return !!(settings?.useServerCache && settings.serverEndpoint?.trim());
}

/**
 * The contributor id sent with uploads, so the server can remove a bad actor's data.
 *
 * Deliberately not the local id (feedback-client.ts): that one is tied to feedback and,
 * for a linked browser, to an account. This id is random, used only here, and replaced
 * every calendar month, so what the server can tie together is one month at most.
 */
export async function getShareId(now: Date = new Date()): Promise<string> {
	const month = now.toISOString().slice(0, 7);
	const { [SHARE_ID_KEY]: stored } = await chrome.storage.local.get(SHARE_ID_KEY);
	if (stored?.id && stored.month === month) return stored.id;
	const id = crypto.randomUUID();
	await chrome.storage.local.set({ [SHARE_ID_KEY]: { id, month } });
	return id;
}

/** The site list held in this browser: the server's copy if one was fetched, else the bundled seed. No network. */
export async function loadSiteList(): Promise<SiteListEntry[]> {
	try {
		const { [SITE_LIST_KEY]: stored } = await chrome.storage.local.get(SITE_LIST_KEY);
		if (Array.isArray(stored?.list) && stored.list.length) return stored.list;
	} catch {
		// No chrome.storage (tests, a non-extension host): the seed list.
	}
	return DEFAULT_SITE_LIST;
}

/** Fetch the server's site list if ours is over a day old. Returns the list to use either way. */
export async function refreshSiteList(
	serverEndpoint: string,
	fetchImpl: typeof fetch = fetch
): Promise<SiteListEntry[]> {
	const { [SITE_LIST_KEY]: stored } = await chrome.storage.local.get(SITE_LIST_KEY);
	if (Array.isArray(stored?.list) && Date.now() - (stored.fetched ?? 0) < SITE_LIST_MAX_AGE_MS) {
		return stored.list;
	}
	try {
		const res = await fetchImpl(`${serverEndpoint.replace(/\/$/, '')}/api/shared-analysis/site-lists`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const { list } = await res.json();
		if (!Array.isArray(list)) throw new Error('no list');
		await chrome.storage.local.set({ [SITE_LIST_KEY]: { list, fetched: Date.now() } });
		return list;
	} catch (err) {
		logit('warn', '[BetterNet] [SHARED] site list fetch failed:', err);
		return stored?.list?.length ? stored.list : DEFAULT_SITE_LIST;
	}
}

async function postJson(serverEndpoint: string, path: string, body: unknown, fetchImpl: typeof fetch): Promise<any> {
	const res = await fetchImpl(`${serverEndpoint.replace(/\/$/, '')}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

export interface PageShare extends SharedAnalysis {
	/** Send the results queued since the last upload. Resolves to how many were sent. */
	upload(): Promise<number>;
}

/**
 * Shared analysis for one page, or null when the user has not opted in or the page is
 * unsuitable — in which case no request is made at all.
 */
export async function openSharedAnalysis(
	page: SharePage,
	settings: { useServerCache?: boolean; serverEndpoint?: string },
	fetchImpl: typeof fetch = fetch
): Promise<PageShare | null> {
	if (!isSharingEnabled(settings)) return null;
	const serverEndpoint = settings.serverEndpoint.trim();
	const url = normalizeShareUrl(page.url ?? '');
	const list = await refreshSiteList(serverEndpoint, fetchImpl);
	const blocked = sharePageBlockReason(page, list);
	if (blocked) {
		logit('log', '[BetterNet] [SHARED] page not shared:', blocked);
		return null;
	}

	const hits = new Map<string, SharedResult>();
	try {
		const { results = [] } = await postJson(serverEndpoint, '/api/shared-analysis/lookup', { url }, fetchImpl);
		for (const hit of results as SharedResult[]) {
			if (hit?.featureId && hit.chunkKey && hit.result) hits.set(`${hit.featureId}\n${hit.chunkKey}`, hit);
		}
		logit('log', '[BetterNet] [SHARED] lookup returned', hits.size, 'result(s)');
	} catch (err) {
		logit('warn', '[BetterNet] [SHARED] lookup failed:', err);
	}

	let pending: SharedResult[] = [];
	return {
		get(featureId, chunkKey, myModel) {
			const hit = hits.get(`${featureId}\n${chunkKey}`);
			if (!hit || modelRank(hit.model) < modelRank(myModel)) return undefined;
			return { ...hit.result, model: hit.result.model || hit.model };
		},
		add(featureId, chunkKey, model, result) {
			pending.push({ featureId, chunkKey, model, result });
		},
		async upload() {
			const results = pending;
			pending = [];
			if (!results.length) return 0;
			try {
				const shareId = await getShareId();
				await postJson(serverEndpoint, '/api/shared-analysis', { shareId, url, results }, fetchImpl);
				return results.length;
			} catch (err) {
				logit('warn', '[BetterNet] [SHARED] upload failed, dropped:', err);
				return 0;
			}
		},
	};
}
