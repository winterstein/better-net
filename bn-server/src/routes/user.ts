import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface UserParams {
	id: string;
}

interface User {
	id: string;
	createdAt: string;
	updatedAt: string;
	[key: string]: any;
}

async function userRoutes(fastify: FastifyInstance, options: any) {
  // In-memory store (replace with actual database in production)
  const users = new Map<string, User>();
  let nextId = 1;

  // GET /api/user - List all users
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return Array.from(users.values());
  });

  // GET /api/user/:id - Get a specific user
  fastify.get<{ Params: UserParams }>('/:id', async (request: FastifyRequest<{ Params: UserParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    const user = users.get(id);
    
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }
    
    return user;
  });

  // POST /api/user - Create a new user
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user: User = {
      id: String(nextId++),
      ...request.body as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    users.set(user.id, user);
    return reply.code(201).send(user);
  });

  // PUT /api/user/:id - Update a user
  fastify.put<{ Params: UserParams }>('/:id', async (request: FastifyRequest<{ Params: UserParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    const existingUser = users.get(id);
    
    if (!existingUser) {
      return reply.code(404).send({ error: 'User not found' });
    }
    
    const updatedUser: User = {
      ...existingUser,
      ...request.body as any,
      id,
      updatedAt: new Date().toISOString()
    };
    
    users.set(id, updatedUser);
    return updatedUser;
  });

  // DELETE /api/user/:id - Delete a user
  fastify.delete<{ Params: UserParams }>('/:id', async (request: FastifyRequest<{ Params: UserParams }>, reply: FastifyReply) => {
    const { id } = request.params;
    
    if (!users.has(id)) {
      return reply.code(404).send({ error: 'User not found' });
    }
    
    users.delete(id);
    return reply.code(204).send();
  });
}

export default userRoutes;

