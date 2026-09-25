// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user: {
				id: string;
				name: string;
				email: string;
				role?: string | null;
			} | null;
			session: {
				id: string;
				expiresAt: string;
			} | null;
			/** False when the API could not be reached for the session lookup. */
			apiAvailable: boolean;
		}
		interface PageData {
			user: Locals['user'];
			session: Locals['session'];
		}
		// interface Error {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
