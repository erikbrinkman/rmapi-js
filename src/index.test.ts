import { Entry, GenerationError, register, remarkable, ResponseError } from ".";
import { createMockFetch, MockResponse, resolveTo } from "./test-utils";

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
const PUT_URL_BYTES = JSON.stringify({
  url: "put url",
  method: "PUT",
  relative_path: "put path",
  expires: TIMESTAMP,
  maxuploadsize_bytes: 1000000,
});
const PUT_COLLECTION_RESPONSES = [
  // metadata
  new MockResponse(PUT_URL),
  new MockResponse(),
  // content
  new MockResponse(PUT_URL),
  new MockResponse(),
  // collection
  new MockResponse(PUT_URL),
  new MockResponse(),
] as const;
const PUT_FILE_RESPONSES = [
  // doc
  new MockResponse(PUT_URL_BYTES),
  new MockResponse(),
  // rest
  ...PUT_COLLECTION_RESPONSES,
] as const;

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
      "code should be length 8, but was 0",
    );
  });

  test("error", async () => {
    const fetch = createMockFetch(new MockResponse("", 400, "custom error"));

    await expect(register("academic", { fetch })).rejects.toThrow(
      "couldn't register api",
    );
  });

  test("default", async () => {
    // can call with default syntax, even though this instance will fail
    await expect(register("academic")).rejects.toThrow(
      "fetch is not a function",
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
        "Bearer custom device token",
      );
    });

    test("error", async () => {
      const fetch = createMockFetch(new MockResponse("", 400));

      await expect(remarkable("", { fetch })).rejects.toThrow(
        "couldn't fetch auth token",
      );
    });

    test("subtle error", async () => {
      const fetch = createMockFetch(new MockResponse("", 400));

      await expect(
        remarkable("", { fetch, subtle: null as never }),
      ).rejects.toThrow("subtle was missing");
    });

    test("default", async () => {
      await expect(remarkable("")).rejects.toThrow("fetch is not a function");
    });
  });

  describe("#authedFetch()", () => {
    test("error", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse("", 400),
      );

      const api = await remarkable("", { fetch });
      await expect(api.getRootHash()).rejects.toThrow(
        "failed reMarkable request",
      );
    });
  });

  describe("#getRootHash()", () => {
    test("success", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("custom hash", 200, "", {
          "x-goog-generation": "123",
        }),
        new MockResponse(GET_URL),
        new MockResponse("new hash", 200, "", { "x-goog-generation": "124" }),
      );

      const api = await remarkable("", { fetch });
      const [hash, gen] = await api.getRootHash();
      expect(hash).toBe("custom hash");
      expect(gen).toBe(123n);

      // cached
      const [chash, cgen] = await api.getRootHash();
      expect(chash).toBe("custom hash");
      expect(cgen).toBe(123n);

      // not cached
      const [shash, sgen] = await api.getRootHash({ cache: false });
      expect(shash).toBe("new hash");
      expect(sgen).toBe(124n);
    });

    test("no generation", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("custom hash"),
      );

      const api = await remarkable("", { fetch });
      await expect(api.getRootHash()).rejects.toThrow("no generation header");
    });

    test("triple cache", async () => {
      // this should only make two requests, even though the first fails
      const [failedGet, send] = resolveTo(new MockResponse("err", 500));
      const fetch = createMockFetch(
        new MockResponse(),
        failedGet,
        new MockResponse(GET_URL),
        new MockResponse("custom hash", 200, "", {
          "x-goog-generation": "123",
        }),
      );

      const api = await remarkable("", { fetch });
      const first = api.getRootHash(); // fails
      const second = api.getRootHash(); // succeeds
      const third = api.getRootHash(); // cached
      send(); // resolve first others waiting
      await expect(first).rejects.toThrow("failed reMarkable request: err");
      const [shash, sgen] = await second;
      expect(shash).toBe("custom hash");
      expect(sgen).toBe(123n);
      const [thash, tgen] = await third;
      expect(thash).toBe("custom hash");
      expect(tgen).toBe(123n);
    });
  });

  describe("#signedFetch()", () => {
    test("error", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("custom error", 400, "bad request"),
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
        "couldn't validate schema:",
      );
    });
  });

  describe("#putRootHash()", () => {
    test("success", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse("custom hash", 200, "", {
          "x-goog-generation": "123",
        }),
      );

      const api = await remarkable("", { fetch });
      const gen = await api.putRootHash("new hash", 0n);
      expect(gen).toBe(123n);
    });

    test("http error", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse("custom hash", 400),
      );

      const api = await remarkable("", { fetch });
      await expect(api.putRootHash("", 0n)).rejects.toThrow(ResponseError);
    });

    test("generation error", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse("custom hash", 412),
      );

      const api = await remarkable("", { fetch });
      await expect(api.putRootHash("", 0n)).rejects.toThrow(GenerationError);
    });

    test("no generation", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse("custom hash"),
      );

      const api = await remarkable("", { fetch });
      await expect(api.putRootHash("", 0n)).rejects.toThrow(
        "no generation header",
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
        new MockResponse("different text"),
      );

      const api = await remarkable("", { fetch, cacheLimitBytes: 0 });
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
        new MockResponse("different text"),
      );

      const api = await remarkable("", { fetch });
      const first = await api.getText("hash");
      expect(first).toBe("custom text");
      // cache, no requests
      const second = await api.getText("hash");
      expect(second).toBe("custom text");
      // different key
      const third = await api.getText("new hash");
      expect(third).toBe("different text");
    });

    test("triple cache", async () => {
      // this tests that three simultaneous requests with a failure has the
      // appropriate behavior
      const [failedGet, send] = resolveTo(new MockResponse("err", 500));
      const fetch = createMockFetch(
        new MockResponse(),
        failedGet,
        new MockResponse(GET_URL),
        new MockResponse("custom text"),
      );

      const api = await remarkable("", { fetch });

      const first = api.getText("hash"); // error
      const second = api.getText("hash"); // succeed
      const third = api.getText("hash"); // cache

      send(); // finish first request

      await expect(first).rejects.toThrow("failed reMarkable request: err");
      await expect(second).resolves.toBe("custom text");
      await expect(third).resolves.toBe("custom text");
    });
  });

  describe("#getBuffer()", () => {
    test("success", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("custom text"),
      );

      const api = await remarkable("", { fetch });
      const first = await api.getBuffer("hash");
      const dec = new TextDecoder();
      expect(dec.decode(first)).toBe("custom text");
    });

    test("no cache", async () => {
      const dec = new TextDecoder();

      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("custom text"),
        new MockResponse(GET_URL),
        new MockResponse("other text"),
      );

      const api = await remarkable("", { fetch, cacheLimitBytes: 0 });
      const first = await api.getBuffer("hash");
      expect(dec.decode(first)).toBe("custom text");
      const second = await api.getBuffer("hash");
      expect(dec.decode(second)).toBe("other text");
    });
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
          }),
        ),
      );

      const api = await remarkable("", { fetch });
      const meta = await api.getMetadata("hash");
      expect(meta.visibleName).toBe("title");
    });

    test("issue #5", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse(
          JSON.stringify({
            createdTime: "0",
            lastModified: "1699795915954",
            lastOpened: "1699795889468",
            lastOpenedPage: 227,
            // eslint-disable-next-line spellcheck/spell-checker
            parent: "44b07ec7-8bd1-43a3-a1ba-cd32f3222585",
            pinned: false,
            type: "DocumentType",
            visibleName: "Document",
          }),
        ),
      );

      const api = await remarkable("", { fetch });
      const meta = await api.getMetadata("hash");
      expect(meta.visibleName).toBe("Document");
    });

    test("failure", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse(
          JSON.stringify({
            type: "CollectionType",
            visibleName: "title",
          }),
        ),
      );

      const api = await remarkable("", { fetch });
      await expect(api.getMetadata("hash")).rejects.toThrow(
        "couldn't validate schema",
      );
    });
  });

  describe("#getEntries()", () => {
    test("success", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse(
          "3\n" + "hash:0:id:0:1234\n" + "other_hash:80000000:other_id:4:0\n",
        ),
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

    test("root", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("root hash", 200, "", {
          "x-goog-generation": "123",
        }),
        new MockResponse(GET_URL),
        new MockResponse(
          "3\n" + "hash:0:id:0:1234\n" + "other_hash:80000000:other_id:4:0\n",
        ),
      );

      const api = await remarkable("", { fetch });
      const [first, second] = await api.getEntries();
      expect(first?.hash).toBe("hash");
      expect(first?.documentId).toBe("id");
      expect(first?.size).toBe(1234n);
      expect(second?.hash).toBe("other_hash");
      expect(second?.documentId).toBe("other_id");
      expect(second?.subfiles).toBe(4);

      const [, , , req] = fetch.pastRequests;
      expect(
        (JSON.parse(req?.bodyText ?? "") as { relative_path: string })
          .relative_path,
      ).toBe("root hash");
    });

    test("invalid format", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("3\nhash:0:id:0\n"),
      );

      const api = await remarkable("", { fetch });
      await expect(api.getEntries("")).rejects.toThrow(
        "didn't contain five fields",
      );
    });

    test("invalid document", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("3\nhash:0:id:3:2\n"),
      );

      const api = await remarkable("", { fetch });
      await expect(api.getEntries("")).rejects.toThrow(
        "file type entry had nonzero number of subfiles: 3",
      );
    });

    test("invalid type", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("3\nhash:1:id:3:2\n"),
      );

      const api = await remarkable("", { fetch });
      await expect(api.getEntries("")).rejects.toThrow(
        "contained invalid type: 1",
      );
    });

    test("invalid schema", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("4\nhash:1:id:3:2\n"),
      );

      const api = await remarkable("", { fetch });
      await expect(api.getEntries("")).rejects.toThrow(
        "unexpected schema version: 4",
      );
    });
  });

  describe("#putEntries()", () => {
    test("normal", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse(),
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
        new MockResponse(),
      );

      const api = await remarkable("", { fetch });
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
      new MockResponse(),
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
        new MockResponse(),
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
        new MockResponse(),
      );

      const api = await remarkable("", { fetch });
      const { hash } = await api.putText("doc id", "custom text");
      const cached = await api.getText(hash);
      expect(cached).toBe("custom text");
    });

    test("no cache", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(PUT_URL),
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("different text"),
      );

      const api = await remarkable("", { fetch, cacheLimitBytes: 0 });
      const { hash } = await api.putText("doc id", "custom text");
      const result = await api.getText(hash);
      expect(result).toBe("different text");
    });

    test("cache failure", async () => {
      const [failedPut, send] = resolveTo(new MockResponse("err", 500));
      const fetch = createMockFetch(
        new MockResponse(),
        failedPut,
        new MockResponse(PUT_URL),
        new MockResponse(),
      );

      const api = await remarkable("", { fetch });

      const first = api.putText("doc id", "custom text"); // fail
      const second = api.putText("doc id", "custom text"); // send
      const third = api.putText("doc id", "custom text"); // cached

      send();

      await expect(first).rejects.toThrow("failed reMarkable request: err");
      await second;
      await third;

      // second failed
      expect(fetch.pastRequests).toHaveLength(4);
    });
  });

  test("#putCollection()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      ...PUT_COLLECTION_RESPONSES,
    );

    const api = await remarkable("", { fetch });
    await api.putCollection("New Folder");

    const [, , , metadata, , content] = fetch.pastRequests;
    expect(JSON.parse(metadata?.bodyText ?? "")).toBeDefined();
    expect(JSON.parse(content?.bodyText ?? "")).toBeDefined();
  });

  describe("#putEpub()", () => {
    test("success", async () => {
      const fetch = createMockFetch(new MockResponse(), ...PUT_FILE_RESPONSES);

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
      const fetch = createMockFetch(new MockResponse(), ...PUT_FILE_RESPONSES);

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
      expect(
        (JSON.parse(content?.bodyText ?? "") as { margins: number }).margins,
      ).toEqual(180);
    });
  });

  describe("#putPdf()", () => {
    test("success", async () => {
      const fetch = createMockFetch(new MockResponse(), ...PUT_FILE_RESPONSES);

      const enc = new TextEncoder();
      const pdf = "fake pdf content";
      const api = await remarkable("", { fetch });
      await api.putPdf("doc name", enc.encode(pdf));

      const [, , doc, , metadata, , content, , collection] = fetch.pastRequests;
      expect(doc?.bodyText).toBe(pdf);
      expect(JSON.parse(metadata?.bodyText ?? "")).toBeDefined();
      expect(JSON.parse(content?.bodyText ?? "")).toBeDefined();
      expect(collection?.bodyText).toMatch(/^3\n/);
    });

    test("custom", async () => {
      const fetch = createMockFetch(new MockResponse(), ...PUT_FILE_RESPONSES);

      const enc = new TextEncoder();
      const pdf = "fake pdf content";
      const api = await remarkable("", { fetch });
      await api.putPdf("doc name", enc.encode(pdf), {
        cover: "visited",
      });

      const [, , , , , , content] = fetch.pastRequests;
      expect(
        (JSON.parse(content?.bodyText ?? "") as { coverPageNumber: number })
          .coverPageNumber,
      ).toEqual(-1);
    });
  });

  test("#syncComplete()", async () => {
    const fetch = createMockFetch(new MockResponse(), new MockResponse());

    const api = await remarkable("", { fetch });
    await api.syncComplete(0n);

    const [, req] = fetch.pastRequests;
    expect(req?.url).toBe(
      "https://internal.cloud.remarkable.com/sync/v2/sync-complete",
    );
    expect(JSON.parse(req?.bodyText ?? "")).toEqual({ generation: 0 });
  });

  describe("#create()", () => {
    const CREATE_RESPONSES = [
      // root hash
      new MockResponse(GET_URL),
      new MockResponse("custom hash", 200, "", {
        "x-goog-generation": "123",
      }),
      // entries
      new MockResponse(GET_URL),
      new MockResponse(
        "3\n" + "hash:0:id:0:1234\n" + "other_hash:80000000:other_id:4:0\n",
      ),
      // put entries
      new MockResponse(PUT_URL),
      new MockResponse(),
      // put root hash
      new MockResponse(PUT_URL),
      new MockResponse("custom hash", 200, "", {
        "x-goog-generation": "124",
      }),
    ] as const;

    test("sync", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        ...CREATE_RESPONSES,
        new MockResponse(),
      );

      const api = await remarkable("", { fetch });
      const res = await api.create({
        type: "80000000",
        hash: "create hash",
        documentId: "docid",
        subfiles: 3,
        size: 0n,
      });

      expect(res).toBe(true);

      const [, , , , , , ents, , , sync] = fetch.pastRequests;

      expect(ents?.bodyText).toEqual(
        "3\n" +
          "create hash:80000000:docid:3:0\n" +
          "hash:0:id:0:1234\n" +
          "other_hash:80000000:other_id:4:0\n",
      );
      expect(JSON.parse(sync?.bodyText ?? "")).toEqual({ generation: 124 });
    });

    test("sync failure", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        ...CREATE_RESPONSES,
        // sync failure
        new MockResponse("", 400),
      );

      const api = await remarkable("", { fetch });
      const res = await api.create({
        type: "80000000",
        hash: "create hash",
        documentId: "docid",
        subfiles: 3,
        size: 0n,
      });

      expect(res).toBe(false);

      const [, , , , , , ents, , , sync] = fetch.pastRequests;

      expect(ents?.bodyText).toEqual(
        "3\n" +
          "create hash:80000000:docid:3:0\n" +
          "hash:0:id:0:1234\n" +
          "other_hash:80000000:other_id:4:0\n",
      );
      expect(sync).toBeDefined();
    });

    test("no sync", async () => {
      const fetch = createMockFetch(new MockResponse(), ...CREATE_RESPONSES);

      const api = await remarkable("", { fetch });
      const res = await api.create(
        {
          type: "80000000",
          hash: "create hash",
          documentId: "docid",
          subfiles: 3,
          size: 0n,
        },
        { sync: false },
      );

      expect(res).toBe(false);

      const [, , , , , , ents, , , sync] = fetch.pastRequests;

      expect(ents?.bodyText).toEqual(
        "3\n" +
          "create hash:80000000:docid:3:0\n" +
          "hash:0:id:0:1234\n" +
          "other_hash:80000000:other_id:4:0\n",
      );
      expect(sync).toBeUndefined();
    });
  });

  describe("#move()", () => {
    const MOVE_INIT_RESPONSES = [
      // root hash
      new MockResponse(GET_URL),
      new MockResponse("old root hash", 200, "", {
        "x-goog-generation": "123",
      }),
      // entries
      new MockResponse(GET_URL),
      new MockResponse(
        "3\n" + "hash:80000000:id:1:0\n" + "other_hash:80000000:other_id:4:0\n",
      ),
    ];
    const MOVE_DEST_RESPONSES = [
      // dest entries
      new MockResponse(GET_URL),
      new MockResponse("3\n" + "other_meta_hash:0:other_id.metadata:0:1234\n"),
      // dest metadata
      new MockResponse(GET_URL),
      new MockResponse(
        JSON.stringify({
          type: "CollectionType",
          visibleName: "title",
          parent: "",
          lastModified: TIMESTAMP,
          version: 1,
          synced: true,
        }),
      ),
    ] as const;
    const MOVE_FINAL_RESPONSES = [
      // doc entries
      new MockResponse(GET_URL),
      new MockResponse(
        "3\n" +
          "meta_hash:0:id.metadata:0:1234\n" +
          "content_hash:0:id.content:0:1234\n",
      ),
      // doc metadata
      new MockResponse(GET_URL),
      new MockResponse(
        JSON.stringify({
          type: "DocumentType",
          visibleName: "movee",
          parent: "",
          lastModified: TIMESTAMP,
          version: 1,
          synced: true,
        }),
      ),
      // put metadata
      new MockResponse(PUT_URL),
      new MockResponse(),
      // put entries
      new MockResponse(PUT_URL),
      new MockResponse(),
      // put entries
      new MockResponse(PUT_URL),
      new MockResponse(),
      // put root hash
      new MockResponse(PUT_URL),
      new MockResponse("next root hash", 200, "", {
        "x-goog-generation": "124",
      }),
    ] as const;

    test("sync", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        ...MOVE_INIT_RESPONSES,
        ...MOVE_DEST_RESPONSES,
        ...MOVE_FINAL_RESPONSES,
        new MockResponse(),
      );

      const api = await remarkable("", { fetch });
      const res = await api.move("id", "other_id");

      expect(res).toBe(true);

      const [meta, , docEnts, , rootEnts, , , sync] =
        fetch.pastRequests.slice(14);

      expect(
        (JSON.parse(meta?.bodyText ?? "") as { parent: string }).parent,
      ).toEqual("other_id");
      expect(docEnts?.bodyText).toBe(
        "3\n" +
          "content_hash:0:id.content:0:1234\n" +
          "ff853ac97253cf6856770bcac4cce7802f237268c2df12ab9be2715cc9402cd6:0:id.metadata:0:132\n",
      );
      expect(rootEnts?.bodyText).toBe(
        "3\n" +
          "e33dbfdf70fbb9a095aabf8296ec2ffbd963ab32df8f966686a81644068e967a:80000000:id:2:0\n" +
          "other_hash:80000000:other_id:4:0\n",
      );
      expect(JSON.parse(sync?.bodyText ?? "")).toEqual({ generation: 124 });
    });

    test("no sync trash", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        ...MOVE_INIT_RESPONSES,
        ...MOVE_FINAL_RESPONSES,
      );

      const api = await remarkable("", { fetch });
      const res = await api.move("id", "trash", { sync: false });

      expect(res).toBe(false);

      const [meta, , docEnts, , rootEnts, , , sync] =
        fetch.pastRequests.slice(10);

      expect(
        (JSON.parse(meta?.bodyText ?? "") as { parent: string }).parent,
      ).toEqual("trash");
      expect(docEnts?.bodyText).toBe(
        "3\n" +
          "content_hash:0:id.content:0:1234\n" +
          "05466705d317771c1b3439d41e6e2bedfbf5e97a40e1617eaf05cbd8765c099a:0:id.metadata:0:129\n",
      );
      expect(rootEnts?.bodyText).toBe(
        "3\n" +
          "72737117d50fb4caf947d26bbb3b70c4b1473a2b2115b090ed39dc33ae9be932:80000000:id:2:0\n" +
          "other_hash:80000000:other_id:4:0\n",
      );
      expect(sync).toBeUndefined();
    });

    test("throws with missing dest", async () => {
      const fetch = createMockFetch(new MockResponse(), ...MOVE_INIT_RESPONSES);

      const api = await remarkable("", { fetch });
      const res = api.move("id", "missing", { sync: false });
      await expect(res).rejects.toThrow("destination id not found: missing");
    });

    test("throws with wrong destination type", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        // root hash
        new MockResponse(GET_URL),
        new MockResponse("custom hash", 200, "", {
          "x-goog-generation": "123",
        }),
        // entries
        new MockResponse(GET_URL),
        new MockResponse(
          "3\n" + "hash:80000000:id:1:0\n" + "other_hash:0:other_id:0:4\n",
        ),
      );

      const api = await remarkable("", { fetch });
      const res = api.move("id", "other_id", { sync: false });
      await expect(res).rejects.toThrow(
        "destination id was a raw file: other_id",
      );
    });

    test("throws with no dest metadata", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        ...MOVE_INIT_RESPONSES,
        // dest entries
        new MockResponse(GET_URL),
        new MockResponse("3\n" + "hash:0:other_id.content:0:1234\n"),
      );

      const api = await remarkable("", { fetch });
      const res = api.move("id", "other_id", { sync: false });
      await expect(res).rejects.toThrow(
        "destination id didn't have metadata: other_id",
      );
    });

    test("throws with file destination", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        ...MOVE_INIT_RESPONSES,
        // dest entries
        new MockResponse(GET_URL),
        new MockResponse("3\n" + "hash:0:other_id.metadata:0:1234\n"),
        // dest metadata
        new MockResponse(GET_URL),
        new MockResponse(
          JSON.stringify({
            type: "DocumentType",
            visibleName: "title",
            parent: "",
            lastModified: TIMESTAMP,
            version: 1,
            synced: true,
          }),
        ),
      );

      const api = await remarkable("", { fetch });
      const res = api.move("id", "other_id", { sync: false });
      await expect(res).rejects.toThrow(
        "destination id wasn't a collection: other_id",
      );
    });

    test("throws with missing document", async () => {
      const fetch = createMockFetch(new MockResponse(), ...MOVE_INIT_RESPONSES);

      const api = await remarkable("", { fetch });
      const res = api.move("missing", "");
      await expect(res).rejects.toThrow("document not found: missing");
    });

    test("throws with non-collection document", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        // root hash
        new MockResponse(GET_URL),
        new MockResponse("custom hash", 200, "", {
          "x-goog-generation": "123",
        }),
        // entries
        new MockResponse(GET_URL),
        new MockResponse(
          "3\n" + "hash:80000000:id:1:0\n" + "other_hash:0:other_id:0:4\n",
        ),
      );

      const api = await remarkable("", { fetch });
      const res = api.move("other_id", "");
      await expect(res).rejects.toThrow("document was a raw file: other_id");
    });

    test("throws with no document metadata", async () => {
      const fetch = createMockFetch(
        new MockResponse(),
        ...MOVE_INIT_RESPONSES,
        // doc entries
        new MockResponse(GET_URL),
        new MockResponse("3\n" + "content_hash:0:id.content:0:1234\n"),
      );

      const api = await remarkable("", { fetch });
      const res = api.move("id", "");
      await expect(res).rejects.toThrow("document didn't have metadata: id");
    });
  });

  test("#getEntriesMetadata()", async () => {
    const entries = [
      {
        type: "CollectionType",
        id: "id",
        hash: "hash",
        visibleName: "name",
        lastModified: "",
      },
    ];
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify(entries)),
    );

    const api = await remarkable("", { fetch });
    const res = await api.getEntriesMetadata();

    expect(res).toEqual(entries);
  });

  test("#uploadEpub()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify({ docID: "epub id", hash: "epub hash" })),
    );

    const api = await remarkable("", { fetch });
    const encoder = new TextEncoder();
    const content = "my epub content";
    const res = await api.uploadEpub("my epub title", encoder.encode(content));

    expect(res.docID).toBe("epub id");
    expect(res.hash).toBe("epub hash");

    const [, req] = fetch.pastRequests;
    expect(req?.bodyText).toBe("my epub content");
  });

  test("#uploadPdf()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify({ docID: "pdf id", hash: "pdf hash" })),
    );

    const api = await remarkable("", { fetch });
    const encoder = new TextEncoder();
    const content = "my pdf content";
    const res = await api.uploadPdf("my pdf title", encoder.encode(content));

    expect(res.docID).toBe("pdf id");
    expect(res.hash).toBe("pdf hash");

    const [, req] = fetch.pastRequests;
    expect(req?.bodyText).toBe("my pdf content");
  });

  test("#getCache()", async () => {
    let initCache;

    {
      const [failedGet, send] = resolveTo(new MockResponse("err", 500));

      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("text"),
        failedGet,
      );

      const api = await remarkable("", { fetch });
      const first = await api.getText("hash");
      expect(first).toBe("text");
      // this will throw when we try to get the cache
      const second = api.getText("other hash");
      const cache = api.getCache();

      send(); // failed request resolves

      initCache = await cache;

      await expect(second).rejects.toThrow("failed reMarkable request: err");
    }

    {
      const fetch = createMockFetch(
        new MockResponse(),
        new MockResponse(GET_URL),
        new MockResponse("different"),
      );

      const api = await remarkable("", { fetch, initCache });
      // still in cache
      const first = await api.getText("hash");
      expect(first).toBe("text");
      // not in cache since request failed
      const second = await api.getText("other hash");
      expect(second).toBe("different");
    }
  });
});
