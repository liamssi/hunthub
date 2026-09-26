// Browser side of the live channel (/api/live): one WebSocket per tab,
// shared by all subscribers, reconnecting with backoff. Topics are
// re-subscribed after every reconnect.
import type { LiveServerMessage, LiveTopic } from '@hunthub/shared/machines';

type Handler = (message: LiveServerMessage) => void;

const handlers = new Map<LiveTopic, Set<Handler>>();
let socket: WebSocket | null = null;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function url() {
	const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${scheme}//${location.host}/api/live`;
}

function sendSubscribe(topic: LiveTopic) {
	if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'subscribe', topic }));
}

/** Which topics a message concerns, so it reaches the right handlers. */
function topicsOf(message: LiveServerMessage): LiveTopic[] {
	switch (message.type) {
		case 'machine.updated':
			return ['machines', `machine:${message.machine.id}`];
		case 'machine.removed':
		case 'machine.connection':
		case 'machine.stats':
			return ['machines', `machine:${message.machineId}`];
		case 'enroll.completed':
			return ['machines'];
		case 'machine.herdr':
			return ['agents', `machine:${message.machineId}`];
		case 'attention':
			return ['agents'];
		default:
			return [];
	}
}

function connect() {
	if (socket || handlers.size === 0) return;
	const ws = new WebSocket(url());
	socket = ws;
	ws.onopen = () => {
		attempt = 0;
		for (const topic of handlers.keys()) sendSubscribe(topic);
	};
	ws.onmessage = (event) => {
		let message: LiveServerMessage;
		try {
			message = JSON.parse(event.data);
		} catch {
			return;
		}
		const delivered = new Set<Handler>();
		for (const topic of topicsOf(message)) {
			for (const handler of handlers.get(topic) ?? []) {
				if (delivered.has(handler)) continue;
				delivered.add(handler);
				handler(message);
			}
		}
	};
	ws.onclose = () => {
		socket = null;
		if (handlers.size === 0) return;
		const delay = Math.min(30_000, 1000 * 2 ** attempt++);
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, delay);
	};
}

/** Subscribes to a topic; returns an unsubscribe function (use in $effect cleanup). */
export function subscribeLive(topic: LiveTopic, handler: Handler): () => void {
	let set = handlers.get(topic);
	const isNewTopic = !set;
	if (!set) handlers.set(topic, (set = new Set()));
	set.add(handler);
	if (socket) {
		if (isNewTopic) sendSubscribe(topic);
	} else if (!reconnectTimer) {
		connect();
	}
	return () => {
		set.delete(handler);
		if (set.size > 0) return;
		handlers.delete(topic);
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'unsubscribe', topic }));
		if (handlers.size === 0) socket?.close();
	};
}
