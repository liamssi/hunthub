import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Agents are one of Explore's views now.
export const load: PageServerLoad = () => {
	redirect(307, '/explore?show=agents&group=status');
};
