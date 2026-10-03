// How good the link to HuntHub is, from the live channel's round trip (pinged
// every few seconds). Terminals ask for fewer frames on a slow link, and the
// workspace shows the quality.
export type LinkLevel = 'unknown' | 'good' | 'fair' | 'poor' | 'offline';

export const link = $state({
	/** Smoothed round trip in milliseconds (null until measured). */
	rtt: null as number | null,
	level: 'unknown' as LinkLevel
});

const levelFor = (rtt: number): LinkLevel => (rtt < 150 ? 'good' : rtt < 400 ? 'fair' : 'poor');

/** A new round-trip measurement (smoothed, so one slow ping doesn't flip the level). */
export function noteRoundTrip(ms: number) {
	link.rtt = link.rtt === null ? ms : Math.round(link.rtt * 0.7 + ms * 0.3);
	link.level = levelFor(link.rtt);
}

export function noteOffline() {
	link.rtt = null;
	link.level = 'offline';
}

/** Terminal frames per second to ask for at a link level. */
export function framesPerSecond(level: LinkLevel): number {
	return level === 'poor' ? 8 : level === 'fair' ? 15 : 30;
}
