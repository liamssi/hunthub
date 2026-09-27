// A user's settings, kept on the server so they follow the user to any browser.
// Only choices about how HuntHub looks and works; sizes of panels and what's open
// stay in each browser (they depend on the screen).
import { z } from 'zod';

export const preferencesSchema = z.object({
	/** The app's light or dark look (the workspace is always dark). */
	colorMode: z.enum(['light', 'dark', 'system']).optional(),
	/** Terminal font, size and colors (ids from the web app's lists). */
	terminal: z
		.object({
			font: z.string().max(40).optional(),
			size: z.number().int().min(10).max(22).optional(),
			theme: z.string().max(40).optional()
		})
		.optional(),
	/** How terminals connect: Herdr's native protocol (default) or its CLI. */
	transport: z.enum(['native', 'cli']).optional(),
	/** The workspace shows HuntHub's layout, or Herdr's own UI. */
	sessionView: z.enum(['layout', 'herdr']).optional(),
	/** The workspace sidebar lists agents under their space, or separately. */
	sidebarList: z.enum(['separate', 'nested']).optional(),
	/** The agent last started with New agent. */
	agentKind: z.string().max(40).optional()
});

export type Preferences = z.infer<typeof preferencesSchema>;
