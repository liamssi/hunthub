import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { client, db } from './db';

// Arbitrary constant: one API instance migrates at a time.
const MIGRATION_LOCK_ID = 727_001;

await client`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
try {
	await migrate(db, { migrationsFolder: './drizzle' });
	console.log('migrations applied');
} finally {
	await client`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
	await client.end();
}
