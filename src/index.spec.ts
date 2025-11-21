import { describe, expect, test } from "bun:test";
import {
  auth,
  type Content,
  type DocumentContent,
  type Entry,
  type Metadata,
  register,
  remarkable,
  session,
  type TemplateContent,
} from ".";
import {
  bytesResponse,
  emptyResponse,
  jsonResponse,
  mockFetch,
  textResponse,
} from "./test-utils";

function repHash(hash: string): string {
  const mult = 64 / hash.length;
  return new Array(mult).fill(hash).join("");
}

describe("register()", () => {
  test("success", async () => {
    const fetch = mockFetch(textResponse("custom device token"));

    const token = await register("academic");
    expect(token).toBe("custom device token");
    expect(fetch.mock.calls).toHaveLength(1);
    const [first] = fetch.mock.calls;
    expect(first).toBeDefined();
  });

  test("invalid", () => {
    mockFetch();
    expect(register("")).rejects.toThrow("code should be length 8, but was 0");
  });

  test("error", () => {
    mockFetch(emptyResponse({ status: 400, statusText: "custom error" }));

    expect(register("academic")).rejects.toThrow("couldn't register api");
  });
});

describe("auth()", () => {
  test("success", async () => {
    const fetch = mockFetch(textResponse("custom session token"));

    const token = await auth("custom device token");
    expect(token).toBe("custom session token");
    expect(fetch.mock.calls).toHaveLength(1);
    const [first] = fetch.mock.calls;
    const [, init] = first ?? [];
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer custom device token",
    );
  });

  test("error", () => {
    mockFetch(emptyResponse({ status: 400 }));
    expect(auth("")).rejects.toThrow("couldn't fetch auth token");
  });
});

describe("remarkable", () => {
  describe("remarkable()", () => {
    test("success", async () => {
      const fetch = mockFetch(textResponse("custom session token"));

      await remarkable("custom device token");
      expect(fetch.mock.calls).toHaveLength(1);
      const [first] = fetch.mock.calls;
      const [, init] = first ?? [];
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer custom device token",
      );
    });

    test("error", () => {
      mockFetch(emptyResponse({ status: 400 }));
      expect(remarkable("")).rejects.toThrow("couldn't fetch auth token");
    });
  });

  describe("session()", () => {
    test("uses provided token and skips exchange", () => {
      const fetch = mockFetch();

      const api = session("cached session token");
      expect(fetch.mock.calls).toHaveLength(0);
      expect(api.raw).toBeDefined();
    });

    test("throws when cache is invalid", () => {
      mockFetch();

      expect(() => session("token", { cache: "42" })).toThrow(
        "cache was not a valid cache (json string mapping)",
      );
    });
  });

  test("#listItems()", async () => {
    const docId = "document";
    const templateId = "template";
    const entryHash = repHash("1");
    const metaHash = repHash("2");
    const contentHash = repHash("3");
    const templateEntryHash = repHash("4");
    const templateMetaHash = repHash("5");
    const templateContentHash = repHash("6");
    const rootEntries = `3
${entryHash}:80000000:${docId}:4:3
${templateEntryHash}:80000000:${templateId}:4:3
`;
    const docEntries = `3
${contentHash}:0:${docId}.content:0:1
${metaHash}:0:${docId}.metadata:0:1
fake_hash:0:${docId}.epub:0:1
`;
    const templateEntries = `3
${templateContentHash}:0:${templateId}.content:0:1
${templateMetaHash}:0:${templateId}.metadata:0:1
fake_template_hash:0:${docId}.template:0:1
`;
    const content: DocumentContent = {
      coverPageNumber: 0,
      documentMetadata: {},
      extraMetadata: {},
      fileType: "epub",
      fontName: "",
      formatVersion: 0,
      lineHeight: 0,
      margins: 0,
      orientation: "portrait",
      pageCount: 0,
      sizeInBytes: "",
      textAlignment: "justify",
      textScale: 0,
    };
    const metadata: Metadata = {
      lastModified: "",
      parent: "",
      pinned: false,
      type: "DocumentType",
      visibleName: "doc name",
    };
    const templateMetadata: Metadata = {
      createdTime: "",
      lastModified: "",
      new: false,
      parent: "",
      pinned: false,
      source: "mock",
      type: "TemplateType",
      visibleName: "Template",
    };
    const templateContent: TemplateContent = {
      author: "",
      categories: ["a", "b"],
      formatVersion: 1,
      iconData: "",
      labels: [],
      name: "Template",
      orientation: "portrait",
      supportedScreens: ["rm2", "rmPP"],
      templateVersion: "0.0.1",
      constants: [{ a: 1 }],
      items: [
        {
          type: "group",
          id: "a",
          boundingBox: { x: 0, y: 0, width: 1, height: 1 },
          children: [],
        },
      ],
    };
    const expected: Entry = {
      id: docId,
      hash: entryHash,
      pinned: metadata.pinned,
      type: metadata.type,
      lastOpened: "",
      lastModified: metadata.lastModified,
      fileType: content.fileType,
      visibleName: metadata.visibleName,
      parent: metadata.parent,
      tags: content.tags,
    };

    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }),
      textResponse(rootEntries),
      textResponse(docEntries),
      textResponse(templateEntries),
      jsonResponse(metadata),
      jsonResponse(content),
      jsonResponse(templateMetadata),
      jsonResponse(templateContent),
    );

    const api = await remarkable("");
    const [loaded] = await api.listItems();
    expect(loaded).toEqual(expected);
  });

  test("#getMetadata() accepts lastOpenedPage -1", async () => {
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
      lastOpenedPage: -1,
    };
    mockFetch(emptyResponse(), textResponse(file), jsonResponse(metadata));

    const api = await remarkable("");
    const meta = await api.getMetadata(repHash("0"));
    expect(meta).toEqual(metadata);
  });

  test("#listIds()", async () => {
    const file = `3
hash:80000000:document:0:1
hash2:80000000:other:0:2
`;
    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }),
      textResponse(file),
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

  describe("#getContent()", () => {
    test("DocumentType", async () => {
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
      mockFetch(emptyResponse(), textResponse(file), jsonResponse(content));

      const api = await remarkable("");
      const cont = await api.getContent(repHash("0"));
      expect(cont).toEqual(content);
    });

    test("handles empty textAlignment and null pages", async () => {
      const realHash = repHash("1");
      const file = `3
${realHash}:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.pdf:0:1
`;
      const content: DocumentContent = {
        fileType: "pdf",
        coverPageNumber: -1,
        documentMetadata: {},
        extraMetadata: {},
        fontName: "",
        lineHeight: -1,
        orientation: "portrait",
        pageCount: 0,
        pages: null,
        sizeInBytes: "",
        textAlignment: "",
        textScale: 1,
      };
      mockFetch(emptyResponse(), textResponse(file), jsonResponse(content));

      const api = await remarkable("");
      const cont = (await api.getContent(repHash("0"))) as DocumentContent;
      expect(cont).toEqual(content);
    });

    test("TemplateType", async () => {
      const realHash = repHash("1");
      const file = `3
${realHash}:0:tpl.content:0:1
hash:0:tpl.metadata:0:1
hash:0:tpl.template:0:1
`;
      const content: TemplateContent = {
        author: "",
        categories: ["a", "b"],
        formatVersion: 1,
        iconData: "",
        labels: [],
        name: "Template",
        orientation: "portrait",
        supportedScreens: ["rm2", "rmPP"],
        templateVersion: "0.0.1",
        constants: [{ a: 1 }],
        items: [
          {
            type: "group",
            id: "a",
            boundingBox: { x: 0, y: 0, width: 1, height: 1 },
            children: [],
          },
        ],
      };
      mockFetch(emptyResponse(), textResponse(file), jsonResponse(content));

      const api = await remarkable("");
      const cont = await api.getContent(repHash("0"));
      expect(cont).toEqual(content);
    });

    test("Validation Error", async () => {
      const realHash = repHash("1");
      const file = `3
${realHash}:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.epub:0:1
`;
      mockFetch(
        emptyResponse(),
        textResponse(file),
        jsonResponse({ foo: "bar" }),
      );

      const api = await remarkable("");
      expect(api.getContent(repHash("0"))).rejects.toThrow("\nor\n");
    });
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
    mockFetch(emptyResponse(), textResponse(file), jsonResponse(metadata));

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
    mockFetch(emptyResponse(), textResponse(file), bytesResponse(pdf));

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
    mockFetch(emptyResponse(), textResponse(file), bytesResponse(epub));

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
    mockFetch(
      emptyResponse(),
      textResponse(file),
      jsonResponse(content),
      jsonResponse(metadata),
      bytesResponse(epub),
    );

    const api = await remarkable("");
    const bytes = await api.getDocument(repHash("0"));
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("#uploadPdf()", async () => {
    const enc = new TextEncoder();
    const pdf = enc.encode("pdf content");
    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("1"),
        docID: "fake pdf id",
      }),
    );

    const api = await remarkable("");
    const res = await api.uploadPdf("new name", pdf);

    expect(res.id).toBe("fake pdf id");
    expect(res.hash).toHaveLength(64);
  });

  /** test that hash matches https://github.com/erikbrinkman/rmapi-js/issues/25#issuecomment-3526745194 */
  test("#putEntries() v4", async () => {
    mockFetch(
      emptyResponse(),
      emptyResponse(), // put entry
    );
    const api = await remarkable("");
    const [entry, prom] = await api.raw.putEntries(
      "043eccc1-35a8-467b-a5f3-7196cb1f57d2",
      [
        {
          type: 0,
          id: "043eccc1-35a8-467b-a5f3-7196cb1f57d2.metadata",
          hash: "25aaaed381540046fce6defef9aa30faa7c0bcacffe42f5cef99643ae66ddfc1",
          subfiles: 0,
          size: 219,
        },
      ],
      4,
    );
    expect(entry.hash).toBe(
      "3c89dd3036f0b335188659d4f7139fcfd906167d99729d638af956906b647646",
    );
    await prom;
  });

  test("#putPdf()", async () => {
    const enc = new TextEncoder();
    const pdf = enc.encode("pdf content");
    mockFetch(
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
    );

    const api = await remarkable("");
    const res = await api.putPdf("new name", pdf);

    expect(res.id).toHaveLength(36);
    expect(res.hash).toHaveLength(64);
  });

  test("#uploadEpub()", async () => {
    const enc = new TextEncoder();
    const epub = enc.encode("epub content");
    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("1"),
        docID: "fake epub id",
      }),
    );

    const api = await remarkable("");
    const res = await api.uploadEpub("new name", epub);

    expect(res.id).toBe("fake epub id");
    expect(res.hash).toHaveLength(64);
  });

  test("#putEpub()", async () => {
    const enc = new TextEncoder();
    const epub = enc.encode("epub content");
    mockFetch(
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
    );

    const api = await remarkable("");
    const res = await api.putEpub("new name", epub);

    expect(res.id).toHaveLength(36);
    expect(res.hash).toHaveLength(64);
  });

  test("#createFolder()", async () => {
    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("abcd0123"),
        generation: 0,
        schemaVersion: 3,
      }),
      emptyResponse(), // .content
      emptyResponse(), // .metadata
      textResponse("3\n"),
      emptyResponse(), // .docSchema
      emptyResponse(), // root.docSchema
      jsonResponse({
        hash: repHash("1"),
        generation: 1,
      }), // root hash
    );

    const api = await remarkable("");
    const res = await api.putFolder("new folder");

    expect(res.id).toHaveLength(36);
    expect(res.hash).toHaveLength(64);
  });

  test("#stared()", async () => {
    const moveHash = repHash("1");
    const oldMeta: Metadata = {
      lastModified: "",
      visibleName: "test",
      parent: "",
      pinned: false,
      type: "DocumentType",
    };

    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }), // root hash
      textResponse(`3\n${moveHash}:80000000:fake_id:2:123\n`), // root entries
      textResponse(
        `3\n${repHash("2")}:0:fake_id.metadata:0:1\n${repHash("3")}:0:fake_id.content:0:122\n`,
      ), // item entries
      jsonResponse(oldMeta), // get metadata
      emptyResponse(), // put metadata
      emptyResponse(), // put entries
      emptyResponse(), // put root entries
      jsonResponse({
        hash: repHash("1"),
        generation: 1,
      }), // root hash
    );

    const api = await remarkable("");
    const res = await api.stared(moveHash, true);

    expect(res.hash).toHaveLength(64);
  });

  test("#move()", async () => {
    const moveHash = repHash("1");
    const oldMeta: Metadata = {
      lastModified: "",
      visibleName: "test",
      parent: "",
      pinned: false,
      type: "DocumentType",
    };

    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }), // root hash
      textResponse(`3\n${moveHash}:80000000:fake_id:2:123\n`), // root entries
      textResponse(
        `3\n${repHash("2")}:0:fake_id.metadata:0:1\n${repHash("3")}:0:fake_id.content:0:122\n`,
      ), // item entries
      jsonResponse(oldMeta), // get metadata
      emptyResponse(), // put metadata
      emptyResponse(), // put entries
      emptyResponse(), // put root entries
      jsonResponse({
        hash: repHash("1"),
        generation: 1,
      }), // root hash
    );

    const api = await remarkable("");
    const res = await api.move(moveHash, "trash");

    expect(res.hash).toHaveLength(64);
  });

  test("#move() failure", async () => {
    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }), // root hash
      textResponse("3\n"), // root entries
    );

    const api = await remarkable("");
    expect(api.move(repHash("23"), "trash")).rejects.toThrow(
      "not found in the root hash",
    );
  });

  test("#delete()", async () => {
    const deleteHash = repHash("1");
    const oldMeta: Metadata = {
      lastModified: "",
      visibleName: "test",
      parent: "",
      pinned: false,
      type: "DocumentType",
    };

    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }), // root hash
      textResponse(`3\n${deleteHash}:80000000:fake_id:2:123\n`), // root entries
      textResponse(
        `3\n${repHash("2")}:0:fake_id.metadata:0:1\n${repHash("3")}:0:fake_id.content:0:122\n`,
      ), // item entries
      jsonResponse(oldMeta), // get metadata
      emptyResponse(), // put metadata
      emptyResponse(), // put entries
      emptyResponse(), // put root entries
      jsonResponse({
        hash: repHash("1"),
        generation: 1,
      }), // root hash
    );

    const api = await remarkable("");
    const res = await api.delete(deleteHash);

    expect(res.hash).toHaveLength(64);
  });

  test("#rename()", async () => {
    const moveHash = repHash("1");
    const oldMeta: Metadata = {
      lastModified: "",
      visibleName: "test",
      parent: "",
      pinned: false,
      type: "DocumentType",
    };

    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }), // root hash
      textResponse(`3\n${moveHash}:80000000:fake_id:2:123\n`), // root entries
      textResponse(
        `3\n${repHash("2")}:0:fake_id.metadata:0:1\n${repHash("3")}:0:fake_id.content:0:122\n`,
      ), // item entries
      jsonResponse(oldMeta), // get metadata
      emptyResponse(), // put metadata
      emptyResponse(), // put entries
      emptyResponse(), // put root entries
      jsonResponse({
        hash: repHash("1"),
        generation: 1,
      }), // root hash
    );

    const api = await remarkable("");
    const res = await api.rename(moveHash, "renamed");

    expect(res.hash).toHaveLength(64);
  });

  test("#bulkMove()", async () => {
    const moveHash = repHash("1");
    const oldMeta: Metadata = {
      lastModified: "",
      visibleName: "test",
      parent: "",
      pinned: false,
      type: "DocumentType",
    };

    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }), // root hash
      textResponse(`3\n${moveHash}:80000000:fake_id:2:123\n`), // root entries
      textResponse(
        `3\n${repHash("2")}:0:fake_id.metadata:0:1\n${repHash("3")}:0:fake_id.content:0:122\n`,
      ), // item entries
      jsonResponse(oldMeta), // get metadata
      emptyResponse(), // put metadata
      emptyResponse(), // put entries
      emptyResponse(), // put root entries
      jsonResponse({
        hash: repHash("1"),
        generation: 1,
      }), // root hash
    );

    const api = await remarkable("");
    const res = await api.bulkMove([moveHash], "");

    expect(moveHash in res.hashes).toBeTrue();
  });

  test("#bulkDelete()", async () => {
    const moveHash = repHash("1");
    const oldMeta: Metadata = {
      lastModified: "",
      visibleName: "test",
      parent: "",
      pinned: false,
      type: "DocumentType",
    };

    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }), // root hash
      textResponse(`3\n${moveHash}:80000000:fake_id:2:123\n`), // root entries
      textResponse(
        `3\n${repHash("2")}:0:fake_id.metadata:0:1\n${repHash("3")}:0:fake_id.content:0:122\n`,
      ), // item entries
      jsonResponse(oldMeta), // get metadata
      emptyResponse(), // put metadata
      emptyResponse(), // put entries
      emptyResponse(), // put root entries
      jsonResponse({
        hash: repHash("1"),
        generation: 1,
      }), // root hash
    );

    const api = await remarkable("");
    const res = await api.bulkDelete([moveHash]);

    expect(moveHash in res.hashes).toBeTrue();
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
    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }),
      textResponse(file),
      textResponse(ent),
    );

    const api = await remarkable("");
    await api.pruneCache();
  });

  test("#dumpCache()", async () => {
    const file = `3
hash:80000000:document:0:1
hash2:80000000:other:0:2
`;
    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("0"),
        generation: 0,
        schemaVersion: 3,
      }),
      textResponse(file),
    );

    const api = await remarkable("");
    await api.listIds();
    expect(api.dumpCache().length).toBeGreaterThan(0);

    api.clearCache();
    expect(api.dumpCache()).toHaveLength(2);
  });

  test("validation fail", async () => {
    mockFetch(emptyResponse());

    const api = await remarkable("");
    expect(api.putFolder("test", { parent: "invalid" })).rejects.toThrow(
      "parent must be a valid document id",
    );
  });

  test("generation fail", async () => {
    mockFetch(
      emptyResponse(),
      textResponse('{"message":"precondition failed"}\n', { status: 400 }),
    );

    const api = await remarkable("");
    expect(api.raw.putRootHash(repHash("ab01"), 0)).rejects.toThrow(
      "root generation was stale; try put again",
    );
  });

  test("request fail", async () => {
    mockFetch(emptyResponse(), jsonResponse([{}]));

    const api = await remarkable("");
    expect(api.listItems()).rejects.toThrow("Validation errors:");
  });

  test("response fail", async () => {
    mockFetch(
      emptyResponse(),
      textResponse("fail", { status: 400, statusText: "bad request" }),
    );

    const api = await remarkable("");
    expect(api.listItems()).rejects.toThrow("failed reMarkable request:");
  });

  test("verification fail", async () => {
    mockFetch(emptyResponse(), jsonResponse([{}]));

    const api = await remarkable("");
    expect(api.listItems()).rejects.toThrow("Validation errors:");
  });
});
