// Programs opened in tabs inside the Programs page, so several can be kept at
// hand and switched between. Kept per browser (remembered across reloads).
import { browser } from '$app/environment';

export type ProgramTab = { id: number; name: string; logo: string | null };

const KEY = 'hunthub.programs.tabs';
const MAX_TABS = 20;

function saved(): ProgramTab[] {
	if (!browser) return [];
	try {
		const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(list) ? list.filter((t) => typeof t?.id === 'number' && typeof t?.name === 'string').slice(0, MAX_TABS) : [];
	} catch {
		return [];
	}
}

export const programTabs = $state<{ tabs: ProgramTab[] }>({ tabs: saved() });

function save() {
	try {
		localStorage.setItem(KEY, JSON.stringify(programTabs.tabs));
	} catch {
		// Storage may be unavailable (private mode); tabs then last until the page closes.
	}
}

/** Opens a program in a tab (or refreshes its name and logo when it's open already). */
export function openTab(tab: ProgramTab) {
	const i = programTabs.tabs.findIndex((t) => t.id === tab.id);
	if (i >= 0) programTabs.tabs[i] = tab;
	else programTabs.tabs = [...programTabs.tabs, tab].slice(-MAX_TABS);
	save();
}

/** Closes a tab; returns the tab to show instead (its neighbour), if any. */
export function closeTab(id: number): ProgramTab | null {
	const i = programTabs.tabs.findIndex((t) => t.id === id);
	if (i < 0) return null;
	programTabs.tabs = programTabs.tabs.filter((t) => t.id !== id);
	save();
	return programTabs.tabs[i] ?? programTabs.tabs[i - 1] ?? null;
}

export function closeOtherTabs(id: number) {
	programTabs.tabs = programTabs.tabs.filter((t) => t.id === id);
	save();
}

export function closeAllTabs() {
	programTabs.tabs = [];
	save();
}

/** Moves a tab to another position (drag and drop). */
export function moveTab(id: number, to: number) {
	const tabs = [...programTabs.tabs];
	const from = tabs.findIndex((t) => t.id === id);
	if (from < 0) return;
	const [tab] = tabs.splice(from, 1);
	tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, tab!);
	programTabs.tabs = tabs;
	save();
}
