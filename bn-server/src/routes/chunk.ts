import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { get_item, create_item, update_item, delete_item, db_query_items } from '../db.js';
import type { Chunk } from '../plugin-src/types/Chunk.js';
import type { AnalysisOptions } from '../plugin-src/types/AnalysisOptions.js';
import { fingerprint } from '../plugin-src/types/Chunk.js';
import { getDefaultAnalysisEngine } from '../plugin-src/analyzers/AnalysisEngine.js';

interface ChunkParams {
	id: string;
}

interface ChunkQuerystring {
	q?: string;
	sort?: string;
}

interface AnalyzeBody {
	options?: AnalysisOptions;
	pageMetadata?: {
		url?: string;
		title?: string;
		domain?: string;
		author?: string;
		description?: string;
	};
}

async function chunkRoutes(fastify: FastifyInstance, options: any) {

  // GET /api/chunk - List all chunks
  // Takes optional q=gmailStyleQuery	
  fastify.get<{ Querystring: ChunkQuerystring }>('/', async (request: FastifyRequest<{ Querystring: ChunkQuerystring }>, reply: FastifyReply) => {
    const q = request.query.q || null;
	const sort = request.query.sort || null;
    return await db_query_items('chunk', q, sort);
  });

  // GET /api/chunk/:id - Get a specific chunk
  fastify.get<{ Params: ChunkParams }>('/:id', async (request: FastifyRequest<{ Params: ChunkParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    const item = await get_item('chunk', Number(id));
    
    if (!item) {
      return reply.code(404).send({ error: 'Chunk not found: '+id });
    }
    
    return item;
  });

  // POST /api/chunk - Create a new chunk
  fastify.post<{ Body: Partial<Chunk> }>('/', async (request: FastifyRequest<{ Body: Partial<Chunk> }>, reply: FastifyReply) => {

      const chunkData = { ...request.body };
	chunkData.fingerprint = fingerprint(chunkData as Chunk);
      const createdChunk = await create_item('chunk', chunkData as any, {returnItem: true});
      
      return reply.code(201).send(createdChunk);
   
  });

  // PUT /api/chunk/:id - Update a chunk
  fastify.put<{ Params: ChunkParams; Body: Partial<Chunk> }>('/:id', async (request: FastifyRequest<{ Params: ChunkParams; Body: Partial<Chunk> }>, reply: FastifyReply) => {
    const { id } = request.params;
    const existingChunk = await get_item('chunk', Number(id));
    
    if (!existingChunk) {
      return reply.code(404).send({ error: 'Chunk not found' });
    }
    
    const updatedChunkData = {
      ...existingChunk,
      ...request.body,
      updated: new Date().toISOString()
    };
    
    await update_item('chunk', Number(id), updatedChunkData as any);
    return await get_item('chunk', Number(id));
  });

  // DELETE /api/chunk/:id - Delete a chunk
  fastify.delete<{ Params: ChunkParams }>('/:id', async (request: FastifyRequest<{ Params: ChunkParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    
    const existingChunk = await get_item('chunk', Number(id));
    if (!existingChunk) {
      return reply.code(404).send({ error: 'Chunk not found' });
    }
    
    await delete_item('chunk', Number(id));
    return reply.code(204).send();
  });

  // GET /api/chunk/:id/analyze - Get chunk analysis from database
  fastify.get<{ Params: ChunkParams }>('/:id/analyze', async (request: FastifyRequest<{ Params: ChunkParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    const chunk = await get_item('chunk', Number(id));
    
    if (!chunk) {
      return reply.code(404).send({ error: 'Chunk not found: '+id });
    }
    
    const analysis = (chunk as any).analysis;
    if (!analysis) {
      return reply.code(404).send({ error: 'Analysis not found for chunk: '+id });
    }
    
    return analysis;
  });

  // POST /api/chunk/:id/analyze - Perform chunk analysis and store results
  fastify.post<{ Params: ChunkParams; Body: AnalyzeBody }>('/:id/analyze', async (request: FastifyRequest<{ Params: ChunkParams; Body: AnalyzeBody }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { options = {}, pageMetadata = {} } = request.body;
    
    const chunk = await get_item('chunk', Number(id)) as Chunk;
    if (!chunk) {
      return reply.code(404).send({ error: 'Chunk not found: '+id });
    }
    
    // Extract page metadata from chunk if not provided
    const metadata = {
      url: pageMetadata.url || chunk.url || '',
      title: pageMetadata.title || chunk.title,
      domain: pageMetadata.domain || chunk.domain,
      author: pageMetadata.author || chunk.author,
      description: pageMetadata.description || chunk.description,
      ...pageMetadata
    };
    
    // Perform analysis - chunk from DB has id, created, updated fields, but analyzeChunk expects Chunk type
    const engine = getDefaultAnalysisEngine();
    const analysisResult = await engine.analyzeChunk(chunk, metadata, options);
    
    // Store analysis in chunk
    const updatedChunkData = {
      ...chunk,
      analysis: analysisResult,
      updated: new Date().toISOString()
    };
    
    await update_item('chunk', Number(id), updatedChunkData as any);
    
    return reply.code(200).send(analysisResult);
  });
}

export default chunkRoutes;

