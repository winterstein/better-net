/**
 * Accounts: the Auth0 identity, and which local ids ("owner keys") belong to it.
 * See bn-extension/specs/accounts/user-identity/spec.md.
 *
 * Parameterised SQL throughout, unlike the older create_item/update_item path in db.ts.
 */

import crypto from 'node:crypto';
import { db_get_client } from './db.js';

export interface BnUser {
	id: number;
	sub: string;
	email?: string;
	isStaff: boolean;
}

/** Link codes are typed or pasted, so avoid the characters people confuse. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * The row for this Auth0 subject, created on first sign-in. `isStaff` is never set here —
 * staff is granted in the database by hand, deliberately not self-serve.
 */
export async function getOrCreateUser(sub: string, email?: string): Promise<BnUser> {
	const client = await db_get_client();
	try {
		// The email is refreshed from the token; sub is the identity and never changes.
		const result = await client.query(
			`INSERT INTO bnuser (sub, email) VALUES ($1, $2)
			 ON CONFLICT (sub) DO UPDATE SET email = COALESCE(EXCLUDED.email, bnuser.email)
			 RETURNING id, sub, email, isStaff`,
			[sub, email ?? null]
		);
		const row = result.rows[0];
		return { id: row.id, sub: row.sub, email: row.email ?? undefined, isStaff: row.isstaff };
	} finally {
		client.release();
	}
}

/** @returns a short single-use code standing in for the local id, which stays in the extension. */
export async function createLinkCode(ownerKey: string): Promise<{ code: string; expires: Date }> {
	const raw = crypto.randomBytes(8);
	const body = Array.from(raw, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
	const code = `${body.slice(0, 4)}-${body.slice(4, 8)}`;
	const expires = new Date(Date.now() + CODE_TTL_MS);
	const client = await db_get_client();
	try {
		await client.query(`INSERT INTO linkCode (code, ownerKey, expires) VALUES ($1, $2, $3)`, [
			code,
			ownerKey,
			expires,
		]);
		return { code, expires };
	} finally {
		client.release();
	}
}

/**
 * Redeem a code and attach its device to this account.
 *
 * Burning the code is conditional in SQL (`used = FALSE AND expires > now()`), so two
 * simultaneous redemptions cannot both succeed. The device link is an upsert on the UNIQUE
 * ownerKey, which is what makes re-linking *move* a device rather than duplicating it.
 *
 * @returns the number of devices now linked, or null if the code was expired or already used
 */
export async function redeemLinkCode(code: string, sub: string): Promise<number | null> {
	const client = await db_get_client();
	try {
		const burn = await client.query(
			`UPDATE linkCode SET used = TRUE
			 WHERE code = $1 AND used = FALSE AND expires > CURRENT_TIMESTAMP
			 RETURNING ownerKey`,
			[code]
		);
		if (burn.rows.length === 0) return null;
		const ownerKey = burn.rows[0].ownerkey;
		await client.query(
			`INSERT INTO accountDevice (sub, ownerKey) VALUES ($1, $2)
			 ON CONFLICT (ownerKey) DO UPDATE SET sub = EXCLUDED.sub`,
			[sub, ownerKey]
		);
		return await countDevices(sub, client);
	} finally {
		client.release();
	}
}

/** The local ids this account may read feedback for. Empty until a device is linked. */
export async function ownerKeysForAccount(sub: string): Promise<string[]> {
	const client = await db_get_client();
	try {
		const result = await client.query(`SELECT ownerKey FROM accountDevice WHERE sub = $1`, [sub]);
		return result.rows.map((r) => r.ownerkey as string);
	} finally {
		client.release();
	}
}

/**
 * Which account, if any, this browser belongs to — for the "linked" status the extension
 * shows in its popup and options page (bn-extension/specs/accounts/user-identity/spec.md).
 *
 * Authorised by possession of the local id, exactly like /link-code: the caller already holds
 * the credential, so telling them which account it points at reveals nothing they could not
 * learn by redeeming a code. The lookup is one-way — there is no route from an email back to
 * a local id.
 *
 * @returns the linked account's email (which may be undefined), or null if unlinked
 */
export async function accountForDevice(ownerKey: string): Promise<{ email?: string } | null> {
	const client = await db_get_client();
	try {
		const result = await client.query(
			`SELECT u.email FROM accountDevice d JOIN bnuser u ON u.sub = d.sub WHERE d.ownerKey = $1`,
			[ownerKey]
		);
		if (result.rows.length === 0) return null;
		return { email: result.rows[0].email ?? undefined };
	} finally {
		client.release();
	}
}

async function countDevices(sub: string, client: any): Promise<number> {
	const result = await client.query(
		`SELECT COUNT(*)::int AS n FROM accountDevice WHERE sub = $1`,
		[sub]
	);
	return result.rows[0].n as number;
}

export async function deviceCount(sub: string): Promise<number> {
	const client = await db_get_client();
	try {
		return await countDevices(sub, client);
	} finally {
		client.release();
	}
}

/**
 * Stable pseudonym for the staff view: staff can see that 40 corrections came from one
 * person without learning who. Keyed on a server secret, so it cannot be reversed by
 * hashing candidate local ids.
 */
export function submitterPseudonym(ownerKey: string): string {
	const secret = process.env.BN_PSEUDONYM_SECRET || '';
	const mac = crypto.createHmac('sha256', secret).update(ownerKey).digest('hex');
	return `u_${mac.slice(0, 6)}`;
}

/** A page of feedback rows. */
export interface FeedbackPage {
	rows: Record<string, any>[];
	total: number;
}

export interface FeedbackFilters {
	target?: string;
	moduleId?: string;
	tag?: string;
	limit?: number;
	offset?: number;
}

const MAX_LIMIT = 200;

function clampPaging(f: FeedbackFilters) {
	const limit = Math.min(Math.max(Number(f.limit) || 50, 1), MAX_LIMIT);
	const offset = Math.max(Number(f.offset) || 0, 0);
	return { limit, offset };
}

/**
 * Feedback owned by any of these local ids, newest first. Own data, so nothing is redacted.
 * An empty ownerKeys list returns nothing rather than everything — the difference between
 * "no devices linked" and "all feedback".
 */
export async function feedbackForOwners(
	ownerKeys: string[],
	filters: FeedbackFilters = {}
): Promise<FeedbackPage> {
	if (ownerKeys.length === 0) return { rows: [], total: 0 };
	const { limit, offset } = clampPaging(filters);
	const where = [`props->>'ownerKey' = ANY($1)`];
	const params: any[] = [ownerKeys];
	appendFilters(where, params, filters);
	return await runQuery(where, params, limit, offset, (props) => props);
}

/** All feedback, for staff. The submitter is a pseudonym and the email never leaves here. */
export async function allFeedback(filters: FeedbackFilters = {}): Promise<FeedbackPage> {
	const { limit, offset } = clampPaging(filters);
	const where = ['TRUE'];
	const params: any[] = [];
	appendFilters(where, params, filters);
	return await runQuery(where, params, limit, offset, redactForStaff);
}

/**
 * Drop everything that identifies the submitter, and replace it with a stable pseudonym.
 * Allow-list rather than delete-list: a field added to FeedbackSubmission later cannot leak
 * by default, which is the failure mode worth designing against.
 */
const STAFF_VISIBLE_FIELDS = [
	'localId',
	'target',
	'moduleId',
	'tag',
	'tagOn',
	'thumbsUp',
	'retracted',
	'issueId',
	'issueLabel',
	'message',
	'chunkFingerprint',
	'chunkUrl',
	'chunkTitle',
	'pageUrl',
	'chunkCount',
	'problemScore',
	'confidence',
	'analysisId',
	'traceId',
	'spanId',
	'created',
	'updated',
];

function redactForStaff(props: Record<string, any>): Record<string, any> {
	const out: Record<string, any> = {};
	for (const field of STAFF_VISIBLE_FIELDS) {
		if (props[field] !== undefined) out[field] = props[field];
	}
	out.submitter = props.ownerKey ? submitterPseudonym(props.ownerKey) : null;
	return out;
}

function appendFilters(where: string[], params: any[], filters: FeedbackFilters): void {
	if (filters.target) {
		params.push(filters.target);
		where.push(`props->>'target' = $${params.length}`);
	}
	if (filters.moduleId) {
		params.push(filters.moduleId);
		where.push(`props->>'moduleId' = $${params.length}`);
	}
	if (filters.tag) {
		params.push(filters.tag);
		where.push(`props->>'tag' = $${params.length}`);
	}
}

async function runQuery(
	where: string[],
	params: any[],
	limit: number,
	offset: number,
	shape: (props: Record<string, any>) => Record<string, any>
): Promise<FeedbackPage> {
	const client = await db_get_client();
	try {
		const clause = where.join(' AND ');
		const counted = await client.query(
			`SELECT COUNT(*)::int AS n FROM feedback WHERE ${clause}`,
			params
		);
		const rows = await client.query(
			`SELECT id, created, updated, props FROM feedback WHERE ${clause}
			 ORDER BY created DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
			params
		);
		return {
			total: counted.rows[0].n as number,
			rows: rows.rows.map((r) => shape({ ...r.props, created: r.created, updated: r.updated })),
		};
	} finally {
		client.release();
	}
}

/**
 * Hard delete: the rows go, including the free-text message, which is the part most likely
 * to hold something personal. The chunk and page rows feedback created describe a public web
 * page rather than the user, so they stay (specs/accounts/delete-my-data).
 */
export async function deleteFeedbackForOwner(ownerKey: string): Promise<number> {
	const client = await db_get_client();
	try {
		const result = await client.query(`DELETE FROM feedback WHERE props->>'ownerKey' = $1`, [
			ownerKey,
		]);
		return result.rowCount ?? 0;
	} finally {
		client.release();
	}
}

export async function countFeedbackForOwner(ownerKey: string): Promise<number> {
	const client = await db_get_client();
	try {
		const result = await client.query(
			`SELECT COUNT(*)::int AS n FROM feedback WHERE props->>'ownerKey' = $1`,
			[ownerKey]
		);
		return result.rows[0].n as number;
	} finally {
		client.release();
	}
}
