// database management code
import pg from 'pg';
const { Pool } = pg;
import type { Pool as PoolType, PoolClient, QueryResult } from 'pg';
import SearchQuery from './SearchQuery.js';
import type { TopLevelItem } from './plugin-src/types/TopLevelItem.js';
import { Chunk, fingerprint } from './plugin-src/types/Chunk.js';
import {Page} from './plugin-src/types/Page.js';
import {ChunkAnalysis} from './plugin-src/types/ChunkAnalysis.js';

// database connection pool
let pool: PoolType | null = null;

interface DBTableColumn {
	name: string;
	type: string;
}

const chunk_columns: DBTableColumn[] = [
	{ name: 'id', type: 'SERIAL PRIMARY KEY' },
	{ name: 'fingerprint', type: 'TEXT NOT NULL' },
	{ name: 'props', type: 'JSONB NOT NULL' },
	{ name: 'created', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
	{ name: 'updated', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' }
];
const page_columns: DBTableColumn[] = [
	{ name: 'id', type: 'SERIAL PRIMARY KEY' },
	{ name: 'url', type: 'TEXT NOT NULL' },
	{ name: 'props', type: 'JSONB NOT NULL' },
	{ name: 'created', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
	{ name: 'updated', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' }
];
const chunkAnalysis_columns: DBTableColumn[] = [
	{ name: 'id', type: 'SERIAL PRIMARY KEY' },
	{ name: 'chunkId', type: 'INTEGER NOT NULL' },
	{ name: 'props', type: 'JSONB NOT NULL' },
	{ name: 'created', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
	{ name: 'updated', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' }
];
const columns4table = {
	chunk: chunk_columns,
	page: page_columns,
	chunkAnalysis: chunkAnalysis_columns,
};


async function db_init(): Promise<boolean> {	
	if (pool) {
		return true;
	}	
	// note: can still get race condition here, but this function is idempotent
	const database = process.env.DB_NAME || 'betternet';
	console.log('Initializing database... '+database);
	
	const host = process.env.DB_HOST || 'localhost';
	const port = Number(process.env.DB_PORT) || 5432;
	const user = process.env.DB_USERNAME || 'postgres';
	const password = process.env.DB_PASSWORD || '';
	
	// First, connect to default database to create the target database if needed
	const adminPool = new Pool({
		host,
		port,
		database: 'postgres', // Connect to default database
		user,
		password,
	});
	
	const adminClient = await adminPool.connect();
	try {
		// Check if database exists
		const dbCheck = await adminClient.query(
			`SELECT 1 FROM pg_database WHERE datname = $1`,
			[database]
		);
		
		// Create database if it doesn't exist
		if (dbCheck.rows.length === 0) {
			// Escape database name to prevent SQL injection (double quotes and escape any existing quotes)
			const escapedDbName = `"${database.replace(/"/g, '""')}"`;
			try {
				await adminClient.query(`CREATE DATABASE ${escapedDbName}`);
				console.log(`Database ${database} created`);
			} catch (error: any) {
				// Handle race condition: if database was created between check and creation
				if (error.code === '23505' || error.message.includes('already exists')) {
					console.log(`Database ${database} already exists (race condition handled)`);
				} else {
					throw error;
				}
			}
		} else {
			console.log(`Database ${database} already exists`);
		}
	} finally {
		adminClient.release();
		await adminPool.end();
	}
	
	console.log('Connecting to database... '+database);
	// Now connect to the target database and create tables
	pool = new Pool({
		host,
		port,
		database,
		user,
		password,
	});
	const client = await pool.connect();
	
	// make (if not exists) SQL tables for:
	// Chunk, Page, ChunkAnalysis
	// using a field `props` : JSONB = json of the item
	try {
		// Create chunk table
		console.log('Creating chunk table...');
		const sql_chunk = `CREATE TABLE IF NOT EXISTS chunk (${chunk_columns.map(c => `${c.name} ${c.type}`).join(', ')})`;
		await client.query(sql_chunk);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_chunk_props ON chunk USING GIN (props);`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_chunk_fingerprint ON chunk (fingerprint);`);
		console.log('Chunk table initialized successfully');
		
		// Create page table
		console.log('Creating page table...');
		const sql_page = `CREATE TABLE IF NOT EXISTS page (${page_columns.map(c => `${c.name} ${c.type}`).join(', ')})`;
		await client.query(sql_page);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_page_props ON page USING GIN (props);`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_page_url ON page (url);`);
		console.log('Page table initialized successfully');
		
		// Create chunkAnalysis table
		console.log('Creating chunkAnalysis table...');
		const sql_chunkAnalysis = `CREATE TABLE IF NOT EXISTS chunkAnalysis (${chunkAnalysis_columns.map(c => `${c.name} ${c.type}`).join(', ')})`;
		await client.query(sql_chunkAnalysis);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_chunkAnalysis_props ON chunkAnalysis USING GIN (props);`);
		await client.query(`CREATE INDEX IF NOT EXISTS idx_chunkAnalysis_chunkId ON chunkAnalysis (chunkId);`);
		console.log('ChunkAnalysis table initialized successfully');
	} catch (error) {
		console.error('Error initializing tables:', error);
		throw error;
	} finally {
		client.release();
	}
	console.log('Database initialized successfully');
	return true;
}

function db_close(): void {
	if (pool) {
		pool.end();
		pool = null;
	}
}

async function db_get_client(): Promise<PoolClient> {
	if (!pool) {
		throw new Error('Database pool not initialized. Call db_init() first.');
	}
	return await pool.connect();
}

async function db_query_items(table: string, gmailStyleQuery?: string | null, sort?: string | null): Promise<TopLevelItem[]> {
	if (!sort) {
		sort = 'updated DESC';
	}
	let query: string;
	if (gmailStyleQuery) {
		// parse
		const sq = new SearchQuery(gmailStyleQuery);
		// convert to SQL
	} else {
		query = '1=1';
	}
	const client = await db_get_client();
	try {
		const columns = columns4table[table];
		if (!columns) {
			throw new Error(`Unknown table: ${table}`);
		}
		const scolumns = columns.map(c => c.name).join(', ');
		const sql = `SELECT ${scolumns} FROM ${table} WHERE ${query} ORDER BY ${sort}`;
		const result = await client.query(sql);
		// convert rows
		return result.rows.map(convert_row_to_item);
	} finally {
		client.release();
	}
}

function convert_row_to_item(row: any): TopLevelItem {
	let props = row.props;
	if (typeof props === 'string') {
		props = JSON.parse(props);
	} else if (!props) {
		props = {};
	}
	delete props.id; // paranoia
	delete row.props;
	return {...props, ...row};
}

/**
 * Get, converting JSONB to object
 * @param {string} table 
 * @param {*} id 
 * @returns object
 */
async function get_item(table: string, id: number): Promise<TopLevelItem | undefined> {
	const client = await db_get_client();
	try {
		const columns = columns4table[table];
		if (!columns) {
			throw new Error(`Unknown table: ${table}`);
		}
		const result: QueryResult = await client.query(
			`SELECT ${columns.map(c => c.name).join(', ')} FROM ${table} WHERE id = $1`,
			[id]
		);
		if (result.rows.length === 0) {
			return undefined;
		}
		// PostgreSQL JSONB is already parsed by pg library, no need to JSON.parse()
		const item = result.rows[0];
		return convert_row_to_item(item);
	} finally {
		client.release();
	}
}

interface CreateItemOptions {
	returnItem?: boolean;
}

function fingerprint_item(table: string, item: TopLevelItem): void {
	// Only fingerprint Chunk items, as they're the only ones with fingerprint column
	if (table === 'chunk') {
		item.fingerprint = fingerprint(item as Chunk);
		console.log('Fingerprinted item '+table+" "+JSON.stringify(item));
	}
}

/**
 * Insert, converting object to JSONB
 * @param {*} table 
 * @param {*} item 
 * @param {boolean} returnItem - if true, return the item after creation
 * @returns id or item
 */
async function create_item(table: string, item: TopLevelItem, {returnItem = false}: CreateItemOptions = {}): Promise<number | TopLevelItem> {
	console.log('Creating item... '+table+" "+JSON.stringify(item));
	const client = await db_get_client();
	const dbItem = prepItemForDB(table, item);	
	try {
		const sqlValues = Object.values(dbItem).map(sqlEncodeValue);
		const sql = `INSERT INTO ${table} (${Object.keys(dbItem).join(', ')}) VALUES (${sqlValues.join(', ')}) RETURNING id`;
		console.log('SQL: '+sql);
		const result: QueryResult = await client.query(sql);
		if (returnItem) {
			return await get_item(table, result.rows[0].id) as TopLevelItem;
		} else {
			return result.rows[0].id;
		}
	} finally {
		client.release();
	}
}

function prepItemForDB(table: string, item: TopLevelItem): Record<string, unknown> {
	fingerprint_item(table, item);	
	const columns = columns4table[table];
	const reducedItem: Record<string, unknown> = {};
	const restItem = {...item};
	for (const column of columns) {
		const value = restItem[column.name];
		if (value !== undefined) {
			reducedItem[column.name] = value;
			delete restItem[column.name];
		}
	}
	reducedItem.props = JSON.stringify(restItem);
	return reducedItem;
}

/**
 * Encode a value for SQL insertion. Escapes strings and dates. Arrays are mapped recursively. Objects are converted to JSON strings. 
 * null and undefined are converted to NULL.
 * @param value - the value to encode
 * @returns the encoded value
 */
function sqlEncodeValue(value: unknown): unknown {
	if (value instanceof Date) {
		// Convert Date to ISO string and quote it
		return `'${value.toISOString()}'`;
	}
	if (typeof value === 'object') {
		value = JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return value.map(sqlEncodeValue);
	}
	if (typeof value === 'string') {
		// safely escape string for SQL
		return `'${value.replace(/'/g, "''")}'`;
	}	
	if (value === null || value === undefined) {
		return 'NULL';
	}	
	// primitive values are returned as is
	if (typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	throw new Error('sqlEncodeValue: Unexpected value type: '+typeof value);
}


async function update_item(table: string, id: number, item: TopLevelItem): Promise<void> {
	console.log('Updating item... '+table+' '+id);
	const client = await db_get_client();
	const dbItem = prepItemForDB(table, item);	
	try {
		const setColumns = Object.entries(dbItem).map(([key, value]) => `${key} = ${sqlEncodeValue(value)}`).join(', ');
		const sql = `UPDATE ${table} SET ${setColumns} WHERE id = ${sqlEncodeValue(id)}`;
		console.log('SQL: '+sql);
		await client.query(sql);
	} finally {
		client.release();
	}
}

/**
 * Delete
 * @param {*} table 
 * @param {*} id 
 * @returns 
 */
async function delete_item(table: string, id: number): Promise<void> {
	const client = await db_get_client();
	try {
		await client.query(
			`DELETE FROM ${table} WHERE id = $1`,
			[id]
		);
	} finally {
		client.release();
	}
}

export { db_init, db_close, db_query_items, db_get_client, get_item, create_item, update_item, delete_item };
export type { TopLevelItem as Item };

