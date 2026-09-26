/**
 * Copies text. The Clipboard API only exists on secure origins (https,
 * localhost); over plain http (e.g. a tailnet address) this falls back to
 * the older copy command, which works from a user action.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// Fall through to the fallback.
	}
	const area = document.createElement('textarea');
	area.value = text;
	area.setAttribute('readonly', '');
	area.style.position = 'fixed';
	area.style.opacity = '0';
	document.body.appendChild(area);
	const active = document.activeElement as HTMLElement | null;
	area.select();
	let ok = false;
	try {
		ok = document.execCommand('copy');
	} catch {
		ok = false;
	}
	area.remove();
	active?.focus();
	return ok;
}

/** Only web links are opened from terminals; anything else (file:, javascript:) is ignored. */
export function openWebLink(uri: string) {
	try {
		const url = new URL(uri);
		if (url.protocol === 'http:' || url.protocol === 'https:') window.open(url.href, '_blank', 'noopener,noreferrer');
	} catch {
		// Not a URL.
	}
}
