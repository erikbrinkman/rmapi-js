import { expect, test } from "bun:test";

import { LruCache } from "./lru.js";

const enc = new TextEncoder();

test("LruCache()", () => {
  const cache = new LruCache(10);
  expect(cache.size).toBe(0);

  cache.set("a", enc.encode("1"));
  cache.set("b", enc.encode("long"));
  expect(cache.get("a")).toEqual(enc.encode("1"));

  // won't evict because we update the length
  cache.set("b", enc.encode("longer"));
  expect(cache.get("a")).toEqual(enc.encode("1"));

  // evict "b", the least recently used element
  cache.set("c", enc.encode("short"));
  expect(cache.has("b")).toBe(false);

  // delete "c", can add a new thing without evicting "a"
  cache.delete("c");
  cache.set("d", enc.encode("short"));
  expect(cache.has("c")).toBe(false);
  expect(cache.has("a")).toBe(true);

  // clear everything
  cache.clear();
  expect(cache.size).toBe(0);
  expect(cache.has("a")).toBe(false);
});

test("LruCache() sizes by bytes, not code units", () => {
  // a two byte character costs two, where a string length would say one
  const cache = new LruCache(6);
  cache.set("k", enc.encode("é"));
  expect(cache.has("k")).toBe(true);

  // key (1) + 6 bytes overflows, so the earlier entry goes
  cache.set("j", enc.encode("ééé"));
  expect(cache.has("k")).toBe(false);
});
