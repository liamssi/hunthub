// Display helpers for bug bounty programs and their recorded changes.
import type { ChangedAsset, FieldChange, ProgramEvent } from '@hunthub/shared/programs';

/** HackerOne's asset types in plain words. */
const ASSET_TYPES: Record<string, string> = {
	URL: 'Web',
	WILDCARD: 'Wildcard',
	API: 'API',
	CIDR: 'IP range',
	IP_ADDRESS: 'IP address',
	DOMAIN: 'Domain',
	GOOGLE_PLAY_APP_ID: 'Android app',
	OTHER_APK: 'Android app (other)',
	APPLE_STORE_APP_ID: 'iOS app',
	TESTFLIGHT: 'iOS TestFlight',
	OTHER_IPA: 'iOS app (other)',
	WINDOWS_APP_STORE_APP_ID: 'Windows app',
	DOWNLOADABLE_EXECUTABLES: 'Executable',
	SOURCE_CODE: 'Source code',
	HARDWARE: 'Hardware',
	SMART_CONTRACT: 'Smart contract',
	AI_MODEL: 'AI model',
	OTHER: 'Other'
};

export const assetTypeLabel = (type: string) =>
	ASSET_TYPES[type] ??
	type
		.toLowerCase()
		.split('_')
		.map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
		.join(' ');

const FIELD_LABELS: Record<string, string> = {
	name: 'Name',
	public: 'Visibility',
	offersBounties: 'Rewards',
	submissionState: 'Submissions',
	eligibleForBounty: 'Bounty',
	eligibleForSubmission: 'In scope',
	maxSeverity: 'Max severity',
	instruction: 'Instructions',
	assetType: 'Type',
	identifier: 'Asset'
};

function formatValue(field: string, value: unknown): string {
	if (value === null || value === undefined || value === '') return 'none';
	if (field === 'public') return value ? 'public' : 'private';
	if (field === 'offersBounties') return value ? 'bounties' : 'no bounties (VDP)';
	if (field === 'eligibleForBounty') return value ? 'eligible' : 'not eligible';
	if (field === 'eligibleForSubmission') return value ? 'yes' : 'no';
	if (field === 'assetType') return assetTypeLabel(String(value));
	return String(value);
}

export type ChangeLine = { field: string; before: string; after: string; long: boolean };

/** Field changes as readable lines (long text such as instructions is shown separately). */
export function changeLines(changes: Record<string, FieldChange>): ChangeLine[] {
	return Object.entries(changes).map(([field, c]) => ({
		field: FIELD_LABELS[field] ?? field,
		before: formatValue(field, c.before),
		after: formatValue(field, c.after),
		long: field === 'instruction'
	}));
}

/** What a change was, in a few words. */
export function describeEvent(e: ProgramEvent): string {
	const asset = e.detail as ChangedAsset;
	switch (e.kind) {
		case 'added':
			return 'New program';
		case 'scope_added':
			return asset.inScope ? `Added to scope${asset.bounty ? ' (bounty)' : ''}` : 'Added as out of scope';
		case 'scope_removed':
			return asset.inScope ? 'Removed from scope' : 'Out-of-scope asset removed';
		case 'scope_changed':
			return 'Scope asset changed';
		case 'policy_changed':
			return 'Policy updated';
		case 'details_changed':
			return 'Program details changed';
	}
}

/** Whether a change is good news for hunting (new targets, new bounties). */
export function isOpportunity(e: ProgramEvent): boolean {
	const d = e.detail as ChangedAsset & { changes?: Record<string, FieldChange> } & Record<string, FieldChange>;
	if (e.kind === 'added') return true;
	if (e.kind === 'scope_added') return d.inScope;
	if (e.kind === 'scope_changed') return d.changes?.eligibleForBounty?.after === true || d.changes?.eligibleForSubmission?.after === true;
	if (e.kind === 'details_changed') return d.offersBounties?.after === true || d.submissionState?.after === 'open';
	return false;
}
