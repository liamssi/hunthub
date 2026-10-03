// WebSocket messages are compressed (permessage-deflate, when the other side
// supports it) once they're big enough for it to pay off; tiny ones (a key
// press, a heartbeat) go as they are.
export const COMPRESS_FROM_BYTES = 256;

export const compressOptions = (size: number) => ({ compress: size >= COMPRESS_FROM_BYTES });
