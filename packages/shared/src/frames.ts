// Terminal frames as binary WebSocket messages: a small header and the raw ANSI
// bytes, instead of JSON with base64 (a third bigger, plus parsing). Runner to hub
// messages name the channel; hub to browser messages don't (one socket per terminal).
//
//   byte 0      kind: 1 = frame with channel (runner -> hub), 2 = frame (hub -> browser)
//   byte 1      flags: bit 0 = full repaint
//   bytes 2-5   seq (uint32, big-endian)
//   bytes 6-7   width (uint16)
//   bytes 8-9   height (uint16)
//   kind 1:     byte 10 = channel length n, then n bytes of channel id (ASCII)
//   then        the frame's bytes

export const FRAME_WITH_CHANNEL = 1;
export const FRAME = 2;
const HEADER = 10;

export type FrameHeader = { seq: number; full: boolean; width: number; height: number };

export function encodeFrame(header: FrameHeader, bytes: Uint8Array, channel?: string): Uint8Array<ArrayBuffer> {
	const id = channel === undefined ? null : new TextEncoder().encode(channel);
	if (id && id.length > 255) throw new Error('channel id too long');
	const offset = HEADER + (id ? 1 + id.length : 0);
	const out = new Uint8Array(offset + bytes.length);
	const view = new DataView(out.buffer);
	out[0] = id ? FRAME_WITH_CHANNEL : FRAME;
	out[1] = header.full ? 1 : 0;
	view.setUint32(2, header.seq >>> 0);
	view.setUint16(6, Math.min(header.width, 0xffff));
	view.setUint16(8, Math.min(header.height, 0xffff));
	if (id) {
		out[HEADER] = id.length;
		out.set(id, HEADER + 1);
	}
	out.set(bytes, offset);
	return out;
}

export type DecodedFrame = FrameHeader & { channel: string | null; bytes: Uint8Array };

/** Reads a binary frame; null if the message isn't one. */
export function decodeFrame(data: Uint8Array): DecodedFrame | null {
	if (data.length < HEADER || (data[0] !== FRAME && data[0] !== FRAME_WITH_CHANNEL)) return null;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let offset = HEADER;
	let channel: string | null = null;
	if (data[0] === FRAME_WITH_CHANNEL) {
		const n = data[HEADER] ?? 0;
		if (data.length < HEADER + 1 + n) return null;
		channel = new TextDecoder().decode(data.subarray(HEADER + 1, HEADER + 1 + n));
		offset = HEADER + 1 + n;
	}
	return {
		channel,
		full: (data[1]! & 1) === 1,
		seq: view.getUint32(2),
		width: view.getUint16(6),
		height: view.getUint16(8),
		bytes: data.subarray(offset)
	};
}
