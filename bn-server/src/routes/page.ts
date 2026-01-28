import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface PageParams {
	id: string;
}

interface Page {
	id: string;
	createdAt: string;
	updatedAt: string;
	[key: string]: any;
}

async function pageRoutes(fastify: FastifyInstance, options: any) {
  // In-memory store (replace with actual database in production)
  const pages = new Map<string, Page>();
  let nextId = 1;

  // GET /api/page - List all pages
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return Array.from(pages.values());
  });

  // GET /api/page/:id - Get a specific page
  fastify.get<{ Params: PageParams }>('/:id', async (request: FastifyRequest<{ Params: PageParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    const page = pages.get(id);
    
    if (!page) {
      return reply.code(404).send({ error: 'Page not found' });
    }
    
    return page;
  });

  // POST /api/page - Create a new page
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const page: Page = {
      id: String(nextId++),
      ...request.body as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    pages.set(page.id, page);
    return reply.code(201).send(page);
  });

  // PUT /api/page/:id - Update a page
  fastify.put<{ Params: PageParams }>('/:id', async (request: FastifyRequest<{ Params: PageParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    const existingPage = pages.get(id);
    
    if (!existingPage) {
      return reply.code(404).send({ error: 'Page not found' });
    }
    
    const updatedPage: Page = {
      ...existingPage,
      ...request.body as any,
      id,
      updatedAt: new Date().toISOString()
    };
    
    pages.set(id, updatedPage);
    return updatedPage;
  });

  // DELETE /api/page/:id - Delete a page
  fastify.delete<{ Params: PageParams }>('/:id', async (request: FastifyRequest<{ Params: PageParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    
    if (!pages.has(id)) {
      return reply.code(404).send({ error: 'Page not found' });
    }
    
    pages.delete(id);
    return reply.code(204).send();
  });
}

export default pageRoutes;

