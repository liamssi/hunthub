// Roles and permissions shared by the API (enforcement) and the web app (typing and UI checks).
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access';

export const ac = createAccessControl(defaultStatements);

export const roles = {
	admin: ac.newRole(adminAc.statements),
	member: ac.newRole(userAc.statements)
};

export type RoleName = keyof typeof roles;
