import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { admin } from 'better-auth/plugins';
import { ac, roles } from '@hunthub/shared/permissions';
import { db } from './db';
import * as schema from './db/schema';

const secret = process.env.BETTER_AUTH_SECRET ?? '';
if (secret.length < 32) {
	throw new Error('BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)');
}

const baseURL = process.env.BETTER_AUTH_URL;

// Session age (seconds) after which admin changes require signing in again.
const ADMIN_FRESH_AGE = 60 * 60;

// Admin endpoints that only read data; every other /admin/* endpoint changes something.
const adminReadPaths = new Set(['/admin/list-users', '/admin/list-user-sessions', '/admin/get-user', '/admin/has-permission']);

export const auth = betterAuth({
	basePath: '/api/auth',
	baseURL,
	secret,
	// Extra origins allowed to call auth (comma-separated), e.g. the dev web server.
	trustedOrigins: process.env.TRUSTED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean),
	database: drizzleAdapter(db, { provider: 'pg', schema }),
	emailAndPassword: {
		enabled: true,
		// Accounts are created by admins only.
		disableSignUp: true,
		minPasswordLength: 12
	},
	session: {
		expiresIn: 60 * 60 * 12,
		updateAge: 60 * 60
	},
	rateLimit: {
		enabled: true,
		storage: 'database',
		customRules: {
			'/sign-in/email': { window: 300, max: 5 }
		}
	},
	advanced: {
		useSecureCookies: baseURL?.startsWith('https://') ?? false
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			if (!ctx.path.startsWith('/admin/') || adminReadPaths.has(ctx.path)) return;
			const session = await getSessionFromCtx(ctx);
			if (!session) return; // the endpoint itself rejects unauthenticated calls
			if (Date.now() - new Date(session.session.createdAt).getTime() >= ADMIN_FRESH_AGE * 1000) {
				throw new APIError('FORBIDDEN', {
					message: 'For security, sign in again to make admin changes.',
					code: 'SESSION_NOT_FRESH'
				});
			}
		}),
		after: createAuthMiddleware(async (ctx) => {
			// A password reset by an admin signs the user out everywhere.
			if (ctx.path === '/admin/set-user-password' && !(ctx.context.returned instanceof Error)) {
				await ctx.context.internalAdapter.deleteUserSessions(ctx.body.userId);
			}
		})
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
