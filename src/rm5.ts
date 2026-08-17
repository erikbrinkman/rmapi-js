/**
 * Parse and render the flat (version 3 and 5) reMarkable `.rm` page format.
 *
 * A `.rm` file is the vector drawing for a single notebook page. The version 3
 * and 5 formats are a flat, little-endian struct of layers, each holding strokes
 * ("lines"), each holding sampled points (they differ only by one extra
 * per-stroke field in version 5). {@link parseV5 | `parseV5`} reads them into an
 * {@link RmPageV5 | `RmPageV5`} and {@link serializeRm | `serializeRm`} renders
 * it back to byte-exact bytes.
 *
 * The newer version 6 "scene tree" format lives in `./rm6.js`; the version
 * dispatch that picks between them (`parseRm`) lives in `./raw.js`.
 *
 * @packageDocumentation
 */

import {
  type RmBrushCode,
  type RmColorCode,
  rmBrushCode,
  rmColorCode,
} from "./codes.js";
/** the flat reMarkable `.lines` file versions read into an {@link RmPageV5} */
export type RmVersion = 3 | 5;

/** a single sampled point along a stroke */
export interface RmPoint {
  /** the horizontal position in device pixels (see the page type for the origin) */
  x: number;
  /** the vertical position in device pixels (see the page type for the origin) */
  y: number;
  /** the pen speed at this point */
  speed: number;
  /** the pen tilt/heading in radians */
  direction: number;
  /** the stroke width at this point */
  width: number;
  /** the pen pressure, from 0 to 1 */
  pressure: number;
}

/** a single stroke (called a "line") within a layer */
export interface RmLine {
  /** the pen code, named by {@link rmBrushes | `rmBrushes`} */
  brushType: RmBrushCode;
  /** the color code, named by {@link rmColors | `rmColors`} */
  color: RmColorCode;
  /** a per-stroke padding field, typically 0 */
  padding?: number;
  /** the base brush size */
  brushBaseSize: number;
  /** [unknown] a per-stroke field only present in version 5 */
  unknown?: number;
  /** the sampled points making up the stroke, in order */
  points: RmPoint[];
}

/** a drawing layer, an ordered set of strokes */
export interface RmLayer {
  /** the strokes on this layer, in order */
  lines: RmLine[];
}

/**
 * a parsed version 3 or 5 page
 *
 * Coordinates use a top-left origin: `x` in `[0, width]`, `y` in `[0, height]`,
 * in device pixels.
 */
export interface RmPageV5 {
  /** the file format version */
  version: 3 | 5;
  /** the drawing layers, back to front */
  layers: RmLayer[];
}

/** the length of the fixed `.lines` header, in bytes */
export const HEADER_LENGTH = 43;
/** the ascii prefix of the header, immediately followed by the version digit */
export const VERSION_PREFIX = "reMarkable .lines file, version=";

/**
 * parse a version 3 or 5 (flat struct) `.rm` page
 *
 * Named for version 5, the common case, but the two formats differ only by the
 * extra {@link RmLine.unknown | `unknown`} field version 5 adds per stroke.
 */
export function parseV5(data: Uint8Array, version: 3 | 5): RmPageV5 {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = HEADER_LENGTH;
  const readInt = (): number => {
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  };
  const readFloat = (): number => {
    const value = view.getFloat32(offset, true);
    offset += 4;
    return value;
  };

  const numLayers = readInt();
  const layers: RmLayer[] = [];
  for (let layer = 0; layer < numLayers; layer++) {
    const numLines = readInt();
    const lines: RmLine[] = [];
    for (let line = 0; line < numLines; line++) {
      const brushType = rmBrushCode.parse(readInt());
      const color = rmColorCode.parse(readInt());
      const padding = readInt();
      const brushBaseSize = readFloat();
      const unknown = version === 5 ? readInt() : undefined;
      const numPoints = readInt();
      const points: RmPoint[] = new Array(numPoints);
      for (let point = 0; point < numPoints; point++) {
        points[point] = {
          x: readFloat(),
          y: readFloat(),
          speed: readFloat(),
          direction: readFloat(),
          width: readFloat(),
          pressure: readFloat(),
        };
      }
      const parsed: RmLine = {
        brushType,
        color,
        padding,
        brushBaseSize,
        points,
      };
      if (unknown !== undefined) {
        parsed.unknown = unknown;
      }
      lines.push(parsed);
    }
    layers.push({ lines });
  }
  return { version, layers };
}

/**
 * render a page back into reMarkable `.rm` file bytes
 *
 * The inverse of {@link parseV5 | `parseV5`}: `serializeRm(parseV5(bytes, v))`
 * reproduces the original bytes for version 3 and 5 files. A missing `padding`
 * or (version 5) `unknown` field is written as `0`.
 *
 * @param page - the page to render
 * @returns the `.rm` file bytes
 */
export function serializeRm(page: RmPageV5): Uint8Array {
  const { version } = page;
  // runtime backstop for untyped (JS) callers passing a v6 page
  if ((version as number) !== 3 && (version as number) !== 5) {
    throw new Error(
      `rendering version ${version} .lines files is not supported (only 3 and 5)`,
    );
  }
  const strokeHeaderSize = version === 5 ? 24 : 20;
  let size = HEADER_LENGTH + 4;
  for (const layer of page.layers) {
    size += 4;
    for (const line of layer.lines) {
      size += strokeHeaderSize + line.points.length * 24;
    }
  }

  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  const header = `${VERSION_PREFIX}${version}`.padEnd(HEADER_LENGTH, " ");
  for (let index = 0; index < HEADER_LENGTH; index++) {
    bytes[index] = header.charCodeAt(index);
  }
  let offset = HEADER_LENGTH;
  const writeInt = (value: number): void => {
    view.setInt32(offset, value, true);
    offset += 4;
  };
  const writeFloat = (value: number): void => {
    view.setFloat32(offset, value, true);
    offset += 4;
  };

  writeInt(page.layers.length);
  for (const layer of page.layers) {
    writeInt(layer.lines.length);
    for (const line of layer.lines) {
      writeInt(line.brushType);
      writeInt(line.color);
      writeInt(line.padding ?? 0);
      writeFloat(line.brushBaseSize);
      if (version === 5) {
        writeInt(line.unknown ?? 0);
      }
      writeInt(line.points.length);
      for (const point of line.points) {
        writeFloat(point.x);
        writeFloat(point.y);
        writeFloat(point.speed);
        writeFloat(point.direction);
        writeFloat(point.width);
        writeFloat(point.pressure);
      }
    }
  }
  return bytes;
}
