// What the console may do on this machine: the hub's setting, never more than
// this machine's own cap (HUNTHUB_CONSOLE_POLICY, e.g. "read"), which the hub
// can't raise.
import { type ConsolePolicy, parsePolicy, stricterPolicy } from '@hunthub/shared/console';

const localCap: ConsolePolicy = parsePolicy(process.env.HUNTHUB_CONSOLE_POLICY) ?? 'full';
let current: ConsolePolicy = localCap;

export function setHubPolicy(policy: ConsolePolicy): ConsolePolicy {
	current = stricterPolicy(policy, localCap);
	return current;
}

export const consolePolicy = () => current;
