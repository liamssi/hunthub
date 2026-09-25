// Creates an admin account. Intended for bootstrapping a fresh install.
// Usage: bun run create-admin <email> <name>   (prompts for the password)
// Non-interactive: set ADMIN_PASSWORD in the environment instead.
import { auth } from '../auth';
import { client } from '../db';

const [email, name] = process.argv.slice(2);
if (!email || !name) {
	console.error('usage: bun run create-admin <email> <name>');
	process.exit(1);
}

const password = process.env.ADMIN_PASSWORD ?? prompt('Password (min 12 characters):');
if (!password) {
	console.error('no password given');
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
