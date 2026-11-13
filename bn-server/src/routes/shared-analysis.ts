/**
 * Shared analysis: extensions that opt in upload chunk-level results, and fetch what
 * others have uploaded for the page they are on. See specs/shared-analysis/spec.md.
 *
 * - POST /lookup        { url } -> the best-model result per feature and chunk on that page
 * - POST /              { shareId, url, results[] } -> store a pass
 * - GET  /site-lists    the allow / block / private list extensions apply
 * - PUT  /site-lists    staff: add, change or remove one entry
 * - POST /remove-contributor   staff: delete one contributor's data and block them
 *
 * No chunk text is accepted or stored: keys are content hashes computed in the extension.
 * Uploads are anonymous. The share id is random, rotated monthly by the extension, and
 * kept only as an HMAC, which is enough to remove everything one contributor sent.
 */

import crypto from 'crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { db_get_client } from '../db.js';
import { requireStaff } from '../auth.js';
import { modelRank } from '../bn-extension-src/ai/model-info.js';
import { DEFAULT_SITE_LIST, matchSiteList, normalizeShareUrl } from '../bn-extension-src/sharing/share-rules.js';
import type { SiteListEntry } from '../bn-extension-src/sharing/share-rules.js';

/** Caps. A page pass is tens of chunks by a handful of features; these are well clear of it. */
export const LIMITS = {
	resultsPerUpload: 300,
	/** One result as JSON. Explanations are a few sentences; this stops a result carrying a document. */
	resultBytes: 8000,
	explanationChars: 1000,
	/** Chunk keys kept per page. An edited article adds keys; the oldest fall off. */
	keysPerPage: 500,
	/** Requests per window, per contributor (uploads) or per client address (lookups). */
	uploadsPerWindow: 120,
	lookupsPerWindow: 600,
	windowMs: 10 * 60 * 1000,
};

const FEATURE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const CHUNK_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const SITE_KINDS = ['allow', 'block', 'private'];

/** Fixed-window counter in memory: one server process, and losing counts on restart is fine. */
const counters = new Map<string, { start: number; n: number }>();
function overLimit(key: string, max: number): boolean {
	const now = Date.now();
	if (counters.size > 50000) counters.clear();
	const c = counters.get(key);
	if (!c || now - c.start > LIMITS.windowMs) {
		counters.set(key, { start: now, n: 1 });
		return false;
	}
	c.n += 1;
	return c.n > max;
}

/** nginx sets X-Real-IP (server.better-net.com.nginx). Used for rate limiting only, never stored. */
function clientAddress(request: FastifyRequest): string {
	return String(request.headers['x-real-ip'] || request.ip);
}

/** Same secret as the feedback pseudonym, a longer digest: this one is a key, not a label. */
export function contributorPseudonym(shareId: string): string {
	const secret = process.env.BN_PSEUDONYM_SECRET || '';
	return crypto.createHmac('sha256', secret).update(`share:${shareId}`).digest('hex').slice(0, 32);
}

/** The seed list with the siteList table on top: a table row replaces a seed entry for the same pattern. */
async function effectiveSiteList(): Promise<SiteListEntry[]> {
	const client = await db_get_client();
	try {
		const { rows } = await client.query(`SELECT pattern, kind FROM siteList`);
		const byPattern = new Map<string, SiteListEntry>();
		for (const entry of [...DEFAULT_SITE_LIST, ...rows]) byPattern.set(entry.pattern, { pattern: entry.pattern, kind: entry.kind });
		return [...byPattern.values()];
	} finally {
		client.release();
	}
}

/** The normalised url if this page may be shared, else null. The extension checks first; this is for a stale or modified one. */
async function shareableUrl(url: unknown): Promise<string | null> {
	const normal = typeof url === 'string' ? normalizeShareUrl(url) : null;
	if (!normal) return null;
	const listed = matchSiteList(normal, await effectiveSiteList());
	return listed === 'block' || listed === 'private' ? null : normal;
}

/** Strip markup from every string, so a stored result cannot carry it to another user's page. */
function stripMarkup(value: unknown): unknown {
	if (typeof value === 'string') return value.replace(/<[^>]*>/g, '');
	if (Array.isArray(value)) return value.map(stripMarkup);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripMarkup(v)]));
	}
	return value;
}

/** A storable copy of one uploaded result, or a reason it is refused. */
function cleanResult(item: any): { featureId: string; chunkKey: string; model: string; result: object } | string {
	if (!item || typeof item !== 'object') return 'not an object';
	const { featureId, chunkKey, model } = item;
	if (!FEATURE_ID.test(featureId ?? '')) return 'bad featureId';
	if (!CHUNK_KEY.test(chunkKey ?? '')) return 'bad chunkKey';
	if (typeof model !== 'string' || model.length > 100 || modelRank(model) <= 0) return 'no model: heuristic results are not shared';
	if ('text' in item || 'html' in item) return 'chunk text is not accepted';
	const raw = item.result;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'no result';
	if (raw.error) return 'error results are not shared';
	if ('text' in raw || 'html' in raw) return 'chunk text is not accepted';
	// Per-user fields have no business in a shared row.
	const { id, user, spanId, ...rest } = raw;
	const result = stripMarkup(rest) as Record<string, unknown>;
	if (typeof result.explanation === 'string') {
		// A link in free text is the obvious way to turn a false verdict into a phishing lure.
		result.explanation = result.explanation.replace(/https?:\/\/\S+/gi, '').slice(0, LIMITS.explanationChars);
	}
	if (result.url !== undefined && !/^https?:\/\//i.test(String(result.url))) delete result.url;
	if (JSON.stringify(result).length > LIMITS.resultBytes) return 'result too large';
	return { featureId, chunkKey, model, result };
}

async function sharedAnalysisRoutes(fastify: FastifyInstance) {
	fastify.post<{ Body: { url?: string } }>('/lookup', async (request, reply) => {
		if (overLimit(`lookup:${clientAddress(request)}`, LIMITS.lookupsPerWindow)) {
			return reply.code(429).send({ error: 'Too many requests' });
		}
		const url = await shareableUrl(request.body?.url);
		if (!url) return { results: [] };
		const client = await db_get_client();
		try {
			const { rows } = await client.query(
				`SELECT r.featureId AS "featureId", r.chunkKey AS "chunkKey", r.model, r.result, r.updated
				 FROM pageSplit p
				 JOIN sharedResult r ON r.chunkKey IN (SELECT jsonb_array_elements_text(p.chunkKeys))
				 WHERE p.url = $1`,
				[url]
			);
			// Best model per feature and chunk; the newer result on a tie.
			const best = new Map<string, any>();
			for (const row of rows) {
				const k = `${row.featureId}\n${row.chunkKey}`;
				const held = best.get(k);
				const better =
					!held ||
					modelRank(row.model) > modelRank(held.model) ||
					(modelRank(row.model) === modelRank(held.model) && row.updated > held.updated);
				if (better) best.set(k, row);
			}
			return { results: [...best.values()].map(({ updated, ...row }) => row) };
		} finally {
			client.release();
		}
	});

	fastify.post<{ Body: { shareId?: string; url?: string; results?: unknown[] } }>('/', async (request, reply) => {
		const { shareId, results } = request.body ?? {};
		if (typeof shareId !== 'string' || shareId.length < 16 || shareId.length > 100) {
			return reply.code(400).send({ error: 'shareId required' });
		}
		if (!Array.isArray(results) || !results.length || results.length > LIMITS.resultsPerUpload) {
			return reply.code(400).send({ error: `results: 1 to ${LIMITS.resultsPerUpload} items` });
		}
		const contributor = contributorPseudonym(shareId);
		if (overLimit(`upload:${contributor}`, LIMITS.uploadsPerWindow) || overLimit(`upload-ip:${clientAddress(request)}`, LIMITS.uploadsPerWindow)) {
			return reply.code(429).send({ error: 'Too many requests' });
		}
		const url = await shareableUrl(request.body.url);
		if (!url) return reply.code(403).send({ error: 'This page is not suitable for shared analysis' });

		// All or nothing: one bad item means a client we should not half-trust.
		const cleaned = results.map(cleanResult);
		const refused = cleaned.find((c) => typeof c === 'string');
		if (refused) return reply.code(400).send({ error: refused });
		const items = cleaned as Exclude<ReturnType<typeof cleanResult>, string>[];

		const client = await db_get_client();
		try {
			const blocked = await client.query(`SELECT 1 FROM blockedContributor WHERE contributor = $1`, [contributor]);
			if (blocked.rowCount) return reply.code(403).send({ error: 'Uploads from this contributor are blocked' });

			await client.query('BEGIN');
			let stored = 0;
			for (const item of items) {
				const key = [item.featureId, item.chunkKey, item.model];
				// First writer's result stands; a repeat only refreshes the date and adds a contributor.
				const inserted = await client.query(
					`INSERT INTO sharedResult (featureId, chunkKey, model, result) VALUES ($1, $2, $3, $4)
					 ON CONFLICT (featureId, chunkKey, model) DO UPDATE SET updated = CURRENT_TIMESTAMP
					 RETURNING (xmax = 0) AS inserted`,
					[...key, JSON.stringify(item.result)]
				);
				if (inserted.rows[0].inserted) stored += 1;
				await client.query(
					`INSERT INTO sharedContributor (featureId, chunkKey, model, contributor) VALUES ($1, $2, $3, $4)
					 ON CONFLICT DO NOTHING`,
					[...key, contributor]
				);
			}
			// The page's chunk keys: what was there, plus anything new, newest last.
			const existing = await client.query(`SELECT chunkKeys FROM pageSplit WHERE url = $1 FOR UPDATE`, [url]);
			const before: string[] = existing.rows[0]?.chunkkeys ?? [];
			const merged = [...new Set([...before, ...items.map((i) => i.chunkKey)])].slice(-LIMITS.keysPerPage);
			if (merged.length !== before.length) {
				await client.query(
					`INSERT INTO pageSplit (url, chunkKeys) VALUES ($1, $2)
					 ON CONFLICT (url) DO UPDATE SET chunkKeys = EXCLUDED.chunkKeys, updated = CURRENT_TIMESTAMP`,
					[url, JSON.stringify(merged)]
				);
			}
			await client.query('COMMIT');
			return { stored, received: items.length };
		} catch (err) {
			await client.query('ROLLBACK').catch(() => {});
			throw err;
		} finally {
			client.release();
		}
	});

	fastify.get('/site-lists', async () => ({ list: await effectiveSiteList() }));

	/** Staff: `{ pattern, kind, note? }` sets an entry; `kind: null` removes it (a seed entry then applies again). */
	fastify.put<{ Body: { pattern?: string; kind?: string | null; note?: string } }>('/site-lists', async (request, reply) => {
		if (!(await requireStaff(request, reply))) return reply;
		const pattern = String(request.body?.pattern ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
		const { kind, note } = request.body ?? {};
		if (!/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/.test(pattern)) return reply.code(400).send({ error: 'pattern: a domain, with an optional path' });
		const client = await db_get_client();
		try {
			if (kind === null) {
				await client.query(`DELETE FROM siteList WHERE pattern = $1`, [pattern]);
			} else if (SITE_KINDS.includes(kind)) {
				await client.query(
					`INSERT INTO siteList (pattern, kind, note) VALUES ($1, $2, $3)
					 ON CONFLICT (pattern) DO UPDATE SET kind = EXCLUDED.kind, note = EXCLUDED.note, updated = CURRENT_TIMESTAMP`,
					[pattern, kind, note ?? null]
				);
			} else {
				return reply.code(400).send({ error: `kind: ${SITE_KINDS.join(' | ')} | null` });
			}
		} finally {
			client.release();
		}
		return { list: await effectiveSiteList() };
	});

	/**
	 * Staff: remove a bad actor. Name them by pseudonym, or by one of their results
	 * (`featureId`, `chunkKey`, `model`), which removes everyone who contributed it.
	 * A result another contributor also sent survives.
	 */
	fastify.post<{ Body: { contributor?: string; featureId?: string; chunkKey?: string; model?: string } }>(
		'/remove-contributor',
		async (request, reply) => {
			if (!(await requireStaff(request, reply))) return reply;
			const { contributor, featureId, chunkKey, model } = request.body ?? {};
			const client = await db_get_client();
			try {
				const named = contributor
					? [contributor]
					: (
							await client.query(
								`SELECT contributor FROM sharedContributor WHERE featureId = $1 AND chunkKey = $2 AND model = $3`,
								[featureId, chunkKey, model]
							)
						).rows.map((r) => r.contributor);
				if (!named.length) return reply.code(404).send({ error: 'No such contributor' });
				await client.query('BEGIN');
				await client.query(`DELETE FROM sharedContributor WHERE contributor = ANY($1)`, [named]);
				const removed = await client.query(
					`DELETE FROM sharedResult r WHERE NOT EXISTS (
						SELECT 1 FROM sharedContributor c
						WHERE c.featureId = r.featureId AND c.chunkKey = r.chunkKey AND c.model = r.model)`
				);
				await client.query(
					`INSERT INTO blockedContributor (contributor) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`,
					[named]
				);
				await client.query('COMMIT');
				return { contributors: named, resultsRemoved: removed.rowCount };
			} catch (err) {
				await client.query('ROLLBACK').catch(() => {});
				throw err;
			} finally {
				client.release();
			}
		}
	);
}

export default sharedAnalysisRoutes;
