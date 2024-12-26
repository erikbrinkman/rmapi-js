import { describe, expect, mock, test } from "bun:test";
import { Content, Metadata, ValidationError, register, remarkable } from ".";
import {
  bytesResponse,
  createMockFetch,
  emptyResponse,
  jsonResponse,
  textResponse,
} from "./test-utils";

function repHash(hash: string): string {
  const mult = 64 / hash.length;
  return new Array(mult).fill(hash).join("");
}

describe("register()", () => {
  test("success", async () => {
    const fetch = mock(createMockFetch(textResponse("custom device token")));
    globalThis.fetch = fetch;

    const token = await register("academic");
    expect(token).toBe("custom device token");
    expect(fetch.mock.calls).toHaveLength(1);
    const [first] = fetch.mock.calls;
    expect(first).toBeDefined();
  });

  test("invalid", () => {
    globalThis.fetch = mock(createMockFetch());
    expect(register("")).rejects.toThrow("code should be length 8, but was 0");
  });

  test("error", () => {
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse({ status: 400, statusText: "custom error" }),
      ),
    );

    expect(register("academic")).rejects.toThrow("couldn't register api");
  });
});

describe("remarkable", () => {
  describe("remarkable()", () => {
    test("success", async () => {
      const fetch = mock(createMockFetch(textResponse("custom user token")));
      globalThis.fetch = fetch;

      await remarkable("custom device token");
      expect(fetch.mock.calls).toHaveLength(1);
      const [first] = fetch.mock.calls;
      const [, init] = first ?? [];
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer custom device token",
      );
    });

    test("error", () => {
      globalThis.fetch = mock(createMockFetch(emptyResponse({ status: 400 })));
      expect(remarkable("")).rejects.toThrow("couldn't fetch auth token");
    });
  });

  test("#listItems()", async () => {
    const file = {
      type: "DocumentType",
      fileType: "pdf",
      id: "uuid4",
      hash: "hash",
      visibleName: "name",
      lastModified: "0",
      parent: "",
      pinned: false,
      lastOpened: "0",
    } as const;
    globalThis.fetch = mock(
      createMockFetch(emptyResponse(), jsonResponse([file])),
    );

    const api = await remarkable("");
    const [loaded] = await api.listItems();
    expect(loaded).toEqual(file);
  });

  test("#listIds()", async () => {
    const file = `3
hash:80000000:document:0:1
hash2:80000000:other:0:2
`;
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        jsonResponse({
          hash: repHash("0"),
          generation: 0,
          schemaVersion: 3,
        }),
        textResponse(file),
      ),
    );

    const api = await remarkable("");
    const [first, second] = await api.listIds();
    expect(first).toEqual({
      id: "document",
      hash: "hash",
    });
    expect(second).toEqual({
      id: "other",
      hash: "hash2",
    });
  });

  test("#getContent()", async () => {
    const realHash = repHash("1");
    const file = `3
${realHash}:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.epub:0:1
hash:0:doc.pdf:0:1
`;
    const content: Content = {
      fileType: "pdf",
      coverPageNumber: -1,
      documentMetadata: {},
      extraMetadata: {},
      fontName: "",
      formatVersion: 0,
      lineHeight: -1,
      margins: 125,
      orientation: "portrait",
      pageCount: 1,
      sizeInBytes: "1",
      textAlignment: "left",
      textScale: 1,
    };
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        textResponse(file),
        jsonResponse(content),
      ),
    );

    const api = await remarkable("");
    const cont = await api.getContent(repHash("0"));
    expect(cont).toEqual(content);
  });

  test("#getMetadata()", async () => {
    const realHash = repHash("1");
    const file = `3
hash:0:doc.content:0:1
${realHash}:0:doc.metadata:0:1
hash:0:doc.epub:0:1
hash:0:doc.pdf:0:1
`;
    const metadata: Metadata = {
      lastModified: "0",
      visibleName: "name",
      parent: "",
      type: "DocumentType",
      pinned: false,
    };
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        textResponse(file),
        jsonResponse(metadata),
      ),
    );

    const api = await remarkable("");
    const meta = await api.getMetadata(repHash("0"));
    expect(meta).toEqual(metadata);
  });
  test("#getPdf()", async () => {
    const realHash = repHash("1");
    const file = `3
hash:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.epub:0:1
${realHash}:0:doc.pdf:0:1
`;
    const enc = new TextEncoder();
    const pdf = enc.encode("pdf content");
    globalThis.fetch = mock(
      createMockFetch(emptyResponse(), textResponse(file), bytesResponse(pdf)),
    );

    const api = await remarkable("");
    const bytes = await api.getPdf(repHash("0"));
    expect(bytes).toEqual(pdf);
  });

  test("#getEpub()", async () => {
    const realHash = repHash("1");
    const file = `3
hash:0:doc.content:0:1
hash:0:doc.metadata:0:1
${realHash}:0:doc.epub:0:1
hash:0:doc.pdf:0:1
`;
    const enc = new TextEncoder();
    const epub = enc.encode("epub content");
    globalThis.fetch = mock(
      createMockFetch(emptyResponse(), textResponse(file), bytesResponse(epub)),
    );

    const api = await remarkable("");
    const bytes = await api.getEpub(repHash("0"));
    expect(bytes).toEqual(epub);
  });

  test("#getDocument()", async () => {
    const contentHash = repHash("1");
    const metadataHash = repHash("2");
    const epubHash = repHash("3");
    const file = `3
${contentHash}:0:doc.content:0:1
${metadataHash}:0:doc.metadata:0:1
${epubHash}:0:doc.epub:0:1
`;
    const enc = new TextEncoder();
    const content: Content = {
      fileType: "epub",
      coverPageNumber: -1,
      documentMetadata: {},
      extraMetadata: {},
      fontName: "",
      formatVersion: 0,
      lineHeight: -1,
      margins: 125,
      orientation: "portrait",
      pageCount: 1,
      sizeInBytes: "1",
      textAlignment: "left",
      textScale: 1,
    };
    const metadata: Metadata = {
      lastModified: "0",
      visibleName: "name",
      parent: "",
      type: "DocumentType",
      pinned: false,
    };
    const epub = enc.encode("epub content");
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        textResponse(file),
        jsonResponse(content),
        jsonResponse(metadata),
        bytesResponse(epub),
      ),
    );

    const api = await remarkable("");
    const bytes = await api.getDocument(repHash("0"));
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("#putPdf()", async () => {
    const enc = new TextEncoder();
    const pdf = enc.encode("pdf content");
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        jsonResponse({
          hash: repHash("abcd0123"),
          generation: 0,
          schemaVersion: 3,
        }),
        emptyResponse(), // .content
        emptyResponse(), // .metadata
        // eslint-disable-next-line spellcheck/spell-checker
        emptyResponse(), // .pagedata
        emptyResponse(), // .pdf
        textResponse("3\n"),
        emptyResponse(), // .docSchema
        emptyResponse(), // root.docSchema
        jsonResponse({
          hash: repHash("1"),
          generation: 1,
        }), // root hash
      ),
    );

    const api = await remarkable("");
    await api.putPdf("new name", pdf);
  });

  test("#putEpub()", async () => {
    const enc = new TextEncoder();
    const epub = enc.encode("epub content");
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        jsonResponse({
          hash: repHash("abcd0123"),
          generation: 0,
          schemaVersion: 3,
        }),
        emptyResponse(), // .content
        emptyResponse(), // .metadata
        // eslint-disable-next-line spellcheck/spell-checker
        emptyResponse(), // .pagedata
        emptyResponse(), // .epub
        textResponse("3\n"),
        emptyResponse(), // .docSchema
        emptyResponse(), // root.docSchema
        jsonResponse({
          hash: repHash("1"),
          generation: 1,
        }), // root hash
      ),
    );

    const api = await remarkable("");
    await api.putEpub("new name", epub);
  });

  test("#createFolder()", async () => {
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        jsonResponse({ docID: "folder id", hash: "folder hash" }),
      ),
    );

    const api = await remarkable("");
    const res = await api.createFolder("new folder");

    expect(res.id).toBe("folder id");
    expect(res.hash).toBe("folder hash");
  });

  test("#uploadEpub()", async () => {
    const fetch = mock(
      createMockFetch(
        emptyResponse(),
        jsonResponse({ docID: "epub id", hash: "epub hash" }),
      ),
    );
    globalThis.fetch = fetch;

    const api = await remarkable("");
    const enc = new TextEncoder();
    const content = enc.encode("my epub content");
    const res = await api.uploadEpub("my epub title", content);

    expect(res.id).toBe("epub id");
    expect(res.hash).toBe("epub hash");

    const [, req] = fetch.mock.calls;
    const [, init] = req ?? [];
    expect(init?.body).toBe(content);
  });

  test("#uploadPdf()", async () => {
    const fetch = mock(
      createMockFetch(
        emptyResponse(),
        jsonResponse({ docID: "pdf id", hash: "pdf hash" }),
      ),
    );
    globalThis.fetch = fetch;

    const api = await remarkable("");
    const enc = new TextEncoder();
    const content = enc.encode("my pdf content");
    const res = await api.uploadPdf("my pdf title", content);

    expect(res.id).toBe("pdf id");
    expect(res.hash).toBe("pdf hash");

    const [, req] = fetch.mock.calls;
    const [, init] = req ?? [];
    expect(init?.body).toBe(content);
  });

  test("#move()", async () => {
    globalThis.fetch = mock(
      createMockFetch(emptyResponse(), jsonResponse({ hash: "hash" })),
    );

    const api = await remarkable("");
    const res = await api.move(repHash("1234abcd"), "");

    expect(res.hash).toBe("hash");
  });

  test("#delete()", async () => {
    globalThis.fetch = mock(
      createMockFetch(emptyResponse(), jsonResponse({ hash: "hash" })),
    );

    const api = await remarkable("");
    const res = await api.delete(repHash("1234abcd"));

    expect(res.hash).toBe("hash");
  });

  test("#rename()", async () => {
    globalThis.fetch = mock(
      createMockFetch(emptyResponse(), jsonResponse({ hash: "hash" })),
    );

    const api = await remarkable("");
    const res = await api.rename(repHash("1234abcd"), "new name");

    expect(res.hash).toBe("hash");
  });

  test("#bulkMove()", async () => {
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        jsonResponse({ hashes: { oldHash: "newHash" } }),
      ),
    );

    const api = await remarkable("");
    const res = await api.bulkMove([repHash("1234abcd")], "");

    expect("oldHash" in res.hashes).toBeTrue();
  });

  test("#bulkDelete()", async () => {
    globalThis.fetch = createMockFetch(
      emptyResponse(),
      jsonResponse({ hashes: { oldHash: "newHash" } }),
    );

    const api = await remarkable("");
    const res = await api.bulkDelete([repHash("1234abcd")]);

    expect("oldHash" in res.hashes).toBeTrue();
  });

  test("#pruneCache()", async () => {
    const entryHash = repHash("1");
    const file = `3
${entryHash}:80000000:document:1:1
`;
    const fileHash = repHash("2");
    const ent = `3
${fileHash}:0:document.content:0:1
`;
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        jsonResponse({
          hash: repHash("0"),
          generation: 0,
          schemaVersion: 3,
        }),
        textResponse(file),
        textResponse(ent),
      ),
    );

    const api = await remarkable("");
    await api.pruneCache();
  });

  test("#dumpCache()", async () => {
    const file = `3
hash:80000000:document:0:1
hash2:80000000:other:0:2
`;
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        jsonResponse({
          hash: repHash("0"),
          generation: 0,
          schemaVersion: 3,
        }),
        textResponse(file),
      ),
    );

    const api = await remarkable("");
    await api.listIds();
    expect(api.dumpCache().length).toBeGreaterThan(0);

    api.clearCache();
    expect(api.dumpCache()).toHaveLength(2);
  });

  test("request fail", async () => {
    globalThis.fetch = createMockFetch(emptyResponse(), jsonResponse([{}]));

    const api = await remarkable("");
    expect(api.listItems()).rejects.toThrow("Validation errors:");
  });

  test("response fail", async () => {
    globalThis.fetch = mock(
      createMockFetch(
        emptyResponse(),
        textResponse("fail", { status: 400, statusText: "bad request" }),
      ),
    );

    const api = await remarkable("");
    expect(api.listItems()).rejects.toThrow("failed reMarkable request:");
  });

  test("verification fail", async () => {
    globalThis.fetch = createMockFetch(emptyResponse(), jsonResponse([{}]));

    const api = await remarkable("");
    expect(api.listItems()).rejects.toThrow("Validation errors:");
  });
});

test("ValidationError()", () => {
  const error = new ValidationError("incorrect hash", /./, "message");
  expect(error.field).toBe("incorrect hash");
});
