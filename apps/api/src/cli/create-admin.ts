// Creates an admin account. Intended for bootstrapping a fresh install.
// Usage: bun run create-admin <email> <name> <password>
import { auth } from '../auth';
import { client } from '../db';

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
	console.error('usage: bun run create-admin <email> <name> <password>');
	process.exit(1);
}

try {
	const { user } = await auth.api.createUser({ body: { email, name, password, role: 'admin' } });
	console.log(`created admin ${user.email}`);
} catch (err) {
	console.error('failed to create admin:', err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	await client.end();
}
