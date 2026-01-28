import tap from 'tap';
import { db_init, db_close, db_get_client } from '../src/db.js';
// Load .env and .env.test for test configuration
import dotenv from 'dotenv';
import { Chunk } from '../src/plugin-src/types/Chunk.js';
dotenv.config();
dotenv.config({ path: '.env.test', override: true });

tap.test('db_init initializes the database and chunk table', async t => {
  // Initialize the DB
  await db_init();
  
  // Now check that the chunk table exists by running a test query
  const client = await db_get_client();

  try {
    // Query Postgres system catalog for the 'chunk' table
    const res = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema='public' AND table_name='chunk'
      ) as table_exists;
    `);

    t.ok(res.rows[0].table_exists, 'chunk table should exist after db_init');
  } finally {
    client.release();   
  }
});


tap.test('create, get, update, delete a chunk item', async t => {
  await db_init();
  const { create_item, get_item, update_item, delete_item } = await import('../src/db.js');
  const table = 'chunk';

  // 1. Create a chunk item
  const initialChunk = {
    type: 'text',
    value: 'Test chunk value',
    metadata: { foo: 'bar' }
  };
  const chunk0 = { ...initialChunk } as unknown as Chunk; // fingerprint will get added by create_item
  const id = await create_item(table, chunk0) as number;
  t.ok(id, 'Should return an id for created chunk');

  // 2. Get (read) the chunk item
  const chunk = await get_item(table, id);
  if (!chunk) {
    t.fail('Chunk should exist after creation');
    return;
  }
  const limitedChunk = {type: chunk.type, value: chunk.value, metadata: chunk.metadata };
  t.same(limitedChunk, initialChunk, 'Fetched chunk should match what was inserted');
  t.ok(chunk.fingerprint, 'Fingerprint should be set: '+JSON.stringify(chunk));

  // 3. Update the chunk item
  const updatedChunk = { ...chunk, value: 'Updated value', metadata: { foo: 'baz' } };
  await update_item(table, id, updatedChunk);

  // 4. Get (read) again and verify update
  const chunkAfterUpdate = await get_item(table, id);
  if (!chunkAfterUpdate) {
    t.fail('Chunk should exist after update');
    return;
  }
  t.same(chunkAfterUpdate, updatedChunk, 'Fetched chunk should reflect updated data');

  // 5. Delete the chunk item
  await delete_item(table, id);

  // 6. Try to get again, should return undefined or throw
  let deletedChunk;
  try {
    deletedChunk = await get_item(table, id);
  } catch (e) {
    // Might throw if not found, which is valid
    deletedChunk = undefined;
  }
  t.notOk(deletedChunk, 'Deleted chunk should not be found');
});


tap.teardown(async () => {
	await db_close();
});

