import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { client, db } from './db';

await migrate(db, { migrationsFolder: './drizzle' });
await client.end();
console.log('migrations applied');
