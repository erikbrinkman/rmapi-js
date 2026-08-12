import { expect, test } from "bun:test";
import { parseRm, serializeRm } from "./raw.js";
import { parseRmScene, serializeRmScene } from "./rm6.js";

const HEADER = "reMarkable .lines file, version=6".padEnd(43, " ");

/** assemble a v6 file from block bodies */
function file(
  blocks: {
    type: number;
    body: number[];
    reserved?: number;
    length?: number;
  }[],
): Uint8Array {
  const out: number[] = [...new TextEncoder().encode(HEADER)];
  for (const { type, body, reserved = 0, length = body.length } of blocks) {
    out.push(
      length & 0xff,
      (length >> 8) & 0xff,
      (length >> 16) & 0xff,
      (length >>> 24) & 0xff,
      reserved,
      1,
      1,
      type,
    );
    out.push(...body);
  }
  return new Uint8Array(out);
}

/** a tagged uint32: index/type tag byte then little-endian value */
function int(index: number, value: number): number[] {
  return [
    index * 16 + 0x4,
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

const pageInfoBody = [...int(1, 7), ...int(2, 3), ...int(3, 120), ...int(4, 9)];

test("v6 round-trips byte for byte", () => {
  const data = file([{ type: 0x0a, body: pageInfoBody }]);
  expect(serializeRmScene(parseRmScene(data))).toEqual(data);
});

test("v6 goes through the parseRm/serializeRm dispatch", () => {
  const data = file([{ type: 0x0a, body: pageInfoBody }]);
  const page = parseRm(data);
  expect(page.version).toBe(6);
  expect(serializeRm(page)).toEqual(data);
});

test("an absent typeFolioUseCount stays absent", () => {
  const data = file([{ type: 0x0a, body: pageInfoBody }]);
  const [block] = parseRmScene(data).blocks;
  expect(block?.type).toBe("pageInfo");
  if (block?.type === "pageInfo") {
    expect(block.typeFolioUseCount).toBeUndefined();
    expect(block.loadsCount).toBe(7);
    expect(block.textCharsCount).toBe(120);
  }
  expect(serializeRmScene(parseRmScene(data))).toEqual(data);
});

test("a present typeFolioUseCount of zero is kept", () => {
  const data = file([{ type: 0x0a, body: [...pageInfoBody, ...int(5, 0)] }]);
  const [block] = parseRmScene(data).blocks;
  if (block?.type === "pageInfo") expect(block.typeFolioUseCount).toBe(0);
  // writing it back must not drop the tag just because the value is zero
  expect(serializeRmScene(parseRmScene(data))).toEqual(data);
});

test("the reserved header byte is preserved, not assumed zero", () => {
  const data = file([{ type: 0x0a, body: pageInfoBody, reserved: 1 }]);
  expect(parseRmScene(data).blocks[0]?.reserved).toBe(1);
  expect(serializeRmScene(parseRmScene(data))).toEqual(data);
});

test("a block that overruns the file is kept verbatim", () => {
  // a corrupt length must not throw, and must round-trip unchanged
  const data = file([{ type: 0x00, body: [1, 2, 3, 4], length: 0x7fff_ffff }]);
  const [block] = parseRmScene(data).blocks;
  expect(block?.type).toBe("unknown");
  if (block?.type === "unknown") {
    expect(block.declaredLength).toBe(0x7fff_ffff);
    expect([...block.data]).toEqual([1, 2, 3, 4]);
  }
  expect(serializeRmScene(parseRmScene(data))).toEqual(data);
});

test("a subblock with an unread tail keeps the whole block verbatim", () => {
  // a scene tree block whose parent subblock carries one byte the reader
  // doesn't know about, as a later firmware might add
  const id = [0x1f, 0x00, 0x01];
  const body = [
    ...id,
    0x2f,
    0x00,
    0x01,
    0x31,
    0x01,
    0x4c,
    0x04,
    0x00,
    0x00,
    0x00,
    ...id,
    0xff,
  ];
  const data = file([{ type: 0x01, body }]);

  const [block] = parseRmScene(data).blocks;
  expect(block?.type).toBe("unknown");
  expect(serializeRmScene(parseRmScene(data))).toEqual(data);
});

test("an unparseable block falls back to raw bytes and round-trips", () => {
  // tag 1 as a Byte1 where the reader wants Byte4
  const data = file([{ type: 0x0a, body: [0x11, 0x05] }]);
  const [block] = parseRmScene(data).blocks;
  expect(block?.type).toBe("unknown");
  expect(serializeRmScene(parseRmScene(data))).toEqual(data);
});
