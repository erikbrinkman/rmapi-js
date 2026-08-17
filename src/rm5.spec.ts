import { describe, expect, test } from "bun:test";
import { rmBrushCode, rmBrushes, rmColorCode, rmColors } from "./codes.js";
import { parseRm, type RmPage } from "./raw.js";
import { type RmPageV5, serializeRm } from "./rm5.js";
import { type RmScene, serializeRmScene } from "./rm6.js";

/** narrow a parsed page to a version 3/5 page, or fail the test */
function asV5(page: RmPage): RmPageV5 {
  if (page.version === 6) {
    throw new Error("expected a version 3/5 page");
  } else {
    return page;
  }
}

/** narrow a parsed page to a version 6 scene, or fail the test */
function asScene(page: RmPage): RmScene {
  if (page.version === 6) {
    return page;
  } else {
    throw new Error("expected a version 6 page");
  }
}

/** a tiny little-endian writer for building synthetic `.rm` files */
class Writer {
  #bytes: number[] = [];

  int(value: number): this {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, value, true);
    this.#bytes.push(...new Uint8Array(buffer));
    return this;
  }

  float(value: number): this {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setFloat32(0, value, true);
    this.#bytes.push(...new Uint8Array(buffer));
    return this;
  }

  ascii(text: string): this {
    for (const char of text) {
      this.#bytes.push(char.charCodeAt(0));
    }
    return this;
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.#bytes);
  }
}

/** the 43-byte header for a given version digit */
function header(version: number): string {
  return `reMarkable .lines file, version=${version}`.padEnd(43, " ");
}

/** little-endian byte-array builders for synthetic v6 files */
function varuintBytes(value: number): number[] {
  const out: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    out.push(byte);
  } while (remaining > 0);
  return out;
}
function packed(setter: (view: DataView) => void, size: number): number[] {
  const buffer = new ArrayBuffer(size);
  setter(new DataView(buffer));
  return [...new Uint8Array(buffer)];
}
const u16le = (v: number) => packed((view) => view.setUint16(0, v, true), 2);
const u32le = (v: number) => packed((view) => view.setUint32(0, v, true), 4);
const f32le = (v: number) => packed((view) => view.setFloat32(0, v, true), 4);
const f64le = (v: number) => packed((view) => view.setFloat64(0, v, true), 8);
const tag = (index: number, type: number) => varuintBytes(index * 16 + type);
const crdt = (authorId: number, counter: number) => [
  authorId,
  ...varuintBytes(counter),
];
const asciiBytes = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** wrap a block body in the 8-byte v6 block header */
function block(type: number, currentVersion: number, body: number[]): number[] {
  return [...u32le(body.length), 0, 0, currentVersion, type, ...body];
}

describe("parseRm()", () => {
  test("parses a version 5 page", () => {
    const data = new Writer()
      .ascii(header(5))
      .int(1) // num layers
      .int(1) // num lines
      .int(2) // brush type
      .int(0) // color
      .int(0) // padding
      .float(2.5) // brush base size
      .int(99) // unknown (v5 only)
      .int(2) // num points
      .float(1)
      .float(2)
      .float(3)
      .float(4)
      .float(5)
      .float(0.5)
      .float(6)
      .float(7)
      .float(8)
      .float(9)
      .float(10)
      .float(1)
      .bytes();

    const page = asV5(parseRm(data));
    expect(page.version).toBe(5);
    expect(page.layers).toHaveLength(1);
    const line = page.layers[0]!.lines[0]!;
    expect(line.brushType).toBe(2);
    expect(line.brushBaseSize).toBe(2.5);
    expect(line.unknown).toBe(99);
    expect(line.points).toHaveLength(2);
    expect(line.points[0]).toEqual({
      x: 1,
      y: 2,
      speed: 3,
      direction: 4,
      width: 5,
      pressure: 0.5,
    });
    // rendering the parsed page reproduces the original bytes exactly
    expect(serializeRm(page)).toEqual(data);
  });

  test("parses a version 3 page without the extra attribute", () => {
    const data = new Writer()
      .ascii(header(3))
      .int(1) // num layers
      .int(1) // num lines
      .int(4) // brush type
      .int(1) // color
      .int(0) // padding
      .float(1.5) // brush base size
      .int(1) // num points (no unknown field in v3)
      .float(11)
      .float(12)
      .float(13)
      .float(14)
      .float(15)
      .float(0.25)
      .bytes();

    const page = asV5(parseRm(data));
    expect(page.version).toBe(3);
    const line = page.layers[0]!.lines[0]!;
    expect(line.brushType).toBe(4);
    expect(line.unknown).toBeUndefined();
    expect(line.points).toHaveLength(1);
    expect(serializeRm(page)).toEqual(data);
  });

  test("serializeRm renders a constructed page that parses back", () => {
    const page: RmPageV5 = {
      version: 5,
      layers: [
        {
          lines: [
            {
              brushType: 17,
              color: 0,
              padding: 0,
              brushBaseSize: 2,
              unknown: 0,
              points: [
                {
                  x: 100,
                  y: 200,
                  speed: 1,
                  direction: 0.5,
                  width: 4,
                  pressure: 0.5,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(parseRm(serializeRm(page))).toEqual(page);
  });

  test("parses an empty page", () => {
    const data = new Writer().ascii(header(5)).int(0).bytes();
    const page = asV5(parseRm(data));
    expect(page.layers).toEqual([]);
  });

  test("parses a version 6 page with a stroke", () => {
    // one v2 point (14 bytes): x, y, speed u16, width u16, direction u8, pressure u8
    const point = [
      ...f32le(100),
      ...f32le(200),
      ...u16le(40), // speed
      ...u16le(16), // width
      128, // direction (0-255)
      204, // pressure (0-255)
    ];
    const lineValue = [
      ...tag(1, 0x4),
      ...u32le(17), // tool
      ...tag(2, 0x4),
      ...u32le(0), // color
      ...tag(3, 0x8),
      ...f64le(2), // thickness
      ...tag(4, 0x4),
      ...f32le(0), // starting length
      ...tag(5, 0xc),
      ...u32le(point.length),
      ...point, // points subblock
    ];
    const lineItem = [0x03, ...lineValue]; // item type = line
    const lineEnvelope = [
      ...tag(1, 0xf),
      ...crdt(1, 5), // parent id (the layer group)
      ...tag(2, 0xf),
      ...crdt(2, 10), // item id
      ...tag(3, 0xf),
      ...crdt(0, 0), // left
      ...tag(4, 0xf),
      ...crdt(0, 0), // right
      ...tag(5, 0x4),
      ...u32le(0), // deleted length
      ...tag(6, 0xc),
      ...u32le(lineItem.length),
      ...lineItem,
    ];
    // a group item placing layer (1,5) under the root (0,1)
    const groupItem = [0x02, ...tag(2, 0xf), ...crdt(1, 5)];
    const groupEnvelope = [
      ...tag(1, 0xf),
      ...crdt(0, 1), // parent id (root)
      ...tag(2, 0xf),
      ...crdt(1, 7), // item id
      ...tag(3, 0xf),
      ...crdt(0, 0), // left
      ...tag(4, 0xf),
      ...crdt(0, 0), // right
      ...tag(5, 0x4),
      ...u32le(0), // deleted length
      ...tag(6, 0xc),
      ...u32le(groupItem.length),
      ...groupItem,
    ];
    const data = new Uint8Array([
      ...asciiBytes(header(6)),
      ...block(0x04, 1, groupEnvelope), // scene group item
      ...block(0x05, 2, lineEnvelope), // scene line item (v2 points)
    ]);

    const scene = asScene(parseRm(data));
    expect(scene.version).toBe(6);
    expect(scene.layers()).toHaveLength(1);
    const strokes = scene.strokes();
    expect(strokes).toHaveLength(1);
    const line = strokes[0]!;
    expect(line.tool).toBe(17);
    expect(line.color).toBe(0);
    expect(line.thicknessScale).toBe(2);
    expect(line.startingLength).toBe(0);
    expect(line.points).toHaveLength(1);
    expect(line.points[0]).toEqual({
      x: 100,
      y: 200,
      speed: 40,
      width: 16,
      direction: 128,
      pressure: 204,
    });
  });

  test("rejects a version 5 stroke with an unknown pen code", () => {
    const data = new Writer()
      .ascii(header(5))
      .int(1) // num layers
      .int(1) // num lines
      .int(99) // brush type, not a pen we know
      .int(0) // color
      .int(0) // padding
      .float(1)
      .int(0)
      .int(0) // num points
      .bytes();
    expect(() => parseRm(data)).toThrow("unknown pen code");
  });

  test("keeps a version 6 stroke with an unknown color as raw bytes", () => {
    const lineValue = [
      ...tag(1, 0x4),
      ...u32le(17), // tool
      ...tag(2, 0x4),
      ...u32le(99), // color, not one we know
      ...tag(3, 0x8),
      ...f64le(2),
      ...tag(4, 0x4),
      ...f32le(0),
      ...tag(5, 0xc),
      ...u32le(0), // no points
    ];
    const lineItem = [0x03, ...lineValue];
    const lineEnvelope = [
      ...tag(1, 0xf),
      ...crdt(1, 5),
      ...tag(2, 0xf),
      ...crdt(2, 10),
      ...tag(3, 0xf),
      ...crdt(0, 0),
      ...tag(4, 0xf),
      ...crdt(0, 0),
      ...tag(5, 0x4),
      ...u32le(0),
      ...tag(6, 0xc),
      ...u32le(lineItem.length),
      ...lineItem,
    ];
    const data = new Uint8Array([
      ...asciiBytes(header(6)),
      ...block(0x05, 2, lineEnvelope),
    ]);

    const scene = asScene(parseRm(data));
    expect(scene.strokes()).toEqual([]);
    expect(scene.blocks[0]!.type).toBe("unknown");
    expect(serializeRmScene(scene)).toEqual(data);
  });

  test("parses a version 6 file with no blocks as an empty scene", () => {
    const data = new Uint8Array(asciiBytes(header(6)));
    const scene = asScene(parseRm(data));
    expect(scene.blocks).toEqual([]);
    expect(scene.layers()).toEqual([]);
    expect(scene.strokes()).toEqual([]);
  });

  test("serializeRm rejects version 6 at runtime", () => {
    // typescript blocks this at compile time; verify the js backstop too
    const v6 = { version: 6, layers: [] } as unknown as RmPageV5;
    expect(() => serializeRm(v6)).toThrow("not supported");
  });

  test("rejects an unrecognized header", () => {
    const data = new Writer().ascii("not a lines file".padEnd(43, " ")).bytes();
    expect(() => parseRm(data)).toThrow("unrecognized");
  });

  test("rejects an unknown version", () => {
    const data = new Writer().ascii(header(9)).int(0).bytes();
    expect(() => parseRm(data)).toThrow("unsupported .lines version");
  });

  test("throws on truncated data", () => {
    const data = new Writer()
      .ascii(header(5))
      .int(1) // num layers
      .int(1) // num lines, but no stroke follows
      .bytes();
    expect(() => parseRm(data)).toThrow();
  });

  test("throws on data shorter than the header", () => {
    expect(() => parseRm(new Uint8Array(10))).toThrow("too short");
  });
});

describe("rmBrushes", () => {
  test("names both pen families", () => {
    expect(rmBrushes[2]).toBe("ballpoint");
    expect(rmBrushes[15]).toBe("ballpoint");
  });

  test("rejects an unknown code", () => {
    expect(() => rmBrushCode.parse(99)).toThrow("unknown pen code");
  });
});

describe("rmColors", () => {
  test("names the monochrome palette", () => {
    expect(rmColors[0]).toBe("black");
    expect(rmColors[1]).toBe("gray");
    expect(rmColors[2]).toBe("white");
  });

  test("names both color families", () => {
    expect(rmColors[4]).toBe("green");
    expect(rmColors[10]).toBe("green");
    expect(rmColors[3]).toBe("yellow");
    expect(rmColors[13]).toBe("yellow");
  });

  test("marks highlighter strokes", () => {
    expect(rmColors[9]).toBe("highlight");
  });

  test("rejects an unknown code", () => {
    expect(() => rmColorCode.parse(99)).toThrow("unknown color code");
  });
});
