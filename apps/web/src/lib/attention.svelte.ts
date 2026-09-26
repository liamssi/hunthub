// Agents that need someone, or finished: the hub notices and tells every
// browser. Each event goes to the inbox; a toast (and a desktop notification
// when this tab isn't in front, if enabled) unless you're looking at that agent.
import type { AttentionEvent } from '@hunthub/shared/machines';
import { toast } from 'svelte-sonner';
import { goto } from '$app/navigation';
import { workspaceHref } from './fleet.svelte';
import { subscribeLive } from './live';

const SEEN_KEY = 'hunthub.attention.seen';
const DESKTOP_KEY = 'hunthub.attention.desktop';

export const attention = $state({
	events: [] as AttentionEvent[],
	/** Events up to this time were seen (in this browser). */
	seenAt: 0,
	/** Desktop notifications, in this browser. */
	desktop: false,
	/** The inbox panel. */
	open: false
});

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function write(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Only a convenience.
	}
}

export const unreadCount = () => attention.events.filter((e) => Date.parse(e.at) > attention.seenAt).length;

export function markSeen() {
	attention.seenAt = Date.now();
	write(SEEN_KEY, String(attention.seenAt));
}

export function openInbox() {
	attention.open = true;
}

export const desktopSupported = () => typeof Notification !== 'undefined';

/** Turns desktop notifications on (asking the browser's permission) or off. */
export async function setDesktop(on: boolean) {
	if (on && desktopSupported()) {
		const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
		attention.desktop = permission === 'granted';
		if (!attention.desktop) toast.error('Notifications are blocked for HuntHub in this browser', { description: "Allow them in the site's settings, then try again." });
	} else attention.desktop = false;
	write(DESKTOP_KEY, attention.desktop ? 'on' : 'off');
}

/** Whether you're looking at a pane right now (the workspace answers while it's shown). */
type Probe = (machineId: string, session: string, paneId: string) => boolean;
let probe: Probe | null = null;
export function setWatchingProbe(fn: Probe): () => void {
	probe = fn;
	return () => {
		if (probe === fn) probe = null;
	};
}

const where = (e: AttentionEvent) => `${e.workspaceLabel} · ${e.session} · ${e.machineName}`;

function onEvent(e: AttentionEvent) {
	if (attention.events.some((x) => x.id === e.id)) return;
	attention.events = [e, ...attention.events].slice(0, 100);
	if (probe?.(e.machineId, e.session, e.paneId)) {
		// You're looking at it: nothing to tell.
		if (attention.open) markSeen();
		return;
	}
	const href = workspaceHref(e.machineId, e.session, e.paneId);
	const title = e.kind === 'needs_you' ? `${e.agent} needs you` : `${e.agent} finished`;
	const open = () => goto(href);
	if (e.kind === 'needs_you') {
		toast.warning(title, { description: where(e), duration: 12_000, action: { label: 'Open', onClick: open }, cancel: { label: 'Reply', onClick: openInbox } });
	} else {
		toast.success(title, { description: where(e), action: { label: 'Open', onClick: open } });
	}
	if (attention.desktop && desktopSupported() && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
		const n = new Notification(title, { body: where(e), tag: `${e.machineId}:${e.session}:${e.paneId}` });
		n.onclick = () => {
			window.focus();
			void open();
			n.close();
		};
	}
}

let users = 0;
let stop: (() => void) | null = null;

/** Starts listening while at least one component uses it; returns a release function. */
export function useAttention(): () => void {
	users++;
	if (users === 1) {
		attention.seenAt = Number(read(SEEN_KEY)) || Date.now();
		attention.desktop = read(DESKTOP_KEY) === 'on' && desktopSupported() && Notification.permission === 'granted';
		void fetch('/api/attention')
			.then((r) => (r.ok ? r.json() : { events: [] }))
			.then((body: { events: AttentionEvent[] }) => {
				const ids = new Set(attention.events.map((e) => e.id));
				attention.events = [...attention.events, ...body.events.filter((e) => !ids.has(e.id))].sort((a, b) => b.id - a.id).slice(0, 100);
			})
			.catch(() => {});
		stop = subscribeLive('agents', (message) => {
			if (message.type === 'attention') onEvent(message.event);
		});
	}
	return () => {
		users--;
		if (users === 0) {
			stop?.();
			stop = null;
		}
	};
}
