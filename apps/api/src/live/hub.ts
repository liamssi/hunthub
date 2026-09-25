// Browser live channel: signed-in browsers subscribe to topics and receive
// pushed updates. It only fans out what the API already knows; nothing here
// is needed for data collection, which runs whether or not anyone is watching.
import type { WSContext } from 'hono/ws';
import type { LiveServerMessage, LiveTopic } from '@hunthub/shared/machines';

type Client = {
	ws: WSContext;
	userId: string;
	role: string | null | undefined;
	topics: Set<LiveTopic>;
};

const clients = new Set<Client>();

export function addClient(ws: WSContext, user: { id: string; role?: string | null }): Client {
	const client: Client = { ws, userId: user.id, role: user.role, topics: new Set() };
	clients.add(client);
	return client;
}

export function removeClient(client: Client) {
	clients.delete(client);
}

/** Machine topics are visible to every signed-in user (members can view machines). */
function canSubscribe(_client: Client, topic: string): topic is LiveTopic {
	return topic === 'machines' || /^machine:[0-9a-f-]{36}$/.test(topic);
}

export function subscribe(client: Client, topic: string): boolean {
	if (!canSubscribe(client, topic)) return false;
	client.topics.add(topic);
	return true;
}

export function unsubscribe(client: Client, topic: string) {
	client.topics.delete(topic as LiveTopic);
}

export function send(client: Client, message: LiveServerMessage) {
	if (client.ws.readyState !== 1) return;
	client.ws.send(JSON.stringify(message));
}

/** Sends to every client subscribed to any of the topics (once per client). */
export function publish(topics: LiveTopic[], message: LiveServerMessage) {
	const data = JSON.stringify(message);
	for (const client of clients) {
		if (client.ws.readyState !== 1) continue;
		if (topics.some((t) => client.topics.has(t))) client.ws.send(data);
	}
}

/** Disconnects a user's live sessions, e.g. after they are banned. */
export function disconnectUser(userId: string) {
	for (const client of clients) if (client.userId === userId) client.ws.close(4401, 'unauthorized');
}
