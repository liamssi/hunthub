import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { ac, roles } from '@hunthub/shared/permissions';
import { db } from './db';
import * as schema from './db/schema';

export const auth = betterAuth({
	basePath: '/api/auth',
	database: drizzleAdapter(db, { provider: 'pg', schema }),
	emailAndPassword: {
		enabled: true,
		// Accounts are created by admins only.
		disableSignUp: true
	},
	plugins: [
		admin({
			defaultRole: 'member',
			adminRoles: ['admin'],
			bannedUserMessage: 'Your account is disabled. Ask an admin to re-enable it.',
			ac,
			roles
		})
	]
});
