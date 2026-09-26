// HuntHub: only the FrameData types and readers are kept from Roamgate's
// thin-client.ts (the legacy thin-client connection itself is not used).
import type { BinReader } from "./bincode";

export interface CellData {
  symbol: string;
  fg: number;
  bg: number;
  modifier: number;
  skip: boolean;
  hyperlink: number | null;
}

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  shape: number;
}

export interface FrameData {
  cells: CellData[];
  width: number;
  height: number;
  cursor: CursorState | null;
  hyperlinks: string[];
}

// Exported for the stable endpoint client (PaneSurface frames share the wire
// FrameData layout).
export function readCellData(r: BinReader): CellData {
  return {
    symbol: r.string(),
    fg: r.varint(),
    bg: r.varint(),
    modifier: r.varint(),
    skip: r.bool(),
    hyperlink: r.option(() => r.varint()),
  };
}

export function readFrameData(r: BinReader): FrameData {
  const cellCount = r.varint();
  const cells: CellData[] = new Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    cells[i] = readCellData(r);
  }
  const width = r.varint();
  const height = r.varint();
  const cursor = r.option(
    (): CursorState => ({
      x: r.varint(),
      y: r.varint(),
      visible: r.bool(),
      shape: r.u8(),
    }),
  );
  const linkCount = r.varint();
  const hyperlinks: string[] = new Array(linkCount);
  for (let i = 0; i < linkCount; i++) hyperlinks[i] = r.string();
  r.bytes(); // graphics (ignored)
  return { cells, width, height, cursor, hyperlinks };
}
