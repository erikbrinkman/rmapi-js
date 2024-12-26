import { expect, test } from "bun:test";

import { LruCache } from "./lru";

test("LruCache()", () => {
  const cache = new LruCache(10);
  expect(cache.size).toBe(0);

  cache.set("a", "1");
  cache.set("b", "long");
  expect(cache.get("a")).toBe("1");

  // won't evict because we update the length
  cache.set("b", "longer");
  expect(cache.get("a")).toBe("1");

  // evict "b", the least recently used element
  cache.set("c", "short");
  expect(cache.has("b")).toBe(false);

  // delete "c", can add a new thing without evicting "a"
  cache.delete("c");
  cache.set("d", "short");
  expect(cache.has("c")).toBe(false);
  expect(cache.has("a")).toBe(true);

  // clear everything
  cache.clear();
  expect(cache.size).toBe(0);
  expect(cache.has("a")).toBe(false);
});
