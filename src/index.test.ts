import { webcrypto } from "crypto";
import { Entry, GenerationError, register, remarkable, ResponseError } from ".";
import { createMockFetch, mapCache, MockResponse } from "./test-utils";

// make sure we use web crypto
global.crypto = webcrypto as unknown as Crypto;
// make sure we can't use fetch
global.fetch = undefined as never;

const TIMESTAMP = "1985-04-12T23:20:50.52Z";
const GET_URL = JSON.stringify({
  url: "get url",
  method: "GET",
  relative_path: "get path",
  expires: TIMESTAMP,
});
const PUT_URL = JSON.stringify({
  url: "put url",
  method: "PUT",
  relative_path: "put path",
  expires: TIMESTAMP,
});

describe("register()", () => {
  test("success", async () => {
    const fetch = createMockFetch(new MockResponse("custom device token"));

    const token = await register("academic", { fetch });
    expect(token).toBe("custom device token");
    expect(fetch.pastRequests.length).toBe(1);
    const [first] = fetch.pastRequests;
    expect(first).toBeDefined();
  });

  test("invalid", async () => {
    const fetch = createMockFetch();

    await expect(register("", { fetch })).rejects.toThrow(
      "code should be length 8, but was 0"
    );
  });

  test("error", async () => {
    const fetch = createMockFetch(new MockResponse("", 400, "custom error"));

    await expect(register("academic", { fetch })).rejects.toThrow(
      "couldn't register api"
    );
  });

  test("default", async () => {
    // can call with default syntax, even though this instance will fail
    await expect(register("academic")).rejects.toThrow(
      "fetch is not a function"
    );
  });
});

describe("remarkable", () => {
  describe("remarkable()", () => {
    test("success", async () => {
      const fetch = createMockFetch(new MockResponse("custom user token"));

      await remarkable("custom device token", { fetch });
      expect(fetch.pastRequests.length).toBe(1);
      const [first] = fetch.pastRequests;
      expect(first?.headers?.["Authorization"]).toBe(
        "Bearer custom device token"
      );
    });

    test("error", async () => {
      const fetch = createMockFetch(new MockResponse("", 400));

      await expect(remarkable("", { fetch })).rejects.toThrow(
        "couldn't fetch auth token"
      );
    });

    test("default", async () => {
      await expect(remarkable("")).rejects.toThrow("fetch is not a function");
    });
  });

  test("#syncComplete()", async () => {
    const fetch = createMockFetch(new MockResponse(), new MockResponse());

    const api = await remarkable("", { fetch });

    await api.syncComplete();

    const [, resp] = fetch.pastRequests;
    expect(resp).toBeDefined();
  });

  describe("#authedFetch()", () => {
    test("error", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse("", 400)
      );

      const api = await remarkable("", { fetch });
      await expect(api.syncComplete()).rejects.toThrow(
        "failed reMarkable request"
      );
    });
  });

  describe("#getRootHash()", () => {
    test("success", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("custom hash", 200, "", { "x-goog-generation": "123" })
      );

      const api = await remarkable("", { fetch });
      const [hash, gen] = await api.getRootHash();
      expect(hash).toBe("custom hash");
      expect(gen).toBe(123n);
    });

    test("no generation", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("custom hash")
      );

      const api = await remarkable("", { fetch });
      await expect(api.getRootHash()).rejects.toThrow("no generation header");
    });
  });

  describe("#signedFetch()", () => {
    test("error", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("custom error", 400, "bad request")
      );

      const api = await remarkable("", { fetch });
      await expect(api.getRootHash()).rejects.toThrow("custom error");
    });
  });

  describe("#getUrl()", () => {
    test("error", async () => {
      const fetch = createMockFetch(new MockResponse(), new MockResponse("{}"));

      const api = await remarkable("", { fetch });
      await expect(api.getRootHash()).rejects.toThrow(
        "couldn't validate schema:"
      );
    });
  });

  describe("#putRootHash()", () => {
    test("success", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse("custom hash", 200, "", { "x-goog-generation": "123" })
      );

      const api = await remarkable("", { fetch });
      const gen = await api.putRootHash("", 0n);
      expect(gen).toBe(123n);
    });

    test("http error", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse("custom hash", 400)
      );

      const api = await remarkable("", { fetch });
      await expect(api.putRootHash("", 0n)).rejects.toThrow(ResponseError);
    });

    test("generation error", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse("custom hash", 412)
      );

      const api = await remarkable("", { fetch });
      await expect(api.putRootHash("", 0n)).rejects.toThrow(GenerationError);
    });

    test("no generation", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse("custom hash")
      );

      const api = await remarkable("", { fetch });
      await expect(api.putRootHash("", 0n)).rejects.toThrow(
        "no generation header"
      );
    });
  });

  describe("#getText()", () => {
    test("default", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("custom text"),
        new MockResponse(GET_URL),
        new MockResponse("different text")
      );

      const api = await remarkable("", { fetch });
      const first = await api.getText("hash");
      expect(first).toBe("custom text");
      // no cache
      const second = await api.getText("hash");
      expect(second).toBe("different text");
    });

    test("cached", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("custom text"),
        new MockResponse(GET_URL),
        new MockResponse("different text")
      );
      const cache = mapCache();

      const api = await remarkable("", { fetch, cache });
      const first = await api.getText("hash");
      expect(first).toBe("custom text");
      // cache, no requests
      const second = await api.getText("hash");
      expect(second).toBe("custom text");
      // different key
      const third = await api.getText("new hash");
      expect(third).toBe("different text");
    });
  });

  test("#getBuffer()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(GET_URL),
      new MockResponse("custom text")
    );

    const api = await remarkable("", { fetch });
    const first = await api.getBuffer("hash");
    const dec = new TextDecoder();
    expect(dec.decode(first)).toBe("custom text");
  });

  describe("#getMetadata()", () => {
    test("success", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse(
          JSON.stringify({
            type: "CollectionType",
            visibleName: "title",
            parent: "",
            lastModified: TIMESTAMP,
            version: 1,
            synced: true,
          })
        )
      );

      const api = await remarkable("", { fetch });
      const meta = await api.getMetadata("hash");
      expect(meta.visibleName).toBe("title");
    });

    test("failure", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse(
          JSON.stringify({
            type: "CollectionType",
            visibleName: "title",
            lastModified: TIMESTAMP,
            version: 1,
            synced: true,
          })
        )
      );

      const api = await remarkable("", { fetch });
      await expect(api.getMetadata("hash")).rejects.toThrow(
        "couldn't validate schema"
      );
    });
  });

  describe("#getEntries()", () => {
    test("success", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse(
          "3\n" + "hash:0:id:0:1234\n" + "other_hash:80000000:other_id:4:0\n"
        )
      );

      const api = await remarkable("", { fetch });
      const [first, second] = await api.getEntries("");
      expect(first?.hash).toBe("hash");
      expect(first?.documentId).toBe("id");
      expect(first?.size).toBe(1234n);
      expect(second?.hash).toBe("other_hash");
      expect(second?.documentId).toBe("other_id");
      expect(second?.subfiles).toBe(4);
    });

    test("invalid format", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("3\nhash:0:id:0\n")
      );

      const api = await remarkable("", { fetch });
      await expect(api.getEntries("")).rejects.toThrow(
        "didn't contain five fields"
      );
    });

    test("invalid document", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("3\nhash:0:id:3:2\n")
      );

      const api = await remarkable("", { fetch });
      await expect(api.getEntries("")).rejects.toThrow(
        "file type entry had nonzero number of subfiles: 3"
      );
    });

    test("invalid type", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("3\nhash:1:id:3:2\n")
      );

      const api = await remarkable("", { fetch });
      await expect(api.getEntries("")).rejects.toThrow(
        "contained invalid type: 1"
      );
    });

    test("invalid schema", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("4\nhash:1:id:3:2\n")
      );

      const api = await remarkable("", { fetch });
      await expect(api.getEntries("")).rejects.toThrow(
        "unexpected schema version: 4"
      );
    });
  });

  describe("#putEntries()", () => {
    test("normal", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse()
      );

      const api = await remarkable("", { fetch });
      const entry = await api.putEntries("doc id", [
        {
          type: "0",
          hash: "hash",
          documentId: "id",
          subfiles: 0,
          size: 1234n,
        },
      ]);

      expect(entry.documentId).toBe("doc id");
      expect(entry.subfiles).toBe(1);

      const [, , req] = fetch.pastRequests;
      expect(req?.url).toBe("put url");
      expect(req?.bodyText).toBe("3\nhash:0:id:0:1234\n");
    });

    test("cached", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse()
      );
      const cache = mapCache();

      const api = await remarkable("", { fetch, cache });
      const entry: Entry = {
        type: "0",
        hash: "hash",
        documentId: "id",
        subfiles: 0,
        size: 1234n,
      };
      const { hash } = await api.putEntries("doc id", [entry]);

      const [cached] = await api.getEntries(hash);
      expect(cached).toEqual(entry);
    });
  });

  test("#putBuffer()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(PUT_URL),
      new MockResponse()
    );

    const api = await remarkable("", { fetch });
    const buffer = new Uint8Array([0, 2, 5, 9, 100, 255]);
    const entry = await api.putBuffer("doc id", buffer);

    expect(entry.documentId).toBe("doc id");
    expect(entry.size).toBe(6n);

    const [, , req] = fetch.pastRequests;
    expect(req?.url).toBe("put url");
    const sent = req?.body as Uint8Array;
    for (const [i, v] of buffer.entries()) {
      expect(sent[i]).toBe(v);
    }
  });

  describe("#putText()", () => {
    test("normal", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse()
      );

      const api = await remarkable("", { fetch });
      const entry = await api.putText("doc id", "custom text");

      expect(entry.documentId).toBe("doc id");
      expect(entry.size).toBe(11n);

      const [, , req] = fetch.pastRequests;
      expect(req?.url).toBe("put url");
      expect(req?.bodyText).toBe("custom text");
    });

    test("cached", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse()
      );
      const cache = mapCache();

      const api = await remarkable("", { fetch, cache });
      const { hash } = await api.putText("doc id", "custom text");
      const cached = await api.getText(hash);
      expect(cached).toBe("custom text");
    });
  });

  describe("#putEpub()", () => {
    test("success", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        // doc
        new MockResponse(PUT_URL),
        new MockResponse(),
        // metadata
        new MockResponse(PUT_URL),
        new MockResponse(),
        // content
        new MockResponse(PUT_URL),
        new MockResponse(),
        // collection
        new MockResponse(PUT_URL),
        new MockResponse()
      );

      const enc = new TextEncoder();
      const epub = "fake epub content";
      const api = await remarkable("", { fetch });
      await api.putEpub("doc name", enc.encode(epub));

      const [, , doc, , metadata, , content, , collection] = fetch.pastRequests;
      expect(doc?.bodyText).toBe(epub);
      expect(JSON.parse(metadata?.bodyText ?? "")).toBeDefined();
      expect(JSON.parse(content?.bodyText ?? "")).toBeDefined();
      expect(collection?.bodyText).toMatch(/^3\n/);
    });

    test("custom", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        // doc
        new MockResponse(PUT_URL),
        new MockResponse(),
        // metadata
        new MockResponse(PUT_URL),
        new MockResponse(),
        // content
        new MockResponse(PUT_URL),
        new MockResponse(),
        // collection
        new MockResponse(PUT_URL),
        new MockResponse()
      );

      const enc = new TextEncoder();
      const epub = "fake epub content";
      const api = await remarkable("", { fetch });
      await api.putEpub("doc name", enc.encode(epub), {
        cover: "first",
        lineHeight: "lg",
        margins: "rr",
        textScale: "sm",
      });

      const [, , , , , , content] = fetch.pastRequests;
      expect(JSON.parse(content?.bodyText ?? "")?.margins).toEqual(180);
    });
  });
});
