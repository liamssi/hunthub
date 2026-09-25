// Browser live channel: GET /api/live (WebSocket), signed-in users only.
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/bun';
import type { LiveClientMessage } from '@hunthub/shared/machines';
import { type AuthVariables, requireUser } from '../lib/auth-guard';
import { addClient, removeClient, send, subscribe, unsubscribe } from './hub';

export const liveRoutes = new Hono<{ Variables: AuthVariables }>().get(
	'/',
	requireUser,
	upgradeWebSocket((c) => {
		const user = c.get('user');
		let client: ReturnType<typeof addClient> | null = null;
		return {
			onOpen(_event, ws) {
				client = addClient(ws, user);
			},
			onMessage(event) {
				if (!client || typeof event.data !== 'string' || event.data.length > 4096) return;
				let msg: LiveClientMessage;
				try {
					msg = JSON.parse(event.data);
				} catch {
					return;
				}
				if (msg.type === 'subscribe') {
					if (!subscribe(client, msg.topic)) send(client, { type: 'error', message: `Cannot subscribe to ${msg.topic}` });
				} else if (msg.type === 'unsubscribe') {
					unsubscribe(client, msg.topic);
				}
			},
			onClose() {
				if (client) removeClient(client);
			}
		};
	})
);
