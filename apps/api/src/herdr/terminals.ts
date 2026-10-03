// Relays live terminals between browsers and runners. Each browser WebSocket
// is one channel to one pane on one machine.
import { randomUUID } from 'node:crypto';
import type { WSContext } from 'hono/ws';
import { encodeFrame, type FrameHeader } from '@hunthub/shared/frames';
import type { TerminalFrame } from '@hunthub/shared/runner-protocol';
import { sendToMachine } from '../machines/registry';
import { compressOptions } from '../lib/ws-compress';

type Channel = {
	id: string;
	machineId: string;
	browser: WSContext;
	/** Frames are held on the machine until the browser catches up. */
	flowPaused: boolean;
	flowWatch: ReturnType<typeof setInterval> | null;
};

const channels = new Map<string, Channel>();

/** A browser that can't keep up is cut off (it can reopen and get a full frame). */
const MAX_BROWSER_BUFFER = 8 * 1024 * 1024;
/**
 * Unsent data for a browser beyond this pauses its terminal on the machine (native
 * terminals then send only the newest picture once it drains), below the low mark
 * it flows again: a slow link sees fewer frames instead of an ever longer delay.
 */
const FLOW_PAUSE_BYTES = 256 * 1024;
const FLOW_RESUME_BYTES = 32 * 1024;
const FLOW_CHECK_MS = 100;

const buffered = (ws: WSContext) => (ws.raw as { getBufferedAmount?: () => number } | undefined)?.getBufferedAmount?.() ?? 0;

type OpenOptions = {
	machineId: string;
	session: string;
	view: 'pane' | 'session';
	target: string;
	mode: 'observe' | 'control';
	transport: 'cli' | 'native';
	cols: number;
	rows: number;
	takeover: boolean;
};

/** Opens a channel on the machine; returns its id, or null if the machine is offline. */
export function openTerminal(browser: WSContext, opts: OpenOptions): string | null {
	const id = randomUUID();
	const ok = sendToMachine(opts.machineId, {
		type: 'term.open',
		channel: id,
		session: opts.session,
		view: opts.view,
		target: opts.target,
		mode: opts.mode,
		transport: opts.transport,
		cols: opts.cols,
		rows: opts.rows,
		takeover: opts.takeover
	});
	if (!ok) return null;
	channels.set(id, { id, machineId: opts.machineId, browser, flowPaused: false, flowWatch: null });
	return id;
}

function sendToBrowser(channel: Channel, message: object) {
	const ws = channel.browser;
	if (ws.readyState !== 1) return;
	const data = JSON.stringify(message);
	ws.send(data, compressOptions(data.length));
}

/** Holds the terminal's frames on the machine while the browser's link is backed up. */
function checkFlow(c: Channel) {
	const amount = buffered(c.browser);
	if (!c.flowPaused && amount > FLOW_PAUSE_BYTES) {
		c.flowPaused = true;
		sendToMachine(c.machineId, { type: 'term.pause', channel: c.id, reason: 'flow', paused: true });
		c.flowWatch = setInterval(() => checkFlow(c), FLOW_CHECK_MS);
	} else if (c.flowPaused && amount < FLOW_RESUME_BYTES) {
		c.flowPaused = false;
		if (c.flowWatch) clearInterval(c.flowWatch);
		c.flowWatch = null;
		sendToMachine(c.machineId, { type: 'term.pause', channel: c.id, reason: 'flow', paused: false });
	}
}

/** A frame for a browser, as a binary message. */
function forwardFrame(c: Channel, header: FrameHeader, bytes: Uint8Array) {
	const ws = c.browser;
	if (ws.readyState !== 1) return;
	if (buffered(ws) > MAX_BROWSER_BUFFER) {
		closeTerminal(c.id, 'too slow');
		return;
	}
	ws.send(encodeFrame(header, bytes), compressOptions(bytes.length));
	checkFlow(c);
}

/** A frame from the runner, as a binary message (shared/frames.ts). */
export function terminalFrameBytes(machineId: string, channelId: string, header: FrameHeader, bytes: Uint8Array) {
	const c = channels.get(channelId);
	if (c?.machineId === machineId) forwardFrame(c, header, bytes);
}

/** A frame from a runner that sends JSON (older runners). */
export function terminalFrame(machineId: string, channelId: string, frame: TerminalFrame) {
	const { bytes, ...header } = frame;
	terminalFrameBytes(machineId, channelId, header, Buffer.from(bytes, 'base64'));
}

function forget(c: Channel) {
	channels.delete(c.id);
	if (c.flowWatch) clearInterval(c.flowWatch);
	c.flowWatch = null;
}

/** The runner closed a channel (pane gone, control taken over, error…). */
export function terminalClosed(machineId: string, channelId: string, reason: string) {
	const c = channels.get(channelId);
	if (!c || c.machineId !== machineId) return;
	forget(c);
	sendToBrowser(c, { type: 'closed', reason });
	c.browser.close(1000, 'terminal closed');
}

/** Input and control messages from the browser. */
export function terminalFromBrowser(channelId: string, message: unknown) {
	const c = channels.get(channelId);
	if (!c || !message || typeof message !== 'object') return;
	const m = message as Record<string, unknown>;
	if (m.type === 'input' && typeof m.bytes === 'string' && m.bytes.length <= 65536) {
		sendToMachine(c.machineId, { type: 'term.input', channel: c.id, bytes: m.bytes });
	} else if (m.type === 'resize' && Number.isInteger(m.cols) && Number.isInteger(m.rows)) {
		const cols = Math.min(Math.max(m.cols as number, 10), 1000);
		const rows = Math.min(Math.max(m.rows as number, 4), 500);
		sendToMachine(c.machineId, { type: 'term.resize', channel: c.id, cols, rows });
	} else if (m.type === 'pause' && typeof m.paused === 'boolean') {
		// The browser hides it (another tab, session or browser tab): no frames until shown.
		sendToMachine(c.machineId, { type: 'term.pause', channel: c.id, reason: 'hidden', paused: m.paused });
	} else if (m.type === 'rate' && Number.isInteger(m.fps)) {
		sendToMachine(c.machineId, { type: 'term.rate', channel: c.id, fps: Math.min(Math.max(m.fps as number, 1), 60) });
	} else if (m.type === 'scroll' && (m.direction === 'up' || m.direction === 'down')) {
		const lines = Math.min(Math.max(Number(m.lines) || 3, 1), 500);
		const at = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : undefined);
		const column = at(m.column, 1000);
		const row = at(m.row, 500);
		sendToMachine(c.machineId, {
			type: 'term.scroll',
			channel: c.id,
			direction: m.direction,
			lines,
			...(column !== undefined && row !== undefined && { column, row })
		});
	}
}

/** The browser went away, or the hub is closing the channel. */
export function closeTerminal(channelId: string, reason = 'closed') {
	const c = channels.get(channelId);
	if (!c) return;
	forget(c);
	sendToMachine(c.machineId, { type: 'term.close', channel: c.id });
	if (c.browser.readyState === 1) c.browser.close(1000, reason);
}

/** The machine disconnected: all its terminals end. */
export function closeMachineTerminals(machineId: string) {
	for (const c of [...channels.values()]) {
		if (c.machineId !== machineId) continue;
		forget(c);
		sendToBrowser(c, { type: 'closed', reason: 'The machine disconnected.' });
		c.browser.close(1000, 'machine disconnected');
	}
}
