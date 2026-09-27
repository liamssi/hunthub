// The signed-in user's settings (theme, terminal, workspace choices), kept on the
// server so they follow the user to any browser. They arrive with the page; a
// change applies at once and is saved a moment later (changes in a row are
// sent together).
import type { Preferences } from '@hunthub/shared/preferences';

export const prefs = $state<Preferences>({});

const SAVE_DELAY_MS = 400;
let pending: Preferences = {};
let timer: ReturnType<typeof setTimeout> | undefined;

function merge(target: Preferences, patch: Preferences) {
	Object.assign(target, { ...patch, ...(patch.terminal && { terminal: { ...target.terminal, ...patch.terminal } }) });
}

/** Changes settings and saves them for this user. */
export function setPreferences(patch: Preferences) {
	merge(prefs, patch);
	merge(pending, patch);
	clearTimeout(timer);
	timer = setTimeout(flush, SAVE_DELAY_MS);
}

async function flush() {
	const body = pending;
	pending = {};
	try {
		await fetch('/api/preferences', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	} catch {
		// Kept for this page; the next change sends them again.
		merge(pending, body);
	}
}

/**
 * Takes the settings the page loaded with. The first time (nothing saved on the
 * server yet), choices this browser remembered from before are carried over.
 */
export function initPreferences(loaded: Preferences) {
	for (const key of Object.keys(prefs) as (keyof Preferences)[]) delete prefs[key];
	merge(prefs, loaded);
	if (Object.keys(loaded).length === 0) {
		const carried = fromThisBrowser();
		if (Object.keys(carried).length) setPreferences(carried);
	}
}

/** Settings this browser kept before they moved to the server. */
function fromThisBrowser(): Preferences {
	const read = (key: string) => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	const out: Preferences = {};
	try {
		const t = JSON.parse(read('hunthub.terminal.appearance.v2') ?? 'null');
		if (t && typeof t === 'object') {
			out.terminal = {
				...(typeof t.font === 'string' && { font: t.font }),
				...(typeof t.size === 'number' && { size: Math.round(t.size) }),
				...(typeof t.theme === 'string' && { theme: t.theme })
			};
		}
	} catch {
		// Ignore what can't be read.
	}
	const view = read('hunthub.session.view');
	if (view === 'herdr' || view === 'layout') out.sessionView = view;
	const list = read('hunthub.workspace.sidebarList');
	if (list === 'nested' || list === 'separate') out.sidebarList = list;
	const kind = read('hunthub.agent.kind');
	if (kind) out.agentKind = kind;
	const mode = read('mode-watcher-mode');
	if (mode === 'light' || mode === 'dark' || mode === 'system') out.colorMode = mode;
	// The connection isn't carried over: native is the new default.
	return out;
}
