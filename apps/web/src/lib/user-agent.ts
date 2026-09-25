/** Turns a user-agent string into a short label like "Firefox on Linux". */
export function describeUserAgent(ua: string | null | undefined): string {
	if (!ua) return 'Unknown device';
	const browser =
		[
			['Edge', /Edg\//],
			['Firefox', /Firefox\//],
			['Chrome', /Chrome\//],
			['Safari', /Safari\//],
			['curl', /^curl\//]
		] as const;
	const os =
		[
			['Windows', /Windows/],
			['Android', /Android/],
			['iOS', /iPhone|iPad/],
			['macOS', /Mac OS X/],
			['Linux', /Linux/]
		] as const;
	const b = browser.find(([, re]) => re.test(ua))?.[0] ?? 'Unknown browser';
	const o = os.find(([, re]) => re.test(ua))?.[0];
	return o ? `${b} on ${o}` : b;
}
