/** A small fixed-window rate limiter, keyed by e.g. client IP. In-memory only. */
export function createRateLimiter(max: number, windowMs: number) {
	const hits = new Map<string, { count: number; resetAt: number }>();
	return (key: string): boolean => {
		const now = Date.now();
		const entry = hits.get(key);
		if (!entry || entry.resetAt <= now) {
			if (hits.size > 10_000) hits.clear();
			hits.set(key, { count: 1, resetAt: now + windowMs });
			return true;
		}
		entry.count++;
		return entry.count <= max;
	};
}
