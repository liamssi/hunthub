// Herdr API calls sent to a machine's runner, answered by `herdr.result`.
import { randomUUID } from 'node:crypto';
import { sendToMachine } from '../machines/registry';

export class HerdrCallError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; machineId: string };

const pending = new Map<string, Pending>();

export function callHerdr<T = unknown>(
	machineId: string,
	session: string,
	method: string,
	params: Record<string, unknown> = {},
	timeoutMs = 10_000
): Promise<T> {
	const id = randomUUID();
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new HerdrCallError('timeout', 'The machine did not answer in time.'));
		}, timeoutMs);
		pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, machineId });
		if (!sendToMachine(machineId, { type: 'herdr.call', id, session, method, params })) {
			clearTimeout(timer);
			pending.delete(id);
			reject(new HerdrCallError('offline', 'The machine is offline.'));
		}
	});
}

/** Handles a runner's `herdr.result`; ignores ids it didn't send to that machine. */
export function resolveCall(
	machineId: string,
	result: { id: string; ok: boolean; result?: unknown; error?: { code: string; message: string } }
) {
	const p = pending.get(result.id);
	if (!p || p.machineId !== machineId) return;
	clearTimeout(p.timer);
	pending.delete(result.id);
	if (result.ok) p.resolve(result.result);
	else p.reject(new HerdrCallError(result.error?.code ?? 'failed', result.error?.message ?? 'Herdr call failed'));
}

/** Fails a machine's outstanding calls when its runner disconnects. */
export function failCallsFor(machineId: string) {
	for (const [id, p] of pending) {
		if (p.machineId !== machineId) continue;
		clearTimeout(p.timer);
		pending.delete(id);
		p.reject(new HerdrCallError('offline', 'The machine disconnected.'));
	}
}
