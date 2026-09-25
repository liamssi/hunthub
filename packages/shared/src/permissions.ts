// Roles and permissions shared by the API (enforcement) and the web app (typing and UI checks).
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access';

export const ac = createAccessControl(defaultStatements);

export const roles = {
	// Admins manage users and sessions, but may not impersonate anyone.
	admin: ac.newRole({
		...adminAc.statements,
		user: adminAc.statements.user.filter((action) => action !== 'impersonate')
	}),
	member: ac.newRole(userAc.statements)
};

export type RoleName = keyof typeof roles;
