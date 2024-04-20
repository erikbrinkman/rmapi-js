import { expect, test } from "bun:test";
import { concatBuffers, fromHex, toHex } from "./utils";

test("toHex()", () => {
  const buff = new Uint8Array([0, 255, 15, 240, 154]);
  const hex = toHex(buff);
  expect(hex).toBe("00ff0ff09a");

  expect(toHex(new Uint8Array(0))).toBe("");
});

test("fromHex()", () => {
  const hex = "00ff0ff09a";
  const buff = fromHex(hex);
  expect([...buff]).toEqual([0, 255, 15, 240, 154]);

  expect([...fromHex("")]).toEqual([]);
});

test("concatBuffers()", () => {
  const a = new Uint8Array([0, 1, 2]);
  const b = new Uint8Array([3]);
  const c = new Uint8Array([4, 5]);
  const joined = concatBuffers([a, b, c]);
  expect([...joined]).toEqual([0, 1, 2, 3, 4, 5]);
});
