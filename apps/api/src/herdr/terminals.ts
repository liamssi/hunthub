// Relays live terminals between browsers and runners. Each browser WebSocket
// is one channel to one pane on one machine.
import { randomUUID } from 'node:crypto';
import type { WSContext } from 'hono/ws';
import type { TerminalFrame } from '@hunthub/shared/runner-protocol';
import { sendToMachine } from '../machines/registry';
import { compressOptions } from '../lib/ws-compress';

type Channel = { id: string; machineId: string; browser: WSContext };

const channels = new Map<string, Channel>();

/** A browser that can't keep up is cut off (it can reopen and get a full frame). */
const MAX_BROWSER_BUFFER = 8 * 1024 * 1024;

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
	channels.set(id, { id, machineId: opts.machineId, browser });
	return id;
}

function sendToBrowser(channel: Channel, message: object) {
	const ws = channel.browser;
	if (ws.readyState !== 1) return;
	const buffered = (ws.raw as { getBufferedAmount?: () => number } | undefined)?.getBufferedAmount?.() ?? 0;
	if (buffered > MAX_BROWSER_BUFFER) {
		closeTerminal(channel.id, 'too slow');
		return;
	}
	const data = JSON.stringify(message);
	ws.send(data, compressOptions(data.length));
}

/** A frame from the runner. */
export function terminalFrame(machineId: string, channelId: string, frame: TerminalFrame) {
	const c = channels.get(channelId);
	if (c?.machineId === machineId) sendToBrowser(c, { type: 'frame', ...frame });
}

/** The runner closed a channel (pane gone, control taken over, error…). */
export function terminalClosed(machineId: string, channelId: string, reason: string) {
	const c = channels.get(channelId);
	if (!c || c.machineId !== machineId) return;
	channels.delete(channelId);
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
	channels.delete(channelId);
	sendToMachine(c.machineId, { type: 'term.close', channel: c.id });
	if (c.browser.readyState === 1) c.browser.close(1000, reason);
}

/** The machine disconnected: all its terminals end. */
export function closeMachineTerminals(machineId: string) {
	for (const c of [...channels.values()]) {
		if (c.machineId !== machineId) continue;
		channels.delete(c.id);
		sendToBrowser(c, { type: 'closed', reason: 'The machine disconnected.' });
		c.browser.close(1000, 'machine disconnected');
	}
}
