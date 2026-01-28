import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface SiteParams {
	id: string;
}

interface Site {
	id: string;
	createdAt: string;
	updatedAt: string;
	[key: string]: any;
}

async function siteRoutes(fastify: FastifyInstance, options: any) {
  // In-memory store (replace with actual database in production)
  const sites = new Map<string, Site>();
  let nextId = 1;

  // GET /api/site - List all sites
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return Array.from(sites.values());
  });

  // GET /api/site/:id - Get a specific site
  fastify.get<{ Params: SiteParams }>('/:id', async (request: FastifyRequest<{ Params: SiteParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    const site = sites.get(id);
    
    if (!site) {
      return reply.code(404).send({ error: 'Site not found' });
    }
    
    return site;
  });

  // POST /api/site - Create a new site
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const site: Site = {
      id: String(nextId++),
      ...request.body as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    sites.set(site.id, site);
    return reply.code(201).send(site);
  });

  // PUT /api/site/:id - Update a site
  fastify.put<{ Params: SiteParams }>('/:id', async (request: FastifyRequest<{ Params: SiteParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    const existingSite = sites.get(id);
    
    if (!existingSite) {
      return reply.code(404).send({ error: 'Site not found' });
    }
    
    const updatedSite: Site = {
      ...existingSite,
      ...request.body as any,
      id,
      updatedAt: new Date().toISOString()
    };
    
    sites.set(id, updatedSite);
    return updatedSite;
  });

  // DELETE /api/site/:id - Delete a site
  fastify.delete<{ Params: SiteParams }>('/:id', async (request: FastifyRequest<{ Params: SiteParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    
    if (!sites.has(id)) {
      return reply.code(404).send({ error: 'Site not found' });
    }
    
    sites.delete(id);
    return reply.code(204).send();
  });
}

export default siteRoutes;

