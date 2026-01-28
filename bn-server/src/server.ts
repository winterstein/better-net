import Fastify, { FastifyInstance } from 'fastify';
import chunkRoutes from './routes/chunk.js';
import pageRoutes from './routes/page.js';
import siteRoutes from './routes/site.js';
import userRoutes from './routes/user.js';
import { db_init } from './db.js';

const fastify: FastifyInstance = Fastify({
  logger: true
});

// Register routes
fastify.register(chunkRoutes, { prefix: '/api/chunk' });
fastify.register(pageRoutes, { prefix: '/api/page' });
fastify.register(siteRoutes, { prefix: '/api/site' });
fastify.register(userRoutes, { prefix: '/api/user' });

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

// Start server
const start = async (): Promise<void> => {
  try {
    // Initialize database tables
    await db_init();
    fastify.log.info('Database initialized');
    
    const port = Number(process.env.PORT) || 3001;
    const host = process.env.HOST || '0.0.0.0';
    await fastify.listen({ port, host });
    fastify.log.info(`Server listening on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

async function init(): Promise<void> {
	try {
		// Initialize database tables
		await db_init();
		fastify.log.info('Database initialized');
	} catch (err) {		
		fastify.log.error(err);
		process.exit(1);
	}
}

await init();
start();

