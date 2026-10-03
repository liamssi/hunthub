// Encrypts credentials HuntHub keeps for users (platform API tokens) with
// AES-256-GCM. The key is derived from BETTER_AUTH_SECRET, so changing that
// secret makes stored tokens unreadable (users then connect again).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
let key: Buffer | null = null;

function keyOf(): Buffer {
	if (key) return key;
	const secret = process.env.BETTER_AUTH_SECRET ?? '';
	if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
	key = Buffer.from(hkdfSync('sha256', secret, 'hunthub', 'hunthub:credentials:v1', 32));
	return key;
}

/** `v1.<iv>.<tag>.<ciphertext>`, base64url. */
export function encryptCredential(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', keyOf(), iv);
	const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

/** The plain credential; null when it can't be read (other key, damaged). */
export function decryptCredential(stored: string): string | null {
	const [version, iv, tag, data] = stored.split('.');
	if (version !== VERSION || !iv || !tag || !data) return null;
	try {
		const decipher = createDecipheriv('aes-256-gcm', keyOf(), Buffer.from(iv, 'base64url'));
		decipher.setAuthTag(Buffer.from(tag, 'base64url'));
		return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
	} catch {
		return null;
	}
}
