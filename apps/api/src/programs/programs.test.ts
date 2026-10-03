// Programs from HackerOne, against a fake Hacker API. Runs against the dev
// database and cleans up after itself.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';
import { app } from '../app';
import { auth } from '../auth';
import { db } from '../db';
import { platformAccount, program, user } from '../db/schema';
import { decryptCredential } from '../lib/credentials';

const run = Date.now();
const acme = `acme-${run}`;
const secret = `secret-${run}`;
const TOKEN = 'good-token-123';

/** Which programs each fake HackerOne user can see. */
const visible: Record<string, string[]> = { hacker: [acme, secret], other: [acme] };

let changedPolicy: string | null = null;

const h1Program = (handle: string) => ({
	id: handle,
	type: 'program',
	attributes: {
		handle,
		name: handle.startsWith('acme') ? 'Acme Corp' : 'Secret Co',
		state: handle.startsWith('acme') ? 'public_mode' : 'soft_launched',
		submission_state: 'open',
		offers_bounties: handle.startsWith('acme'),
		policy: handle.startsWith('acme') && changedPolicy ? changedPolicy : `Policy of ${handle}.`,
		number_of_reports_for_user: 2,
		number_of_valid_reports_for_user: 1,
		bounty_earned_for_user: 500,
		bookmarked: false
	}
});

const scopes: Record<string, object[]> = {
	[acme]: [
		{ id: 1, type: 'structured-scope', attributes: { asset_type: 'URL', asset_identifier: 'https://api.acme.test', eligible_for_bounty: true, eligible_for_submission: true, instruction: 'The API', max_severity: 'critical' } },
		{ id: 2, type: 'structured-scope', attributes: { asset_type: 'WILDCARD', asset_identifier: '*.acme.test', eligible_for_bounty: false, eligible_for_submission: true, instruction: '', max_severity: 'medium' } },
		{ id: 3, type: 'structured-scope', attributes: { asset_type: 'URL', asset_identifier: 'https://blog.acme.test', eligible_for_bounty: false, eligible_for_submission: false, instruction: 'Out of scope', max_severity: null } }
	],
	[secret]: [{ id: 4, type: 'structured-scope', attributes: { asset_type: 'GOOGLE_PLAY_APP_ID', asset_identifier: 'test.secret.app', eligible_for_bounty: true, eligible_for_submission: true } }]
};

let h1: ReturnType<typeof Bun.serve>;
let server: ReturnType<typeof Bun.serve>;
let base: string;
const users = { a: { email: `test-programs-a-${run}@hunthub.test`, cookie: '' }, b: { email: `test-programs-b-${run}@hunthub.test`, cookie: '' } };
const savedUrl = process.env.HACKERONE_API_URL;

beforeAll(async () => {
	h1 = Bun.serve({
		port: 0,
		fetch(req) {
			const [name, token] = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Basic /, ''), 'base64').toString().split(':');
			if (token !== TOKEN || !name || !visible[name]) return new Response('unauthorized', { status: 401 });
			const url = new URL(req.url);
			if (url.pathname === '/v1/hackers/programs') {
				// One program per page, to exercise pagination.
				const page = Number(url.searchParams.get('page[number]') ?? 1);
				const list = visible[name];
				const next = page < list.length ? `${url.origin}/v1/hackers/programs?page%5Bnumber%5D=${page + 1}` : undefined;
				return Response.json({ data: [h1Program(list[page - 1]!)], links: next ? { next } : {} });
			}
			const m = url.pathname.match(/^\/v1\/hackers\/programs\/([^/]+)\/structured_scopes$/);
			if (m && visible[name].includes(m[1]!)) return Response.json({ data: scopes[m[1]!] ?? [], links: {} });
			return new Response('not found', { status: 404 });
		}
	});
	process.env.HACKERONE_API_URL = `http://localhost:${h1.port}/v1`;
	server = Bun.serve({ port: 0, fetch: app.fetch });
	base = `http://localhost:${server.port}`;
	for (const u of Object.values(users)) {
		await auth.api.createUser({ body: { email: u.email, name: 'Test Hunter', password: 'test-password-123', role: 'member' } });
		const signIn = await auth.api.signInEmail({ body: { email: u.email, password: 'test-password-123' }, returnHeaders: true });
		u.cookie = signIn.headers
			.getSetCookie()
			.map((c) => c.split(';')[0])
			.join('; ');
	}
});

afterAll(async () => {
	await db.delete(user).where(inArray(user.email, [users.a.email, users.b.email]));
	await db.delete(program).where(like(program.handle, `%-${run}`));
	process.env.HACKERONE_API_URL = savedUrl;
	server.stop(true);
	h1.stop(true);
});

const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();

const api = (who: keyof typeof users, path: string, init: RequestInit = {}) =>
	fetch(`${base}/api${path}`, { ...init, headers: { 'content-type': 'application/json', cookie: users[who].cookie, ...(init.headers ?? {}) } });

const connect = (who: keyof typeof users, username: string, token = TOKEN) =>
	api(who, '/platform-accounts/hackerone', { method: 'PUT', body: JSON.stringify({ username, token }) });

async function synced(who: keyof typeof users) {
	for (let i = 0; i < 100; i++) {
		const { accounts } = await json(api(who, '/platform-accounts'));
		if (accounts[0] && !accounts[0].sync) return accounts[0];
		await Bun.sleep(100);
	}
	throw new Error('sync did not finish');
}

const mine = async (who: keyof typeof users) =>
	((await json(api(who, '/programs'))).programs as { id: number; handle: string }[]).filter((p) => p.handle.endsWith(`-${run}`));

describe('HackerOne programs', () => {
	test('a refused token is not stored', async () => {
		const res = await connect('a', 'hacker', 'wrong-token-1');
		expect(res.status).toBe(400);
		expect((await json(res)).error).toBe('invalid_token');
		expect((await json(api('a', '/platform-accounts'))).accounts).toEqual([]);
	});

	test('connecting syncs every page of programs and their scopes; the token is stored encrypted', async () => {
		const res = await connect('a', 'hacker');
		expect(res.status).toBe(200);
		const account = await synced('a');
		expect(account).toMatchObject({ platform: 'hackerone', username: 'hacker', status: 'ok' });
		expect(JSON.stringify(account)).not.toContain(TOKEN);

		const [stored] = await db.select().from(platformAccount).where(eq(platformAccount.username, 'hacker'));
		expect(stored!.tokenEnc).not.toContain(TOKEN);
		expect(decryptCredential(stored!.tokenEnc)).toBe(TOKEN);

		const programs = await mine('a');
		expect(programs.map((p) => p.handle).sort()).toEqual([acme, secret].sort());
		expect(programs.find((p) => p.handle === acme)).toMatchObject({
			name: 'Acme Corp',
			public: true,
			offersBounties: true,
			inScope: 2,
			bountyAssets: 1,
			assetTypes: ['URL', 'WILDCARD'],
			mine: { reports: 2, validReports: 1, bountyEarned: 500, bookmarked: false },
			url: `https://hackerone.com/${acme}`
		});
		expect(programs.find((p) => p.handle === secret)).toMatchObject({ public: false, assetTypes: ['GOOGLE_PLAY_APP_ID'] });
	});

	test('a program shows its policy and scope, in scope first', async () => {
		const id = (await mine('a')).find((p) => p.handle === acme)!.id;
		const { program: p } = await json(api('a', `/programs/${id}`));
		expect(p.policy).toBe(`Policy of ${acme}.`);
		expect(p.scopes.map((s: { identifier: string }) => s.identifier)).toEqual(['https://api.acme.test', '*.acme.test', 'https://blog.acme.test']);
		expect(p.scopes[2]).toMatchObject({ eligibleForSubmission: false, instruction: 'Out of scope' });
	});

	test('each user sees only what their account can access; a shared program is stored once', async () => {
		expect(await mine('b')).toEqual([]);
		const secretId = (await mine('a')).find((p) => p.handle === secret)!.id;
		expect((await api('b', `/programs/${secretId}`)).status).toBe(404);

		await connect('b', 'other');
		await synced('b');
		expect((await mine('b')).map((p) => p.handle)).toEqual([acme]);
		expect(await db.select().from(program).where(eq(program.handle, acme))).toHaveLength(1);
	});

	test('a refresh records what changed: scope added, removed and changed, policy and rewards', async () => {
		const acmeScopes = scopes[acme] as { id: number; attributes: Record<string, unknown> }[];
		const before = [...acmeScopes];
		scopes[acme] = [
			{ ...acmeScopes[0]!, attributes: { ...acmeScopes[0]!.attributes, max_severity: 'high' } },
			{ id: 5, type: 'structured-scope', attributes: { asset_type: 'URL', asset_identifier: 'https://new.acme.test', eligible_for_bounty: true, eligible_for_submission: true } }
		];
		try {
			changedPolicy = 'New rules.';
			const res = await api('a', '/platform-accounts/hackerone/sync', { method: 'POST' });
			expect(res.status).toBe(202);
			await synced('a');
			const id = (await mine('a')).find((p) => p.handle === acme)!.id;
			const { program: p } = await json(api('a', `/programs/${id}`));
			const kinds = p.events.map((e: { kind: string }) => e.kind).sort();
			expect(kinds).toEqual(['policy_changed', 'scope_added', 'scope_changed', 'scope_removed', 'scope_removed']);
			expect(p.events.find((e: { kind: string }) => e.kind === 'scope_changed').detail).toMatchObject({
				identifier: 'https://api.acme.test',
				changes: { maxSeverity: { before: 'critical', after: 'high' } }
			});
			expect(p.events.find((e: { kind: string }) => e.kind === 'policy_changed').detail).toEqual({ before: `Policy of ${acme}.`, after: 'New rules.' });
			expect(p.lastChangeAt).not.toBeNull();
			// The same changes show in the feed across programs, for everyone who can see the program.
			const feed = (await json(api('a', '/programs/changes'))).events.filter((e: { programHandle: string }) => e.programHandle === acme);
			expect(feed).toHaveLength(5);
			expect((await json(api('b', '/programs/changes'))).events.filter((e: { programHandle: string }) => e.programHandle === acme)).toHaveLength(5);
		} finally {
			scopes[acme] = before;
			changedPolicy = null;
		}
	});

	test('disconnecting removes the account and its programs; private ones nobody sees are deleted', async () => {
		expect((await api('a', '/platform-accounts/hackerone', { method: 'DELETE' })).status).toBe(204);
		expect(await mine('a')).toEqual([]);
		expect(await db.select().from(program).where(eq(program.handle, secret))).toHaveLength(0);
		// Still visible to the other user.
		expect((await mine('b')).map((p) => p.handle)).toEqual([acme]);
	});
});
