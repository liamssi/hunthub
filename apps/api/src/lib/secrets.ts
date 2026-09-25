import { createHash, randomBytes } from 'node:crypto';

/** A random secret with a recognisable prefix, e.g. `hh_mc_...`. */
export function generateSecret(prefix: string): string {
	return prefix + randomBytes(32).toString('base64url');
}

/** Secrets are stored and looked up by their SHA-256 hash only. */
export function hashSecret(secret: string): string {
	return createHash('sha256').update(secret).digest('hex');
}
