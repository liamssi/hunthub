// Runner connection timings, editable by admins. Kept in memory for the hot
// path (every runner message) and persisted in app_setting.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { MachineConnectionSettings } from '@hunthub/shared/machines';
import { db } from '../db';
import { appSetting } from '../db/schema';

const KEY = 'machines.connection';

function envMs(name: string, fallback: number): number {
	const n = Number(process.env[name]);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const connectionSettingsSchema = z
	.object({
		heartbeatIntervalMs: z.number().int().min(500).max(60_000),
		offlineAfterMs: z.number().int().max(600_000),
		statsIntervalMs: z.number().int().min(1_000).max(60_000)
	})
	.refine((s) => s.offlineAfterMs >= s.heartbeatIntervalMs * 3, {
		message: 'Offline threshold must be at least 3 heartbeats.',
		path: ['offlineAfterMs']
	});

const defaults: MachineConnectionSettings = {
	heartbeatIntervalMs: envMs('RUNNER_HEARTBEAT_INTERVAL_MS', 1_000),
	offlineAfterMs: envMs('RUNNER_OFFLINE_AFTER_MS', 5_000),
	statsIntervalMs: envMs('RUNNER_STATS_INTERVAL_MS', 5_000)
};

let current: MachineConnectionSettings = { ...defaults };

/** Current settings (synchronous; loaded at startup). */
export function connectionSettings(): MachineConnectionSettings {
	return current;
}

export async function loadConnectionSettings() {
	const [row] = await db.select().from(appSetting).where(eq(appSetting.key, KEY));
	const parsed = connectionSettingsSchema.safeParse({ ...defaults, ...((row?.value as object) ?? {}) });
	current = parsed.success ? parsed.data : { ...defaults };
}

/** Replaces the settings in memory only (used by tests; not persisted). */
export function setConnectionSettingsInMemory(value: MachineConnectionSettings) {
	current = value;
}

export async function saveConnectionSettings(value: MachineConnectionSettings, userId: string) {
	await db
		.insert(appSetting)
		.values({ key: KEY, value, updatedBy: userId })
		.onConflictDoUpdate({ target: appSetting.key, set: { value, updatedBy: userId } });
	current = value;
}
