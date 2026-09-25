import { goto } from '$app/navigation';
import { toast } from 'svelte-sonner';
import { authClient } from '$lib/auth-client';

type AuthError = { code?: string; message?: string; status?: number };

/** Shows an auth API error. Stale sessions get a "sign in again" action. */
export function toastAuthError(error: AuthError, fallback: string) {
	if (error.code === 'SESSION_NOT_FRESH') {
		toast.error(error.message ?? 'Sign in again to continue.', {
			action: {
				label: 'Sign in again',
				onClick: async () => {
					const here = location.pathname + location.search;
					await authClient.signOut();
					await goto(`/login?redirectTo=${encodeURIComponent(here)}`, { invalidateAll: true });
				}
			}
		});
		return;
	}
	toast.error(error.message ?? fallback);
}
