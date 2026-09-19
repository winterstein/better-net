/**
 * Dev uses the Vite proxy (vite.config.ts), so a relative path is right there. In production
 * the webapp is on app.better-net.com and the API on server.better-net.com, so it has to be
 * absolute — hence VITE_API_BASE at build time.
 */
const API_BASE = (import.meta.env?.VITE_API_BASE as string | undefined) || '/api';

export interface Page {
  id: string;
  url?: string;
  title?: string;
  domain?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}

export interface Chunk {
  id: number;
  url?: string;
  title?: string;
  domain?: string;
  text?: string;
  analysis?: any;
  [key: string]: any;
}

class ApiService {
  async getPages(): Promise<Page[]> {
    const response = await fetch(`${API_BASE}/page`);
    if (!response.ok) {
      throw new Error('Failed to fetch pages');
    }
    return response.json();
  }

  async getPage(id: string): Promise<Page> {
    const response = await fetch(`${API_BASE}/page/${id}`);
    if (!response.ok) {
      throw new Error('Failed to fetch page');
    }
    return response.json();
  }

  async createPage(data: Partial<Page>): Promise<Page> {
    const response = await fetch(`${API_BASE}/page`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error('Failed to create page');
    }
    return response.json();
  }

  async getChunks(query?: string, sort?: string): Promise<Chunk[]> {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (sort) params.append('sort', sort);
    const url = `${API_BASE}/chunk${params.toString() ? '?' + params.toString() : ''}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch chunks');
    }
    return response.json();
  }

  async getChunk(id: string): Promise<Chunk> {
    const response = await fetch(`${API_BASE}/chunk/${id}`);
    if (!response.ok) {
      throw new Error('Failed to fetch chunk');
    }
    return response.json();
  }

  async getChunkAnalysis(id: string): Promise<any> {
    const response = await fetch(`${API_BASE}/chunk/${id}/analyze`);
    if (!response.ok) {
      throw new Error('Failed to fetch chunk analysis');
    }
    return response.json();
  }

  async analyzeChunk(id: string, options?: any, pageMetadata?: any): Promise<any> {
    const response = await fetch(`${API_BASE}/chunk/${id}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ options, pageMetadata }),
    });
    if (!response.ok) {
      throw new Error('Failed to analyze chunk');
    }
    return response.json();
  }
}

export const api = new ApiService();


/**
 * Feedback reads and device linking. See bn-server/specs/feedback/feedback-read-api/spec.md.
 *
 * The Auth0 token goes in an Authorization header rather than a cookie, which is why the
 * API needs no credentialed CORS (see bn-server/server.better-net.com.nginx).
 */

export interface FeedbackRow {
	localId?: string;
	target?: string;
	moduleId?: string;
	tag?: string;
	tagOn?: boolean | null;
	thumbsUp?: boolean;
	retracted?: boolean;
	issueLabel?: string | null;
	message?: string | null;
	chunkUrl?: string;
	chunkTitle?: string;
	problemScore?: string;
	/** Staff view only: a stable pseudonym, never an email. */
	submitter?: string | null;
	created?: string;
}

export interface FeedbackPage {
	rows: FeedbackRow[];
	total: number;
	/** /mine only: 0 means nothing is linked yet, which is a different message from "none". */
	linkedDevices?: number;
}

export interface Me {
	email?: string;
	isStaff: boolean;
	linkedDevices: number;
}

/** Thrown with the status so callers can tell "sign in" from "not staff" from "expired link". */
export class ApiError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

async function request(path: string, token: string, init: RequestInit = {}): Promise<any> {
	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: {
			...(init.headers || {}),
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
	});
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new ApiError(response.status, body?.error || `Request failed (${response.status})`);
	}
	return response.json();
}

function query(filters: Record<string, string | number | undefined> = {}): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) {
		if (value !== undefined && value !== '') params.set(key, String(value));
	}
	const qs = params.toString();
	return qs ? `?${qs}` : '';
}

export const feedbackApi = {
	async me(token: string): Promise<Me> {
		return await request('/account/me', token);
	},

	/** Redeem the extension's one-time code, attaching this browser to the account. */
	async linkDevice(token: string, code: string): Promise<{ linkedDevices: number }> {
		return await request('/account/link', token, { method: 'POST', body: JSON.stringify({ code }) });
	},

	async myFeedback(token: string, filters?: Record<string, string | number | undefined>): Promise<FeedbackPage> {
		return await request(`/feedback/mine${query(filters)}`, token);
	},

	async allFeedback(token: string, filters?: Record<string, string | number | undefined>): Promise<FeedbackPage> {
		return await request(`/feedback/all${query(filters)}`, token);
	},
};
