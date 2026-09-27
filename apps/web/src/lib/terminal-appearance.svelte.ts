// How terminals look: font, size and color theme. Shared by every terminal on
// the page and kept in the user's settings; changes apply live, without reconnecting.
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/fira-code';
import '@fontsource-variable/geist-mono';
import type { ITheme } from '@xterm/xterm';
import { prefs, setPreferences } from './preferences.svelte';

const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

export const terminalFonts = [
	{ id: 'jetbrains', label: 'JetBrains Mono', family: `"JetBrains Mono Variable", ${SYSTEM_MONO}` },
	{ id: 'fira', label: 'Fira Code', family: `"Fira Code Variable", ${SYSTEM_MONO}` },
	{ id: 'geist', label: 'Geist Mono', family: `"Geist Mono Variable", ${SYSTEM_MONO}` },
	{ id: 'system', label: 'System monospace', family: SYSTEM_MONO }
] as const;
export type TerminalFontId = (typeof terminalFonts)[number]['id'];

type Palette = [string, string, string, string, string, string, string, string];

function theme(background: string, foreground: string, normal: Palette, bright: Palette, extra: Partial<ITheme> = {}): ITheme {
	const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
	const colors: ITheme = { background, foreground, cursor: foreground, cursorAccent: background, ...extra };
	names.forEach((n, i) => {
		colors[n] = normal[i];
		colors[`bright${n[0]!.toUpperCase()}${n.slice(1)}` as keyof ITheme] = bright[i] as never;
	});
	return colors;
}

/** Well-known dark palettes (their published colors). */
export const terminalThemes = [
	{
		id: 'nord',
		label: 'Nord',
		colors: theme(
			'#2e3440',
			'#d8dee9',
			['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0'],
			['#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'],
			{ cursor: '#d8dee9', selectionBackground: '#434c5e' }
		),
		// Nord's own UI shades: panels a step darker than the editor, borders a step lighter.
		chrome: { stage: '#272c36', sidebar: '#2b303b', border: '#3b4252', accent: '#3b4252', muted: '#81899b', ring: '#88c0d0' }
	},
	{
		id: 'hunthub',
		label: 'HuntHub',
		colors: theme(
			'#0a0a0a',
			'#e5e5e5',
			['#262626', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#c084fc', '#22d3ee', '#d4d4d4'],
			['#737373', '#fca5a5', '#86efac', '#fde047', '#93c5fd', '#d8b4fe', '#67e8f9', '#fafafa'],
			{ selectionBackground: '#3b82f655' }
		)
	},
	{
		id: 'one-dark',
		label: 'One Dark',
		colors: theme(
			'#282c34',
			'#abb2bf',
			['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf'],
			['#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'],
			{ cursor: '#528bff', selectionBackground: '#3e4451' }
		)
	},
	{
		id: 'tokyo-night',
		label: 'Tokyo Night',
		colors: theme(
			'#1a1b26',
			'#c0caf5',
			['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6'],
			['#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'],
			{ selectionBackground: '#33467c' }
		)
	},
	{
		id: 'catppuccin',
		label: 'Catppuccin Mocha',
		colors: theme(
			'#1e1e2e',
			'#cdd6f4',
			['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de'],
			['#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8'],
			{ cursor: '#f5e0dc', selectionBackground: '#585b70' }
		)
	},
	{
		id: 'dracula',
		label: 'Dracula',
		colors: theme(
			'#282a36',
			'#f8f8f2',
			['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'],
			['#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
			{ selectionBackground: '#44475a' }
		)
	},
	{
		id: 'github-dark',
		label: 'GitHub Dark',
		colors: theme(
			'#0d1117',
			'#e6edf3',
			['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4'],
			['#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#ffffff'],
			{ selectionBackground: '#1f6feb55' }
		)
	},
	{
		id: 'solarized-dark',
		label: 'Solarized Dark',
		colors: theme(
			'#002b36',
			'#839496',
			['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'],
			['#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'],
			{ cursor: '#93a1a1', selectionBackground: '#073642' }
		)
	}
] as const;
export type TerminalThemeId = (typeof terminalThemes)[number]['id'];

export const FONT_SIZES = { min: 10, max: 22, default: 14 } as const;
const DEFAULTS = { font: 'jetbrains' as TerminalFontId, size: FONT_SIZES.default as number, theme: 'nord' as TerminalThemeId };

export const appearance = $state({ ...DEFAULTS });

export const fontFamily = (id: TerminalFontId) => (terminalFonts.find((f) => f.id === id) ?? terminalFonts[0]).family;
export const themeColors = (id: TerminalThemeId): ITheme => (terminalThemes.find((t) => t.id === id) ?? terminalThemes[0]).colors;

/** Applies the user's saved appearance (their settings; anything unknown is ignored). */
export function loadAppearance() {
	const saved = prefs.terminal ?? {};
	appearance.font = terminalFonts.some((f) => f.id === saved.font) ? (saved.font as TerminalFontId) : DEFAULTS.font;
	appearance.theme = terminalThemes.some((t) => t.id === saved.theme) ? (saved.theme as TerminalThemeId) : DEFAULTS.theme;
	appearance.size = typeof saved.size === 'number' ? clampSize(saved.size) : DEFAULTS.size;
}

/** Saves the appearance to the user's settings (they follow the user to any browser). */
export function saveAppearance() {
	setPreferences({ terminal: { font: appearance.font, size: appearance.size, theme: appearance.theme } });
}

export const clampSize = (n: number) => Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, Math.round(n)));

export function resetAppearance() {
	Object.assign(appearance, DEFAULTS);
	saveAppearance();
}

// --- The workspace around the terminals follows the terminal theme ------------

type Chrome = { stage: string; sidebar: string; border: string; accent: string; muted: string; ring: string };

/** Mixes two #rrggbb colors; `t` is the share of `b`. */
function mix(a: string, b: string, t: number): string {
	const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	const [x, y] = [n(a), n(b)];
	return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function chromeFor(id: TerminalThemeId): Chrome {
	const t = terminalThemes.find((x) => x.id === id) ?? terminalThemes[0];
	if ('chrome' in t) return t.chrome;
	const bg = t.colors.background!;
	const fg = t.colors.foreground!;
	return {
		stage: mix(bg, '#000000', 0.25),
		sidebar: mix(bg, '#000000', 0.15),
		border: mix(bg, '#ffffff', 0.1),
		accent: mix(bg, '#ffffff', 0.07),
		muted: mix(fg, bg, 0.4),
		ring: t.colors.blue ?? fg
	};
}

/**
 * CSS variables that give the workspace (and anything rendered with it, like
 * menus and dialogs) the terminal theme's look.
 */
export function workspaceVars(id: TerminalThemeId): Record<string, string> {
	const t = terminalThemes.find((x) => x.id === id) ?? terminalThemes[0];
	const c = chromeFor(id);
	const bg = t.colors.background!;
	const fg = t.colors.foreground!;
	return {
		'--background': bg,
		'--foreground': fg,
		'--card': bg,
		'--card-foreground': fg,
		'--popover': c.sidebar,
		'--popover-foreground': fg,
		'--muted': c.accent,
		'--muted-foreground': c.muted,
		'--accent': c.accent,
		'--accent-foreground': fg,
		'--secondary': c.accent,
		'--secondary-foreground': fg,
		'--border': c.border,
		'--input': c.border,
		'--ring': c.ring,
		'--sidebar': c.sidebar,
		'--sidebar-foreground': fg,
		'--sidebar-accent': c.accent,
		'--sidebar-accent-foreground': fg,
		'--sidebar-border': c.border,
		'--sidebar-ring': c.ring,
		'--workspace-stage': c.stage
	};
}
