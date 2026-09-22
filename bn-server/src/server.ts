/*
 * Load .env before anything reads process.env. In production systemd supplies the same
 * values via EnvironmentFile (bn-server.service), and dotenv does not overwrite what is
 * already set, so this is a no-op there — it exists for `npm run dev`, which otherwise
 * ignores .env entirely. That silence was expensive: with AUTH0_DOMAIN unread, auth.ts
 * refuses every token and each guarded route 401s while looking perfectly configured.
 *
 * Side-effect import rather than a dotenv.config() call: ESM hoists every import above
 * plain statements, so a call here would run after the modules below had already loaded.
 */
import 'dotenv/config';

import Fastify, { FastifyInstance } from 'fastify';
import accountRoutes from './routes/account.js';
import chunkRoutes from './routes/chunk.js';
import feedbackRoutes from './routes/feedback.js';
import pageRoutes from './routes/page.js';
import siteRoutes from './routes/site.js';
import userRoutes from './routes/user.js';
import { db_init } from './db.js';

const fastify: FastifyInstance = Fastify({
  logger: true
});

// Register routes
fastify.register(accountRoutes, { prefix: '/api/account' });
fastify.register(chunkRoutes, { prefix: '/api/chunk' });
fastify.register(feedbackRoutes, { prefix: '/api/feedback' });
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

