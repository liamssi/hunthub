// A line diff (longest common subsequence), for showing what changed in a text
// such as a program's policy. Texts beyond a few thousand lines fall back to
// "everything removed, everything added".

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
	const a = before.split('\n');
	const b = after.split('\n');
	if (a.length * b.length > MAX_CELLS) return [...a.map((text) => ({ kind: 'removed' as const, text })), ...b.map((text) => ({ kind: 'added' as const, text }))];
	// lengths[i][j]: LCS length of a[i..] and b[j..].
	const w = b.length + 1;
	const lengths = new Uint32Array((a.length + 1) * w);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			lengths[i * w + j] = a[i] === b[j] ? lengths[(i + 1) * w + j + 1]! + 1 : Math.max(lengths[(i + 1) * w + j]!, lengths[i * w + j + 1]!);
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			out.push({ kind: 'same', text: a[i]! });
			i++;
			j++;
		} else if (lengths[(i + 1) * w + j]! >= lengths[i * w + j + 1]!) out.push({ kind: 'removed', text: a[i++]! });
		else out.push({ kind: 'added', text: b[j++]! });
	}
	while (i < a.length) out.push({ kind: 'removed', text: a[i++]! });
	while (j < b.length) out.push({ kind: 'added', text: b[j++]! });
	return out;
}

/** Only changed lines with a little context around them; runs of unchanged lines become one gap. */
export function compactDiff(lines: DiffLine[], context = 2): (DiffLine | { kind: 'gap'; count: number })[] {
	const keep = lines.map(() => false);
	lines.forEach((l, k) => {
		if (l.kind === 'same') return;
		for (let c = Math.max(0, k - context); c <= Math.min(lines.length - 1, k + context); c++) keep[c] = true;
	});
	const out: (DiffLine | { kind: 'gap'; count: number })[] = [];
	let gap = 0;
	lines.forEach((l, k) => {
		if (keep[k]) {
			if (gap) out.push({ kind: 'gap', count: gap });
			gap = 0;
			out.push(l);
		} else gap++;
	});
	if (gap) out.push({ kind: 'gap', count: gap });
	return out;
}
