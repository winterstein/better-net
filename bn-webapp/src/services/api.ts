const API_BASE = '/api';

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

