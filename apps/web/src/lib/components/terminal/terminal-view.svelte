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

	let {
		machineId,
		session,
		view = 'pane',
		target = '',
		mode,
		transport,
		takeover = false,
		state = $bindable<TerminalState>({ phase: 'connecting' }),
		onstatechange
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

	function fromBase64(b64: string): Uint8Array {
		const s = atob(b64);
		const out = new Uint8Array(s.length);
		for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
		return out;
	}

	// One connection per set of connection parameters. Everything else (callbacks,
	// this terminal's own state) is read untracked, so updates never reconnect.
	$effect(() => {
		const params = { machineId, session, view, target, mode, transport, takeover };
		return untrack(() => connect(params));
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
		setState({ phase: 'connecting' });

		void (async () => {
			const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
			if (disposed) return;
			term = new Terminal({
				cursorBlink: mode === 'control',
				disableStdin: mode !== 'control',
				fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
				fontSize: 13,
				scrollback: 0,
				theme: { background: '#0b0b0c', foreground: '#e4e4e7', cursor: '#e4e4e7' }
			});
			const fit = new FitAddon();
			term.loadAddon(fit);
			term.open(container);
			fit.fit();

			const send = (msg: object) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
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
				let msg: { type?: string; bytes?: string; reason?: string };
				try {
					msg = JSON.parse(String(event.data));
				} catch {
					return;
				}
				if (msg.type === 'frame' && msg.bytes) {
					if (state.phase !== 'live') setState({ phase: 'live' });
					term?.write(fromBase64(msg.bytes));
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
				const encoder = new TextEncoder();
				const sendInput = (bytes: Uint8Array) => {
					for (let i = 0; i < bytes.length; i += INPUT_CHUNK) send({ type: 'input', bytes: toBase64(bytes.subarray(i, i + INPUT_CHUNK)) });
				};
				term.onData((data) => sendInput(encoder.encode(data)));
				term.onBinary((data) => sendInput(Uint8Array.from(data, (c) => c.charCodeAt(0) & 0xff)));
				// The pane keeps its own scrollback; the wheel scrolls it on the machine.
				// Herdr's own UI takes the wheel as mouse input instead.
				if (view === 'pane') {
					term.attachCustomWheelEventHandler((e) => {
						if (e.deltaY) send({ type: 'scroll', direction: e.deltaY < 0 ? 'up' : 'down', lines: 3 });
						return false;
					});
				}
				term.focus();
			}

			observer = new ResizeObserver(() => {
				clearTimeout(resizeTimer);
				resizeTimer = setTimeout(() => {
					if (!term) return;
					const { cols, rows } = term;
					fit.fit();
					if (term.cols !== cols || term.rows !== rows) send({ type: 'resize', cols: Math.max(term.cols, 10), rows: Math.max(term.rows, 4) });
				}, 100);
			});
			observer.observe(container);
		})();

		return () => {
			disposed = true;
			clearTimeout(resizeTimer);
			observer?.disconnect();
			ws?.close();
			term?.dispose();
		};
	}
</script>

<div bind:this={container} data-phase={state.phase} class="size-full overflow-hidden rounded-md bg-[#0b0b0c] p-1"></div>
