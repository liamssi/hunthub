// Bug bounty programs (a target is a program) as the hub shows them, read from
// each user's platform account. HackerOne only for now.

export type Platform = 'hackerone';

export const PLATFORM_NAMES: Record<Platform, string> = { hackerone: 'HackerOne' };

/** A user's connection to a platform (the token itself never leaves the hub). */
export type PlatformAccountView = {
	platform: Platform;
	username: string;
	/** ok, invalid (the platform refused the token) or error (the last sync failed). */
	status: 'ok' | 'invalid' | 'error';
	lastError: string | null;
	lastSyncAt: string | null;
	/** Set while a sync runs. */
	sync: SyncProgress | null;
};

export type SyncProgress = {
	phase: 'programs' | 'scopes';
	programs: number;
	/** Programs whose scope has been fetched so far, out of `scopesTotal`. */
	scopesDone: number;
	scopesTotal: number;
};

/** Your own figures on a program. */
export type ProgramMine = {
	reports: number;
	validReports: number;
	bountyEarned: number;
	bookmarked: boolean;
};

export type ProgramSummary = {
	id: number;
	platform: Platform;
	handle: string;
	name: string;
	public: boolean;
	offersBounties: boolean;
	submissionState: string;
	/** Assets in scope (eligible for submission), and how many of those pay bounties. */
	inScope: number;
	bountyAssets: number;
	/** Asset types in scope, e.g. URL, WILDCARD, GOOGLE_PLAY_APP_ID. Empty until the scope is fetched. */
	assetTypes: string[];
	scopesFetchedAt: string | null;
	mine: ProgramMine;
	url: string;
	/** When a change was last recorded (scope, policy, rewards); null if none yet. */
	lastChangeAt: string | null;
};

export type ProgramScopeView = {
	assetType: string;
	identifier: string;
	eligibleForBounty: boolean;
	eligibleForSubmission: boolean;
	maxSeverity: string | null;
	instruction: string;
};

export type ProgramDetail = ProgramSummary & {
	policy: string;
	scopes: ProgramScopeView[];
	updatedAt: string;
	/** Recorded changes, newest first. */
	events: ProgramEvent[];
};

/** The program's page on its platform. */
export const programUrl = (platform: Platform, handle: string) => (platform === 'hackerone' ? `https://hackerone.com/${encodeURIComponent(handle)}` : '');

export type ProgramEventKind = 'added' | 'scope_added' | 'scope_removed' | 'scope_changed' | 'policy_changed' | 'details_changed';

/** An asset as it appears in a change. */
export type ChangedAsset = { assetType: string; identifier: string; inScope: boolean; bounty: boolean };
export type FieldChange<T = unknown> = { before: T; after: T };

/** Something that changed on a program between two syncs. */
export type ProgramEvent = {
	id: number;
	programId: number;
	programName: string;
	programHandle: string;
	kind: ProgramEventKind;
	/**
	 * added: { name }; scope_added / scope_removed: ChangedAsset; scope_changed:
	 * ChangedAsset & { changes: Record<field, FieldChange> }; policy_changed:
	 * FieldChange<string>; details_changed: Record<field, FieldChange>.
	 */
	detail: Record<string, unknown>;
	at: string;
};
