// HackerOne's Hacker API (https://api.hackerone.com/hacker-resources/): the
// programs a hacker can access (public and private) and their structured
// scopes. Requests are spaced out to stay well inside HackerOne's limits.

export type HackerOneCredentials = { username: string; token: string };

export type H1Program = {
	id: number | string;
	attributes: {
		handle: string;
		name: string;
		state?: string;
		submission_state?: string;
		offers_bounties?: boolean;
		policy?: string | null;
		number_of_reports_for_user?: number;
		number_of_valid_reports_for_user?: number;
		bounty_earned_for_user?: number;
		bookmarked?: boolean;
		[key: string]: unknown;
	};
};

export type H1Scope = {
	id: number | string;
	attributes: {
		asset_type: string;
		asset_identifier: string;
		eligible_for_bounty?: boolean;
		eligible_for_submission?: boolean;
		instruction?: string | null;
		max_severity?: string | null;
		[key: string]: unknown;
	};
};

/** HackerOne refused the credentials. */
export class HackerOneAuthError extends Error {}

const baseUrl = () => (process.env.HACKERONE_API_URL ?? 'https://api.hackerone.com/v1').replace(/\/$/, '');
/** At most this many requests a second, across all accounts. */
const REQUESTS_PER_SECOND = 4;
const MAX_PAGES = 200;
const TIMEOUT_MS = 30_000;

let nextSlot = 0;
async function slot() {
	const now = Date.now();
	const at = Math.max(now, nextSlot);
	nextSlot = at + 1000 / REQUESTS_PER_SECOND;
	if (at > now) await Bun.sleep(at - now);
}

async function get<T>(creds: HackerOneCredentials, url: string): Promise<T> {
	// Credentials only ever go to HackerOne's API (pagination links included).
	if (new URL(url).origin !== new URL(baseUrl()).origin) throw new Error(`Unexpected HackerOne link: ${url}`);
	const authorization = `Basic ${Buffer.from(`${creds.username}:${creds.token}`).toString('base64')}`;
	for (let attempt = 0; ; attempt++) {
		await slot();
		const res = await fetch(url, { headers: { authorization, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (res.status === 401 || res.status === 403) throw new HackerOneAuthError('HackerOne refused the username or API token.');
		if (res.status === 429 && attempt < 3) {
			const wait = Number(res.headers.get('retry-after')) || 30;
			console.warn(`hackerone: rate limited; waiting ${wait}s`);
			await Bun.sleep(Math.min(wait, 120) * 1000);
			continue;
		}
		if (!res.ok) throw new Error(`HackerOne answered ${res.status} for ${new URL(url).pathname}`);
		return (await res.json()) as T;
	}
}

type Page<T> = { data?: T[]; links?: { next?: string | null } };

async function all<T>(creds: HackerOneCredentials, first: string): Promise<T[]> {
	const out: T[] = [];
	let url: string | null | undefined = first;
	for (let i = 0; url && i < MAX_PAGES; i++) {
		const page: Page<T> = await get<Page<T>>(creds, url);
		out.push(...(page.data ?? []));
		url = page.links?.next;
	}
	return out;
}

/** Checks the credentials with one small request. */
export async function verifyCredentials(creds: HackerOneCredentials): Promise<void> {
	await get(creds, `${baseUrl()}/hackers/programs?page%5Bsize%5D=1`);
}

export const listPrograms = (creds: HackerOneCredentials) => all<H1Program>(creds, `${baseUrl()}/hackers/programs?page%5Bsize%5D=100`);

export const listScopes = (creds: HackerOneCredentials, handle: string) =>
	all<H1Scope>(creds, `${baseUrl()}/hackers/programs/${encodeURIComponent(handle)}/structured_scopes?page%5Bsize%5D=100`);
