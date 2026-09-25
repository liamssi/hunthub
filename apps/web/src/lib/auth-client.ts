import { createAuthClient } from 'better-auth/svelte';
import { adminClient } from 'better-auth/client/plugins';
import { ac, roles } from '@hunthub/shared/permissions';

export const authClient = createAuthClient({
	plugins: [adminClient({ ac, roles })]
});
