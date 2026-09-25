const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** 1536 -> "1.5 KB" (binary units, as `free`/`df -h` show them). */
export function formatBytes(bytes: number, digits = 1): string {
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(unit === 0 ? 0 : digits)} ${units[unit]}`;
}

export function formatRate(bytesPerSecond: number): string {
	return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatPercent(value: number): string {
	return `${Math.round(value)}%`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "just now", "5 minutes ago", "3 days ago". */
export function formatRelative(iso: string | null, now = Date.now()): string {
	if (!iso) return 'never';
	const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
	const abs = Math.abs(seconds);
	if (abs < 45) return 'just now';
	if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
	if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
	return relative.format(Math.round(seconds / 86400), 'day');
}
