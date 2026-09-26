<script lang="ts" module>
	export type TerminalMode = 'observe' | 'control';
	export type TerminalTransport = 'cli' | 'native';
	export type TerminalViewKind = 'pane' | 'session';
	export type TerminalState = { phase: 'connecting' | 'live' | 'closed'; reason?: string };
</script>

<script lang="ts">
	// One live pane, or a whole session (Herdr's own UI), streamed through the
	// hub from the machine's runner. Frames are ANSI written to xterm.js as they arrive.
	import '@xterm/xterm/css/xterm.css';
	import type { Terminal } from '@xterm/xterm';
	import { untrack } from 'svelte';
	import { appearance, fontFamily, loadAppearance, themeColors } from '$lib/terminal-appearance.svelte';
	import { copyText, openWebLink } from '$lib/clipboard';

	let {
		machineId,
		session,
		view = 'pane',
		target = '',
		mode,
		transport,
		takeover = false,
		state = $bindable<TerminalState>({ phase: 'connecting' }),
		onstatechange,
		onscrollup,
		oncolschange
	}: {
		machineId: string;
		session: string;
		view?: TerminalViewKind;
		target?: string;
		mode: TerminalMode;
		transport: TerminalTransport;
		takeover?: boolean;
		state?: TerminalState;
		/** For parents that track many terminals (binding would need a slot per terminal up front). */
		onstatechange?: (state: TerminalState) => void;
		/** Scrolling up while only watching (which can't scroll the pane) calls it, e.g. to show history. */
		onscrollup?: () => void;
		/** The terminal's width in columns (what the pane's lines are drawn at). */
		oncolschange?: (cols: number) => void;
	} = $props();

	function setState(next: TerminalState) {
		state = next;
		onstatechange?.(next);
	}

	let container: HTMLDivElement;

	/** Largest input chunk sent in one message (the hub accepts 64 KiB of base64). */
	const INPUT_CHUNK = 32 * 1024;

	function toBase64(bytes: Uint8Array): string {
		let s = '';
		for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		return btoa(s);
	}

	/**
	 * Herdr paints "default background" cells with the background some other
	 * terminal reported to it (the host theme), so they would ignore our theme.
	 * The first full frame tells us that color: it is the background almost
	 * every cell uses. From then on it is written as the default background.
	 */
	function learnHostBackground(text: string): string | null {
		const counts = new Map<string, number>();
		let total = 0;
		for (const m of text.matchAll(/\x1b\[([0-9;]*)m/g)) {
			for (const bg of m[1]!.matchAll(/(?:^|;)48;2;(\d+;\d+;\d+)/g)) {
				counts.set(bg[1]!, (counts.get(bg[1]!) ?? 0) + 1);
				total++;
			}
		}
		const [color, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
		return color && n >= 3 && n / total >= 0.6 ? color : null;
	}

	function fromBase64(b64: string): Uint8Array {
		const s = atob(b64);
		const out = new Uint8Array(s.length);
		for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
		return out;
	}

	/** The live terminal, for appearance changes; set while connected. */
	let live: { term: Terminal; refit: () => void } | null = null;

	/** Resizes settle this long before the terminal follows (a dragged edge sends one resize). */
	const RESIZE_DEBOUNCE_MS = 150;
	/** How long to wait for the full redraw a resize brings before accepting partial updates again. */
	const FULL_FRAME_WAIT_MS = 2000;
	/** Clears the screen and homes the cursor: a full redraw after a resize starts clean. */
	const CLEAR_SCREEN = new TextEncoder().encode('\x1b[H\x1b[2J');


	/** Waits for the chosen font, so xterm measures its cells with the real glyphs. */
	async function fontReady() {
		try {
			await document.fonts.load(`${appearance.size}px ${fontFamily(appearance.font)}`);
		} catch {
			// Falls back to whatever is available.
		}
	}

	// Font, size and theme apply live to an open terminal; the pane size follows.
	$effect(() => {
		const font = fontFamily(appearance.font);
		const size = appearance.size;
		const colors = themeColors(appearance.theme);
		void fontReady().then(() => {
			if (!live) return;
			live.term.options.fontFamily = font;
			live.term.options.fontSize = size;
			live.term.options.theme = colors;
			// Rows already drawn keep their old colors until repainted.
			live.term.refresh(0, live.term.rows - 1);
			live.refit();
		});
	});

	// One connection per set of connection parameters. Everything else (callbacks,
	// this terminal's own state) is read untracked, so updates never reconnect.
	// Props are read through the parent's state, so an unrelated update there (a new session
	// snapshot) would re-run a plain effect; this derived only changes when a parameter does.
	const connectionKey = $derived(JSON.stringify([machineId, session, view, target, mode, transport]));
	$effect(() => {
		void connectionKey;
		// Taking over only matters when a connection starts; clearing it afterwards must not reconnect.
		return untrack(() => connect({ machineId, session, view, target, mode, transport, takeover }));
	});

	function connect({
		machineId,
		session,
		view,
		target,
		mode,
		transport,
		takeover
	}: {
		machineId: string;
		session: string;
		view: TerminalViewKind;
		target: string;
		mode: TerminalMode;
		transport: TerminalTransport;
		takeover: boolean;
	}) {
		let disposed = false;
		let term: Terminal | null = null;
		let ws: WebSocket | null = null;
		let observer: ResizeObserver | null = null;
		let resizeTimer: ReturnType<typeof setTimeout> | undefined;
		// After a resize, partial updates computed for the old size are dropped and the
		// full redraw that follows (Herdr sends one) starts from a cleared screen, so text
		// the terminal rewrapped for the new size can't linger.
		let awaitingFull = false;
		let awaitTimer: ReturnType<typeof setTimeout> | undefined;
		const expectFullFrame = () => {
			// Watching over the CLI doesn't pass resizes on, so no full frame would follow.
			if (view !== 'pane' || (transport === 'cli' && mode !== 'control')) return;
			awaitingFull = true;
			clearTimeout(awaitTimer);
			awaitTimer = setTimeout(() => (awaitingFull = false), FULL_FRAME_WAIT_MS);
		};
		setState({ phase: 'connecting' });

		void (async () => {
			loadAppearance();
			const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
				import('@xterm/xterm'),
				import('@xterm/addon-fit'),
				import('@xterm/addon-web-links'),
				fontReady()
			]);
			if (disposed) return;
			term = new Terminal({
				cursorBlink: mode === 'control',
				disableStdin: mode !== 'control',
				fontFamily: fontFamily(appearance.font),
				fontSize: appearance.size,
				lineHeight: 1.1,
				scrollback: 0,
				theme: themeColors(appearance.theme),
				// Hyperlinks programs emit (OSC 8); only web links open.
				linkHandler: { activate: (_event, uri) => openWebLink(uri), allowNonHttpProtocols: false }
			});
			const fit = new FitAddon();
			term.loadAddon(fit);
			// Plain URLs in the output become clickable.
			term.loadAddon(new WebLinksAddon((_event, uri) => openWebLink(uri)));
			// Copy and paste like other web terminals: Ctrl+C copies when text is selected
			// (and still interrupts when not), Ctrl+Shift+C copies, Ctrl+V / Ctrl+Shift+V paste.
			const t = term;
			t.attachCustomKeyEventHandler((e) => {
				if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey) || e.altKey) return true;
				const key = e.key.toLowerCase();
				if (key === 'c' && (e.shiftKey || t.hasSelection())) {
					if (t.hasSelection()) {
						void copyText(t.getSelection());
						if (!e.shiftKey) t.clearSelection();
					}
					e.preventDefault();
					return false;
				}
				// Leave the key to the browser, whose paste event the terminal handles.
				if (key === 'v') return false;
				return true;
			});
			term.open(container);
			fit.fit();
			untrack(() => oncolschange)?.(term.cols);

			const send = (msg: object) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
			const decoder = new TextDecoder();
			const encoder = new TextEncoder();
			let hostBackground: string | null | undefined;
			let hostPattern: RegExp | null = null;
			const params = new URLSearchParams({
				session,
				view,
				...(view === 'pane' && { target }),
				mode,
				transport,
				// Tiny containers still get a usable size (the hub's minimum is 10x4).
				cols: String(Math.max(term.cols, 10)),
				rows: String(Math.max(term.rows, 4)),
				takeover: takeover ? '1' : '0'
			});
			const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
			ws = new WebSocket(`${proto}//${location.host}/api/machines/${machineId}/terminal?${params}`);

			ws.onmessage = (event) => {
				let msg: { type?: string; bytes?: string; reason?: string; full?: boolean };
				try {
					msg = JSON.parse(String(event.data));
				} catch {
					return;
				}
				if (msg.type === 'frame' && msg.bytes) {
					if (state.phase !== 'live') setState({ phase: 'live' });
					let clear = false;
					if (awaitingFull) {
						if (!msg.full) return; // Drawn for the old size; the full redraw is on its way.
						awaitingFull = false;
						clearTimeout(awaitTimer);
						clear = true;
					}
					let bytes = fromBase64(msg.bytes);
					if (hostBackground === undefined && (msg as { full?: boolean }).full) {
						hostBackground = learnHostBackground(new TextDecoder().decode(bytes));
						if (hostBackground) hostPattern = new RegExp(`(\\x1b\\[(?:[0-9;]*;)?)48;2;${hostBackground}(?=[;m])`, 'g');
					}
					// Streaming decode keeps a character split across two frames intact.
					if (hostPattern) bytes = encoder.encode(decoder.decode(bytes, { stream: true }).replace(hostPattern, (_, prefix: string) => `${prefix}49`));
					if (clear) {
						const joined = new Uint8Array(CLEAR_SCREEN.length + bytes.length);
						joined.set(CLEAR_SCREEN);
						joined.set(bytes, CLEAR_SCREEN.length);
						bytes = joined;
					}
					term?.write(bytes);
				} else if (msg.type === 'closed') {
					setState({ phase: 'closed', reason: msg.reason });
				}
			};
			ws.onclose = (event) => {
				if (disposed || state.phase === 'closed') return;
				setState({
					phase: 'closed',
					reason: event.code === 1006 ? "Couldn't connect to the terminal (the machine may not support it)." : event.reason || 'Disconnected.'
				});
			};

			if (mode === 'control') {
				const sendInput = (bytes: Uint8Array) => {
					for (let i = 0; i < bytes.length; i += INPUT_CHUNK) send({ type: 'input', bytes: toBase64(bytes.subarray(i, i + INPUT_CHUNK)) });
				};
				term.onData((data) => sendInput(encoder.encode(data)));
				term.onBinary((data) => sendInput(Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff)));
				term.focus();
			}
			// The wheel scrolls the pane in Herdr itself, as Herdr's own UI does: its full
			// scrollback, always current (programs that take the mouse get the wheel instead).
			// Watching can't scroll Herdr, so there scrolling up opens the history HuntHub keeps.
			if (view === 'pane') {
				let pending = 0; // Wheel distance not yet sent, in lines.
				term.attachCustomWheelEventHandler((e) => {
					const delta = e.deltaY || e.deltaX;
					if (mode !== 'control') {
						if (delta < 0) onscrollup?.();
						return false;
					}
					// Pixels (trackpads) become lines by the row height; line and page modes count as given.
					const rowHeight = (container.querySelector('.xterm-screen')?.clientHeight ?? 0) / t.rows || 16;
					pending += e.deltaMode === 1 ? delta : e.deltaMode === 2 ? delta * t.rows : delta / rowHeight;
					const lines = Math.trunc(pending);
					if (lines) {
						pending -= lines;
						send({ type: 'scroll', direction: lines < 0 ? 'up' : 'down', lines: Math.min(Math.abs(lines), 500) });
					}
					return false;
				});
			}

			const size = () => ({ cols: Math.max(term!.cols, 10), rows: Math.max(term!.rows, 4) });
			const refit = () => {
				if (!term) return;
				const { cols, rows } = term;
				fit.fit();
				if (term.cols !== cols) untrack(() => oncolschange)?.(term.cols);
				if (term.cols !== cols || term.rows !== rows) {
					expectFullFrame();
					send({ type: 'resize', ...size() });
				} else {
					// Same cell grid (e.g. a few pixels): just repaint what's there.
					term.refresh(0, term.rows - 1);
				}
			};
			live = { term, refit };
			observer = new ResizeObserver(() => {
				clearTimeout(resizeTimer);
				resizeTimer = setTimeout(refit, RESIZE_DEBOUNCE_MS);
			});
			observer.observe(container);
		})();

		return () => {
			disposed = true;
			live = null;
			clearTimeout(resizeTimer);
			clearTimeout(awaitTimer);
			observer?.disconnect();
			ws?.close();
			term?.dispose();
		};
	}
</script>

<div
	bind:this={container}
	data-phase={state.phase}
	class="size-full overflow-hidden ps-1.5 pt-1 pb-2.5"
	style:background-color={themeColors(appearance.theme).background}
></div>
