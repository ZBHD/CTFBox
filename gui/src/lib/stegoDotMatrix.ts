import type { StegoVisual } from "./stegoTypes";

export interface DotMatrixText {
  text: string;
  detail: string;
}

interface RowBand {
  start: number;
  end: number;
}

const FONT_5X7 = new Map<string, string>([
  ["...../...../.###./#...#/#..../#...#/.###.", "c"],
  [".#../.#../####/.#../.#../.#../..##", "t"],
  ["..##/.#../###./.#../.#../.#../.#..", "f"],
  ["...../...../.####/#..../.###./....#/####.", "s"],
  ["#..../#..../####./#...#/#...#/#...#/#...#", "h"],
  ["...../...../.###./#...#/#...#/#...#/.###.", "o"],
  ["......./......./#..#..#/#..#..#/#..#..#/#..#..#/.##.##.", "w"],
  ["..##/.#../.#../#.../.#../.#../..##", "{"],
  ["##../..#./..#./...#/..#./..#./##..", "}"],
  [".###./#...#/#..##/#.#.#/##..#/#...#/.###.", "0"],
  ["##/.#/.#/.#/.#/.#/.#", "1"],
  ["####./....#/....#/.###./#..../#..../#####", "2"],
  ["####./....#/....#/.###./....#/....#/####.", "3"],
  ["...#./..##./.#.#./#..#./#####/...#./...#.", "4"],
  ["#####/#..../#..../####./....#/....#/####.", "5"],
  [".###./#..../#..../####./#...#/#...#/.###.", "6"],
  ["#####/....#/...#./...#./..#../..#../.#...", "7"],
  [".###./#...#/#...#/.###./#...#/#...#/.###.", "8"],
  [".###./#...#/#...#/.####/....#/....#/.###.", "9"],
  ["...../...../.###./....#/.####/#...#/.####", "a"],
  ["#..../#..../####./#...#/#...#/#...#/####.", "b"],
  ["....#/....#/.####/#...#/#...#/#...#/.####", "d"],
  ["...../...../.###./#...#/#####/#..../.####", "e"],
]);

const FONT_3X5 = new Map<string, string>([
  [".../###/#../#../###", "c"],
  [".#./###/.#./.#./.##", "t"],
  [".##/.#./###/.#./##.", "f"],
  [".##/#../##./..#/##.", "s"],
  ["#../#../###/#.#/#.#", "h"],
  [".../###/#.#/#.#/###", "o"],
  ["#.../#.#./#.#./#.#./.#.#", "w"],
  ["#.##/#.#./###./#.#./..##", "{"],
  ["##./.#./.##/.#./##.", "}"],
  ["###/#.#/#.#/#.#/###", "0"],
  [".#./##./.#./.#./###", "1"],
  ["###/..#/###/#../###", "2"],
  ["###/..#/###/..#/###", "3"],
  ["#.#/#.#/###/..#/..#", "4"],
  ["###/#../###/..#/###", "5"],
  ["###/#../###/#.#/###", "6"],
  ["###/..#/..#/..#/..#", "7"],
  ["###/#.#/###/#.#/###", "8"],
  ["###/#.#/###/..#/###", "9"],
  [".##./#.#./#.#./####/....", "a"],
  ["#../#../###/#.#/###", "b"],
  ["..#/..#/###/#.#/###", "d"],
]);

function rowBands(active: readonly boolean[]) {
  const bands: RowBand[] = [];
  for (let row = 0; row < active.length;) {
    if (!active[row]) {
      row += 1;
      continue;
    }
    const start = row;
    while (row < active.length && active[row]) row += 1;
    bands.push({ start, end: row });
  }
  return bands;
}

function columnRuns(active: readonly boolean[]) {
  const runs: Array<{ start: number; end: number }> = [];
  for (let column = 0; column < active.length;) {
    if (!active[column]) {
      column += 1;
      continue;
    }
    const start = column;
    while (column < active.length && active[column]) column += 1;
    runs.push({ start, end: column });
  }
  return runs;
}

function visualMask(visual: StegoVisual, inverted: boolean) {
  const mask = new Uint8Array(visual.width * visual.height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const luminance = (visual.pixels[offset] + visual.pixels[offset + 1] + visual.pixels[offset + 2]) / 3;
    mask[index] = (inverted ? luminance > 127 : luminance < 128) ? 1 : 0;
  }
  return mask;
}

function glyphKey(
  valueAt: (x: number, y: number) => boolean,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
) {
  return Array.from({ length: endY - startY }, (_, row) =>
    Array.from({ length: endX - startX }, (_, column) => valueAt(startX + column, startY + row) ? "#" : ".").join(""),
  ).join("/");
}

export function decodeFiveBySevenVisual(visual: StegoVisual): DotMatrixText[] {
  if (visual.width < 4 || visual.height < 7 || visual.pixels.length < visual.width * visual.height * 4) return [];
  const results: DotMatrixText[] = [];
  for (const inverted of [false, true]) {
    const mask = visualMask(visual, inverted);
    const activeRows = Array.from({ length: visual.height }, (_, row) => {
      let count = 0;
      for (let column = 0; column < visual.width; column += 1) count += mask[row * visual.width + column];
      return count >= 2;
    });
    for (const band of rowBands(activeRows).filter((item) => item.end - item.start === 7)) {
      const activeColumns = Array.from({ length: visual.width }, (_, column) => {
        for (let row = band.start; row < band.end; row += 1) {
          if (mask[row * visual.width + column]) return true;
        }
        return false;
      });
      let text = "";
      let unknown = 0;
      for (const run of columnRuns(activeColumns)) {
        const key = glyphKey(
          (x, y) => mask[y * visual.width + x] === 1,
          run.start,
          run.end,
          band.start,
          band.end,
        );
        const character = FONT_5X7.get(key);
        text += character ?? "?";
        if (!character) unknown += 1;
      }
      if (text.length >= 8 && unknown === 0) {
        results.push({
          text,
          detail: `识别 7 行点阵，共 ${text.length} 个字符${inverted ? "（反相）" : ""}`,
        });
      }
    }
  }
  return [...new Map(results.map((result) => [result.text, result])).values()];
}

function markerGrid(
  bytes: Uint8Array,
  marker: readonly [number, number],
  first: number,
  last: number,
  rowBytes: number,
) {
  const start = first - first % rowBytes;
  const end = Math.min(bytes.length, last + marker.length);
  const rows = Math.ceil((end - start) / rowBytes);
  const byteMask = new Uint8Array(rows * rowBytes);
  for (let offset = start; offset + 1 < end; offset += 1) {
    if (bytes[offset] !== marker[0] || bytes[offset + 1] !== marker[1]) continue;
    byteMask[offset - start] = 1;
    byteMask[offset - start + 1] = 1;
  }
  const width = Math.floor(rowBytes / 2);
  const mask = new Uint8Array(rows * width);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const source = row * rowBytes + column * 2;
      mask[row * width + column] = byteMask[source] || byteMask[source + 1] ? 1 : 0;
    }
  }
  return { mask, width, height: rows, start };
}

function trimSlot(
  mask: Uint8Array,
  width: number,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
) {
  let first = endX;
  let last = startX - 1;
  for (let column = startX; column < endX; column += 1) {
    for (let row = startY; row < endY; row += 1) {
      if (!mask[row * width + column]) continue;
      first = Math.min(first, column);
      last = Math.max(last, column);
      break;
    }
  }
  return last < first ? undefined : { first, last: last + 1 };
}

export function decodeMarkerHighlightText(
  bytes: Uint8Array,
  marker: readonly [number, number],
  first: number,
  last: number,
): DotMatrixText[] {
  const results: DotMatrixText[] = [];
  for (const rowBytes of [8, 16, 32]) {
    const grid = markerGrid(bytes, marker, first, last, rowBytes);
    const activeRows = Array.from({ length: grid.height }, (_, row) => {
      for (let column = 0; column < grid.width; column += 1) {
        if (grid.mask[row * grid.width + column]) return true;
      }
      return false;
    });
    const bands = rowBands(activeRows).filter((band) => band.end - band.start === 5);
    if (bands.length < 2) continue;
    for (const pitch of [3, 4, 5, 6]) {
      let text = "";
      let total = 0;
      let recognized = 0;
      for (const band of bands) {
        for (let startX = 0; startX < grid.width; startX += pitch) {
          const endX = Math.min(grid.width, startX + pitch);
          const slot = trimSlot(grid.mask, grid.width, startX, endX, band.start, band.end);
          if (!slot) continue;
          total += 1;
          const key = glyphKey(
            (x, y) => grid.mask[y * grid.width + x] === 1,
            slot.first,
            slot.last,
            band.start,
            band.end,
          );
          const character = FONT_3X5.get(key);
          text += character ?? "?";
          if (character) recognized += 1;
        }
      }
      if (text.length >= 8 && recognized === total && text.includes("{") && text.includes("}")) {
        results.push({
          text,
          detail: `${rowBytes} 字节行宽，绝对偏移对齐至 0x${grid.start.toString(16)}，识别 ${text.length} 个 3x5 点阵字符`,
        });
      }
    }
  }
  return [...new Map(results.map((result) => [result.text, result])).values()];
}
