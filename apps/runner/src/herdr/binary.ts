// Where the herdr program is. Services get a bare PATH (systemd's doesn't
// include ~/.local/bin, where Herdr's installer puts it), so the usual install
// folders are searched too.
import { homedir } from 'node:os';
import { join } from 'node:path';

const EXTRA_DIRS = [join(homedir(), '.local', 'bin'), join(homedir(), 'bin'), join(homedir(), '.cargo', 'bin'), '/usr/local/bin', '/opt/homebrew/bin'];

let found: string | null = null;

/** The herdr program's path, or null when it isn't installed. */
export function herdrBinary(): string | null {
	if (found && Bun.file(found).size > 0) return found;
	const PATH = [process.env.PATH ?? '', ...EXTRA_DIRS].filter(Boolean).join(':');
	found = Bun.which('herdr', { PATH });
	return found;
}
