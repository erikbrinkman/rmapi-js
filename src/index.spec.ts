import { describe, expect, spyOn, test } from "bun:test";
import JSZip from "jszip";
import {
  auth,
  type Content,
  type DocumentContent,
  type Entry,
  type Highlight,
  type LegacyCollectionContent,
  type LegacyDocumentContent,
  type Metadata,
  type PageMetadata,
  type RmPageV5,
  register,
  remarkable,
  session,
  type TemplateContent,
} from "./index.js";
import {
  bytesResponse,
  emptyResponse,
  jsonResponse,
  mockFetch,
  textResponse,
} from "./test-utils.js";

function repHash(hash: string): string {
  const mult = 64 / hash.length;
  return new Array(mult).fill(hash).join("");
}

function pdfContent(pages: string[]): DocumentContent {
  return {
    fileType: "pdf",
    coverPageNumber: -1,
    documentMetadata: {},
    extraMetadata: {},
    fontName: "",
    lineHeight: -1,
    orientation: "portrait",
    pageCount: pages.length,
    pages,
    sizeInBytes: "1",
    textAlignment: "left",
    textScale: 1,
  };
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
        "cache was neither a version 2 dump nor the original mapping",
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
      createdTime: "2024-01-02T03:04:05Z",
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

    const expectedTemplate: Entry = {
      id: templateId,
      hash: templateEntryHash,
      visibleName: templateMetadata.visibleName,
      lastModified: templateMetadata.lastModified,
      new: templateMetadata.new,
      pinned: templateMetadata.pinned,
      source: templateMetadata.source,
      parent: templateMetadata.parent,
      createdTime: templateMetadata.createdTime,
      type: "TemplateType",
    };

    const api = await remarkable("");
    const [loaded, template] = await api.listItems();
    expect(loaded).toEqual(expected);
    expect(template).toEqual(expectedTemplate);
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
    const meta = await api.getMetadata({ id: "test-id", hash: repHash("0") });
    expect(meta).toEqual(metadata);
  });

  test("#getMetadata() accepts missing lastModified", async () => {
    const realHash = repHash("1");
    const file = `3
hash:0:doc.content:0:1
${realHash}:0:doc.metadata:0:1
`;
    const metadata: Metadata = {
      visibleName: "name",
      parent: "",
      type: "CollectionType",
      pinned: false,
    };
    mockFetch(emptyResponse(), textResponse(file), jsonResponse(metadata));

    const api = await remarkable("");
    const meta = await api.getMetadata({ id: "test-id", hash: repHash("0") });
    expect(meta).toEqual(metadata);
  });

  test("#getMetadata() accepts null legacy boolean fields", async () => {
    const realHash = repHash("1");
    const file = `3
${realHash}:0:doc.metadata:0:1
`;
    const metadata: Metadata = {
      lastModified: "0",
      visibleName: "name",
      parent: "",
      type: "DocumentType",
      pinned: false,
      deleted: null,
      metadatamodified: null,
      modified: null,
      synced: null,
    };
    mockFetch(emptyResponse(), textResponse(file), jsonResponse(metadata));

    const api = await remarkable("");
    const meta = await api.getMetadata({ id: "test-id", hash: repHash("0") });
    expect(meta).toEqual(metadata);
  });

  test("#listRefs()", async () => {
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
    const [first, second] = await api.listRefs();
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
      const cont = await api.getContent({ id: "test-id", hash: repHash("0") });
      expect(cont).toEqual(content);
    });

    test("CollectionType legacy tags", async () => {
      const realHash = repHash("1");
      const file = `3
${realHash}:0:col.content:0:1
`;
      const content: LegacyCollectionContent = {
        tags: ["Remarcal", "calendar"],
      };

      mockFetch(emptyResponse(), textResponse(file), jsonResponse(content));

      const api = await remarkable("");
      const cont = await api.getContent({ id: "col", hash: repHash("0") });
      expect(cont).toEqual(content);
    });

    test("DocumentType legacy tags", async () => {
      const realHash = repHash("1");
      const file = `3
${realHash}:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.pdf:0:1
`;
      const content: LegacyDocumentContent = {
        fileType: "pdf",
        coverPageNumber: -1,
        documentMetadata: {},
        extraMetadata: {},
        fontName: "",
        lineHeight: -1,
        orientation: "portrait",
        pageCount: 1,
        sizeInBytes: "1",
        tags: ["Remarcal", "calendar"],
        textAlignment: "left",
        textScale: 1,
      };

      mockFetch(emptyResponse(), textResponse(file), jsonResponse(content));

      const api = await remarkable("");
      const cont = await api.getContent({ id: "doc", hash: repHash("0") });
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
      const cont = (await api.getContent({
        id: "test-id",
        hash: repHash("0"),
      })) as DocumentContent;
      expect(cont).toEqual(content);
    });

    test("handles empty transform object", async () => {
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
        pageCount: 1,
        sizeInBytes: "1",
        textAlignment: "left",
        textScale: 1,
        transform: {},
      };
      mockFetch(emptyResponse(), textResponse(file), jsonResponse(content));

      const api = await remarkable("");
      const cont = (await api.getContent({
        id: "test-id",
        hash: repHash("0"),
      })) as DocumentContent;
      expect(cont.fileType).toBe("pdf");
      expect(cont.transform ?? {}).toEqual({});
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
      const cont = await api.getContent({ id: "test-id", hash: repHash("0") });
      expect(cont).toEqual(content);
    });

    test("TemplateType without constants", async () => {
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
        items: [],
      };
      mockFetch(emptyResponse(), textResponse(file), jsonResponse(content));

      const api = await remarkable("");
      const cont = await api.getContent({ id: "test-id", hash: repHash("0") });
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
      expect(
        api.getContent({ id: "test-id", hash: repHash("0") }),
      ).rejects.toThrow();
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
    const meta = await api.getMetadata({ id: "test-id", hash: repHash("0") });
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
    const bytes = await api.getPdf({ id: "test-id", hash: repHash("0") });
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
    const bytes = await api.getEpub({ id: "test-id", hash: repHash("0") });
    expect(bytes).toEqual(epub);
  });

  test("#getHighlights()", async () => {
    const contentHash = repHash("1");
    const highlightsHash = repHash("2");
    const file = `3
${contentHash}:0:test-id.content:0:1
${highlightsHash}:0:test-id.highlights/p1.json:0:1
`;
    const highlights = {
      highlights: [
        [
          {
            text: "hello world",
            color: 4,
            start: 10,
            length: 11,
            rects: [{ x: 1, y: 2, width: 3, height: 4 }],
          },
        ],
      ],
    };
    mockFetch(
      emptyResponse(),
      textResponse(file),
      jsonResponse(pdfContent(["p1"])),
      jsonResponse(highlights),
    );

    const api = await remarkable("");
    const hl = await api.getHighlights(
      { id: "test-id", hash: repHash("0") },
      "p1",
    );
    expect(hl).toEqual(highlights.highlights);
  });

  test("#getHighlights() returns undefined without a highlights file", async () => {
    const contentHash = repHash("1");
    const file = `3
${contentHash}:0:test-id.content:0:1
`;
    mockFetch(
      emptyResponse(),
      textResponse(file),
      jsonResponse(pdfContent(["p1"])),
    );

    const api = await remarkable("");
    const hl = await api.getHighlights(
      { id: "test-id", hash: repHash("0") },
      "p1",
    );
    expect(hl).toBeUndefined();
  });

  test("#getHighlights() throws for a page not in the document", async () => {
    const contentHash = repHash("1");
    const file = `3
${contentHash}:0:test-id.content:0:1
`;
    mockFetch(
      emptyResponse(),
      textResponse(file),
      jsonResponse(pdfContent(["p1"])),
    );

    const api = await remarkable("");
    await expect(
      api.getHighlights({ id: "test-id", hash: repHash("0") }, "p2"),
    ).rejects.toThrow("document test-id has no page p2");
  });

  const putHighlightsMocks = (docId: string, docHash: string) => {
    const contentHash = repHash("2");
    return [
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(`3\n${docHash}:80000000:${docId}:1:1\n`),
      textResponse(`3\n${contentHash}:0:${docId}.content:0:1\n`),
      jsonResponse(pdfContent(["p1"])),
      emptyResponse(), // the highlights file
      emptyResponse(), // the document index
      emptyResponse(), // the root index
      jsonResponse({ hash: repHash("3"), generation: 1 }),
    ] as const;
  };

  test("#putHighlights()", async () => {
    const docId = "test-id";
    const docHash = repHash("1");
    const highlights: Highlight[][] = [
      [
        {
          text: "hello world",
          color: 4,
          start: 10,
          length: 11,
          rects: [{ x: 1, y: 2, width: 3, height: 4 }],
        },
      ],
    ];
    const fetch = mockFetch(...putHighlightsMocks(docId, docHash));

    const api = await remarkable("");
    const next = await api.putHighlights(
      { id: docId, hash: docHash },
      "p1",
      highlights,
    );
    expect(next.id).toBe(docId);
    expect(next.hash).toHaveLength(64);

    const dec = new TextDecoder();
    const written = fetch.mock.calls
      .map(([, init]) => init?.body)
      .map((body) =>
        body instanceof Uint8Array ? dec.decode(body) : String(body ?? ""),
      );

    const highlightsFile = written.find((body) => body.startsWith("{"));
    expect(highlightsFile).toBeDefined();
    expect(JSON.parse(highlightsFile!)).toEqual({ highlights });

    // the new file is added to the document index, which reaches the root index
    const docIndex = written.find((body) =>
      body.includes(`${docId}.highlights/p1.json`),
    );
    expect(docIndex).toBeDefined();
    expect(written.some((body) => body.includes(`:${docId}:`))).toBe(true);
  });

  test("#putHighlights() doesn't write a root hash when an upload fails", async () => {
    const docId = "test-id";
    const docHash = repHash("1");
    const mocks = putHighlightsMocks(docId, docHash);
    const fetch = mockFetch(
      ...mocks.slice(0, 5),
      emptyResponse({ status: 400, statusText: "Bad Request" }), // the highlights file
      ...mocks.slice(6),
    );

    const api = await remarkable("");
    await expect(
      api.putHighlights({ id: docId, hash: docHash }, "p1", []),
    ).rejects.toThrow("failed reMarkable request");

    const roots = fetch.mock.calls.filter(
      ([url, init]) => init?.method === "PUT" && String(url).endsWith("/root"),
    );
    expect(roots).toHaveLength(0);
  });

  test("#putHighlights() throws for a page not in the document", async () => {
    const docId = "test-id";
    const docHash = repHash("1");
    mockFetch(...putHighlightsMocks(docId, docHash));

    const api = await remarkable("");
    await expect(
      api.putHighlights({ id: docId, hash: docHash }, "p2", []),
    ).rejects.toThrow("document test-id has no page p2");
  });

  test("#putHighlightPages() writes every page in one commit", async () => {
    const docId = "test-id";
    const docHash = repHash("1");
    const contentHash = repHash("2");
    const one: Highlight[][] = [
      [{ text: "one", color: 1, start: 0, length: 3, rects: [] }],
    ];
    const two: Highlight[][] = [
      [{ text: "two", color: 2, start: 4, length: 3, rects: [] }],
    ];
    const fetch = mockFetch(
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(`3\n${docHash}:80000000:${docId}:1:1\n`),
      textResponse(`3\n${contentHash}:0:${docId}.content:0:1\n`),
      jsonResponse(pdfContent(["p1", "p2"])),
      emptyResponse(), // p1 highlights
      emptyResponse(), // p2 highlights
      emptyResponse(), // the document index
      emptyResponse(), // the root index
      jsonResponse({ hash: repHash("3"), generation: 1 }),
    );

    const api = await remarkable("");
    const next = await api.putHighlightPages(
      { id: docId, hash: docHash },
      new Map([
        ["p1", one],
        ["p2", two],
      ]),
    );
    expect(next.id).toBe(docId);

    const dec = new TextDecoder();
    const written = fetch.mock.calls
      .map(([, init]) => init?.body)
      .map((body) =>
        body instanceof Uint8Array ? dec.decode(body) : String(body ?? ""),
      );

    const files = written.filter((body) => body.startsWith('{"highlights"'));
    expect(files).toHaveLength(2);
    // the two uploads race, so order isn't meaningful
    expect(files.map((body) => JSON.parse(body))).toEqual(
      expect.arrayContaining([{ highlights: one }, { highlights: two }]),
    );

    const docIndex = written.find((body) =>
      body.includes(`${docId}.highlights/p1.json`),
    );
    expect(docIndex).toContain(`${docId}.highlights/p2.json`);

    // one root-hash put, so the two pages land as a single atomic change
    const rootPuts = fetch.mock.calls.filter(([url]) =>
      `${url}`.includes("sync/v4/root"),
    );
    expect(rootPuts).toHaveLength(1);
  });

  test("#putHighlightPages() with nothing to write makes no requests", async () => {
    const fetch = mockFetch(emptyResponse());
    const api = await remarkable("");
    const ref = { id: "test-id", hash: repHash("1") };

    expect(await api.putHighlightPages(ref, new Map())).toEqual(ref);
    expect(fetch.mock.calls).toHaveLength(1);
  });

  test("#getTemplate() parses a sidecar with mixed constants", async () => {
    const realHash = repHash("1");
    const file = `3
hash:0:test-id.content:0:1
${realHash}:0:test-id.template:0:1
`;
    const template = {
      name: "Grid",
      author: "reMarkable",
      iconData: "",
      categories: ["Life/organize"],
      orientation: "portrait",
      templateVersion: "1.0",
      items: [],
      constants: [{ marginSmall: 14, label: "top" }],
    };
    mockFetch(emptyResponse(), textResponse(file), jsonResponse(template));

    const api = await remarkable("");
    const templ = await api.getTemplate({ id: "test-id", hash: repHash("0") });
    expect(templ?.name).toBe("Grid");
    expect(templ?.constants).toEqual([{ marginSmall: 14, label: "top" }]);
  });

  test("#putTemplate()", async () => {
    const docId = "test-id";
    const docHash = repHash("1");
    const template: TemplateContent = {
      author: "",
      categories: ["a"],
      iconData: "",
      items: [],
      labels: [],
      name: "Grid",
      orientation: "portrait",
      supportedScreens: ["rm2"],
      templateVersion: "1.0",
    };
    const fetch = mockFetch(
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(`3\n${docHash}:80000000:${docId}:1:1\n`),
      textResponse(`3\n${repHash("2")}:0:${docId}.content:0:1\n`),
      emptyResponse(), // the template file
      emptyResponse(), // the document index
      emptyResponse(), // the root index
      jsonResponse({ hash: repHash("3"), generation: 1 }),
    );

    const api = await remarkable("");
    const next = await api.putTemplate({ id: docId, hash: docHash }, template);
    expect(next.id).toBe(docId);

    const dec = new TextDecoder();
    const written = fetch.mock.calls
      .map(([, init]) => init?.body)
      .map((body) =>
        body instanceof Uint8Array ? dec.decode(body) : String(body ?? ""),
      );
    const file = written.find((body) => body.startsWith("{"));
    expect(JSON.parse(file!)).toEqual(template);
    expect(written.some((body) => body.includes(`${docId}.template`))).toBe(
      true,
    );
  });

  test("#putTemplate() rejects a bad file name", async () => {
    mockFetch(emptyResponse());
    const api = await remarkable("");
    await expect(
      api.raw.putTemplate("doc.content", {} as TemplateContent),
    ).rejects.toThrow("did not end with '.template'");
  });

  test("#getPagedata() splits lines and drops the trailing newline", async () => {
    const realHash = repHash("1");
    const file = `3
hash:0:test-id.content:0:1
${realHash}:0:test-id.pagedata:0:1
`;
    mockFetch(
      emptyResponse(),
      textResponse(file),
      textResponse("Blank\nGrid\n\n"),
    );

    const api = await remarkable("");
    const pagedata = await api.getPagedata({
      id: "test-id",
      hash: repHash("0"),
    });
    expect(pagedata).toEqual(["Blank", "Grid", ""]);
  });

  test("#putPagedata()", async () => {
    const docId = "test-id";
    const docHash = repHash("1");
    const fetch = mockFetch(
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(`3\n${docHash}:80000000:${docId}:1:1\n`),
      textResponse(`3\n${repHash("2")}:0:${docId}.content:0:1\n`),
      emptyResponse(), // the pagedata file
      emptyResponse(), // the document index
      emptyResponse(), // the root index
      jsonResponse({ hash: repHash("3"), generation: 1 }),
    );

    const api = await remarkable("");
    const next = await api.putPagedata({ id: docId, hash: docHash }, [
      "Blank",
      "",
      "Grid",
    ]);
    expect(next.id).toBe(docId);

    const dec = new TextDecoder();
    const written = fetch.mock.calls
      .map(([, init]) => init?.body)
      .map((body) =>
        body instanceof Uint8Array ? dec.decode(body) : String(body ?? ""),
      );
    expect(written).toContain("Blank\n\nGrid\n");
    expect(written.some((body) => body.includes(`${docId}.pagedata`))).toBe(
      true,
    );
  });

  test("#putPagedata() round-trips through #getPagedata()", async () => {
    const templates = ["Blank", "", "Grid"];
    mockFetch(
      emptyResponse(),
      textResponse(`3\n${repHash("1")}:0:test-id.pagedata:0:1\n`),
      textResponse(`${templates.join("\n")}\n`),
    );

    const api = await remarkable("");
    expect(
      await api.getPagedata({ id: "test-id", hash: repHash("0") }),
    ).toEqual(templates);
  });

  test("#getPagedata() is undefined without a .pagedata", async () => {
    const file = `3\nhash:0:test-id.content:0:1\n`;
    mockFetch(emptyResponse(), textResponse(file));

    const api = await remarkable("");
    expect(
      await api.getPagedata({ id: "test-id", hash: repHash("0") }),
    ).toBeUndefined();
  });

  test("#getPageMetadata()", async () => {
    const contentHash = repHash("1");
    const realHash = repHash("2");
    const file = `3
${contentHash}:0:test-id.content:0:1
${realHash}:0:test-id/p1-metadata.json:0:1
`;
    const meta = { layers: [{ name: "Layer 1" }, { name: "Layer 2" }] };
    mockFetch(
      emptyResponse(),
      textResponse(file),
      jsonResponse(pdfContent(["p1"])),
      jsonResponse(meta),
    );

    const api = await remarkable("");
    const pm = await api.getPageMetadata(
      { id: "test-id", hash: repHash("0") },
      "p1",
    );
    expect(pm).toEqual(meta);
  });

  test("#getPageMetadata() throws for a page not in the document", async () => {
    const contentHash = repHash("1");
    const file = `3
${contentHash}:0:test-id.content:0:1
`;
    mockFetch(
      emptyResponse(),
      textResponse(file),
      jsonResponse(pdfContent(["p1"])),
    );

    const api = await remarkable("");
    await expect(
      api.getPageMetadata({ id: "test-id", hash: repHash("0") }, "p2"),
    ).rejects.toThrow("document test-id has no page p2");
  });

  test("#putPageMetadata()", async () => {
    const docId = "test-id";
    const docHash = repHash("1");
    const meta: PageMetadata = { layers: [{ name: "Layer 1" }] };
    const fetch = mockFetch(
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(`3\n${docHash}:80000000:${docId}:1:1\n`),
      textResponse(`3\n${repHash("2")}:0:${docId}.content:0:1\n`),
      jsonResponse(pdfContent(["p1"])),
      emptyResponse(), // the page metadata file
      emptyResponse(), // the document index
      emptyResponse(), // the root index
      jsonResponse({ hash: repHash("3"), generation: 1 }),
    );

    const api = await remarkable("");
    const next = await api.putPageMetadata(
      { id: docId, hash: docHash },
      "p1",
      meta,
    );
    expect(next.id).toBe(docId);

    const dec = new TextDecoder();
    const written = fetch.mock.calls
      .map(([, init]) => init?.body)
      .map((body) =>
        body instanceof Uint8Array ? dec.decode(body) : String(body ?? ""),
      );
    const file = written.find((body) => body.startsWith("{"));
    expect(JSON.parse(file!)).toEqual(meta);
    expect(
      written.some((body) => body.includes(`${docId}/p1-metadata.json`)),
    ).toBe(true);
  });

  test("#putPageMetadata() throws for a page not in the document", async () => {
    const docId = "test-id";
    const docHash = repHash("1");
    mockFetch(
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(`3\n${docHash}:80000000:${docId}:1:1\n`),
      textResponse(`3\n${repHash("2")}:0:${docId}.content:0:1\n`),
      jsonResponse(pdfContent(["p1"])),
    );

    const api = await remarkable("");
    await expect(
      api.putPageMetadata({ id: docId, hash: docHash }, "p2", { layers: [] }),
    ).rejects.toThrow("document test-id has no page p2");
  });

  test("#getPageMetadataPages()", async () => {
    const docId = "test-id";
    const meta: PageMetadata = { layers: [{ name: "Layer 1" }] };
    mockFetch(
      emptyResponse(),
      textResponse(
        `3\n${repHash("2")}:0:${docId}.content:0:1\n${repHash("3")}:0:${docId}/p2-metadata.json:0:1\n`,
      ),
      jsonResponse(pdfContent(["p1", "p2"])),
      jsonResponse(meta),
    );

    const api = await remarkable("");
    const pages = await api.getPageMetadataPages({
      id: docId,
      hash: repHash("0"),
    });
    expect([...pages.keys()]).toEqual(["p2"]);
    expect(pages.get("p2")).toEqual(meta);
  });

  test("#putRmPage()", async () => {
    const docId = "test-id";
    const docHash = repHash("1");
    const page: RmPageV5 = { version: 5, layers: [{ lines: [] }] };
    const fetch = mockFetch(
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(`3\n${docHash}:80000000:${docId}:1:1\n`),
      textResponse(`3\n${repHash("2")}:0:${docId}.content:0:1\n`),
      jsonResponse(pdfContent(["p1"])),
      emptyResponse(), // the .rm file
      emptyResponse(), // the document index
      emptyResponse(), // the root index
      jsonResponse({ hash: repHash("3"), generation: 1 }),
    );

    const api = await remarkable("");
    const next = await api.putRmPage({ id: docId, hash: docHash }, "p1", page);
    expect(next.id).toBe(docId);

    const dec = new TextDecoder();
    const written = fetch.mock.calls
      .map(([, init]) => init?.body)
      .map((body) =>
        body instanceof Uint8Array ? dec.decode(body) : String(body ?? ""),
      );
    expect(
      written.some((body) => body.startsWith("reMarkable .lines file")),
    ).toBe(true);
    expect(written.some((body) => body.includes(`${docId}/p1.rm`))).toBe(true);
  });

  test("#putRmPage() throws for a page not in the document", async () => {
    const docId = "test-id";
    const docHash = repHash("1");
    mockFetch(
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(`3\n${docHash}:80000000:${docId}:1:1\n`),
      textResponse(`3\n${repHash("2")}:0:${docId}.content:0:1\n`),
      jsonResponse(pdfContent(["p1"])),
    );

    const api = await remarkable("");
    await expect(
      api.putRmPage({ id: docId, hash: docHash }, "p2", {
        version: 5,
        layers: [],
      }),
    ).rejects.toThrow("document test-id has no page p2");
  });

  test("#getDocumentArchive()", async () => {
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
    const bytes = await api.getDocumentArchive({
      id: "test-id",
      hash: repHash("0"),
    });
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
    const entry = await api.raw.putEntries(
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
    await entry[Symbol.asyncDispose]();
  });

  /**
   * a schema 4 root index converts collection types from 80000000 to 0 and
   * hashes the full entry file
   */
  test("#putEntries() schema 4 root index", async () => {
    const fetch = mockFetch(
      emptyResponse(),
      emptyResponse(), // put root entry
    );
    const api = await remarkable("");
    const docId = "043eccc1-35a8-467b-a5f3-7196cb1f57d2";
    const docHash = repHash("1");
    const entry = await api.raw.putEntries(
      "root",
      [
        {
          type: 80000000,
          id: docId,
          hash: docHash,
          subfiles: 2,
          size: 219,
        },
      ],
      4,
    );
    await entry[Symbol.asyncDispose]();

    const expectedBody = `4\n0:.:1:219\n${docHash}:0:${docId}:2:219\n`;
    const enc = new TextEncoder();
    const digestBuff = await crypto.subtle.digest(
      "SHA-256",
      enc.encode(expectedBody),
    );
    const expectedHash = new Uint8Array(digestBuff).toHex();
    expect(entry.hash).toBe(expectedHash);
    expect(entry.type).toBe(0);

    const [, putCall] = fetch.mock.calls;
    expect(putCall).toBeDefined();
    const [url, init] = putCall!;
    expect(`${url}`).toContain(expectedHash);
    const dec = new TextDecoder();
    expect(dec.decode(init?.body as Uint8Array)).toBe(expectedBody);
  });

  test("#putHighlights()", async () => {
    const fetch = mockFetch(emptyResponse(), emptyResponse());
    const api = await remarkable("");
    const highlights: Highlight[][] = [
      [
        {
          text: "hello world",
          color: 4,
          start: 10,
          length: 11,
          rects: [{ x: 1, y: 2, width: 3, height: 4 }],
        },
      ],
    ];
    const entry = await api.raw.putHighlights(
      "test-id.highlights/p1.json",
      highlights,
    );
    await entry[Symbol.asyncDispose]();

    const [, putCall] = fetch.mock.calls;
    expect(putCall).toBeDefined();
    const [, init] = putCall!;
    const dec = new TextDecoder();
    expect(JSON.parse(dec.decode(init?.body as Uint8Array))).toEqual({
      highlights,
    });
    expect(await api.raw.getHighlights(entry)).toEqual(highlights);
  });

  test("#putHighlights() rejects a non-highlights file name", async () => {
    mockFetch(emptyResponse());
    const api = await remarkable("");
    await expect(api.raw.putHighlights("test-id.content", [])).rejects.toThrow(
      "fileName was not of the form",
    );
  });

  test("#putEntries() returns an entry #getEntries() can read", async () => {
    const docId = "043eccc1-35a8-467b-a5f3-7196cb1f57d2";
    const entry = {
      type: 0 as const,
      id: `${docId}.content`,
      hash: repHash("1"),
      subfiles: 0,
      size: 1,
    };
    const fetch = mockFetch(
      emptyResponse(),
      emptyResponse(),
      textResponse(`4\n0:${docId}:1:1\n${entry.hash}:0:${entry.id}:0:1\n`),
    );

    // no caching, so the read actually goes out
    const api = await remarkable("", { maxCachedBytes: 0 });
    const written = await api.raw.putEntries(docId, [entry], 4);
    await written[Symbol.asyncDispose]();

    // the id it hands back is the id getEntries takes
    const { entries } = await api.raw.getEntries(written);
    expect(entries).toEqual([entry]);

    // and the index's own file name reaches reMarkable, which validates it
    const [, , read] = fetch.mock.calls;
    expect(
      (read?.[1]?.headers as Record<string, string> | undefined)?.[
        "rm-filename"
      ],
    ).toBe(`${docId}.docSchema`);
  });

  test("#putEntries() sorts entries by code unit", async () => {
    const fetch = mockFetch(emptyResponse(), emptyResponse());
    const api = await remarkable("");
    const docId = "043eccc1-35a8-467b-a5f3-7196cb1f57d2";
    const pageId = "b6f2c1a0-1111-2222-3333-444455556666";
    const names = [
      `${docId}/${pageId}.rm`,
      `${docId}.metadata`,
      `${docId}.highlights/${pageId}.json`,
      `${docId}.content`,
    ];
    const entry = await api.raw.putEntries(
      docId,
      names.map((name, index) => ({
        type: 0 as const,
        id: name,
        hash: repHash(index.toFixed()),
        subfiles: 0,
        size: 1,
      })),
      4,
    );
    await entry[Symbol.asyncDispose]();

    const [, putCall] = fetch.mock.calls;
    expect(putCall).toBeDefined();
    const [, init] = putCall!;
    const dec = new TextDecoder();
    const written = dec
      .decode(init?.body as Uint8Array)
      .trimEnd()
      .split("\n")
      .slice(2)
      .map((line) => line.split(":")[2]);
    expect(written).toEqual([
      `${docId}.content`,
      `${docId}.highlights/${pageId}.json`,
      `${docId}.metadata`,
      `${docId}/${pageId}.rm`,
    ]);
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
      emptyResponse(), // .pagedata
      emptyResponse(), // .pdf
      emptyResponse(), // .docSchema (document index)
      textResponse("3\n"), // root entries
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
      emptyResponse(), // .pagedata
      emptyResponse(), // .epub
      emptyResponse(), // .docSchema (document index)
      textResponse("3\n"), // root entries
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
    const fetch = mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: repHash("abcd0123"),
        generation: 0,
        schemaVersion: 3,
      }),
      emptyResponse(), // .content
      emptyResponse(), // .metadata
      emptyResponse(), // .docSchema (document index)
      textResponse("3\n"), // root entries
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

    // even on a schema 3 account the root index must be written as schema 4
    // while the doc index keeps schema 3
    const dec = new TextDecoder();
    const bodies = fetch.mock.calls
      .map(([, init]) => init?.body)
      .filter((body) => body instanceof Uint8Array)
      .map((body) => dec.decode(body));
    expect(bodies.some((body) => body.startsWith("4\n0:.:"))).toBe(true);
    expect(bodies.some((body) => body.startsWith("3\n"))).toBe(true);
  });

  test("#star()", async () => {
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
    const res = await api.star({ id: "fake_id", hash: moveHash }, true);

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
    const res = await api.move({ id: "fake_id", hash: moveHash }, "trash");

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
    expect(
      api.move({ id: "missing", hash: repHash("23") }, "trash"),
    ).rejects.toThrow("not found in the root hash");
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
    const res = await api.delete({ id: "fake_id", hash: deleteHash });

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
    const res = await api.rename({ id: "fake_id", hash: moveHash }, "renamed");

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
    const res = await api.bulkMove([{ id: "fake_id", hash: moveHash }], "");

    expect(res).toHaveLength(1);
    expect(res[0]!.id).toBe("fake_id");
    expect(res[0]!.hash).toHaveLength(64);
  });

  test("#bulkMove() errors when a hash is gone", async () => {
    const staleHash = repHash("9");
    mockFetch(
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(`3\n${repHash("1")}:80000000:fake_id:2:123\n`),
    );

    const api = await remarkable("");
    await expect(
      api.bulkMove([{ id: "fake_id", hash: staleHash }], ""),
    ).rejects.toThrow(staleHash);
  });

  test("#rename() picks the entry matching both id and hash", async () => {
    // two empty collections have identical content, so identical hashes
    const sharedHash = repHash("1");
    const oldMeta: Metadata = {
      lastModified: "",
      visibleName: "test",
      parent: "",
      pinned: false,
      type: "CollectionType",
    };

    mockFetch(
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(
        `3\n${sharedHash}:80000000:first_id:2:123\n${sharedHash}:80000000:second_id:2:123\n`,
      ),
      textResponse(
        `3\n${repHash("2")}:0:second_id.metadata:0:1\n${repHash("3")}:0:second_id.content:0:122\n`,
      ),
      jsonResponse(oldMeta),
      emptyResponse(),
      emptyResponse(),
      emptyResponse(),
      jsonResponse({ hash: repHash("4"), generation: 1 }),
    );

    const api = await remarkable("");
    const res = await api.rename(
      { id: "second_id", hash: sharedHash },
      "renamed",
    );

    expect(res.id).toBe("second_id");
  });

  test("#updateDocument() errors when the hash is gone", async () => {
    const staleHash = repHash("9");
    mockFetch(
      emptyResponse(),
      jsonResponse({ hash: repHash("0"), generation: 0, schemaVersion: 3 }),
      textResponse(`3\n${repHash("1")}:80000000:fake_id:2:123\n`),
    );

    const api = await remarkable("");
    await expect(
      api.updateDocument({ id: "fake_id", hash: staleHash }, { textScale: 1 }),
    ).rejects.toThrow(staleHash);
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
    const res = await api.bulkDelete([{ id: "fake_id", hash: moveHash }]);

    expect(res).toHaveLength(1);
    expect(res[0]!.id).toBe("fake_id");
    expect(res[0]!.hash).toHaveLength(64);
  });

  test("#pruneCache()", async () => {
    const rootHash = repHash("0");
    const entryHash = repHash("1");
    const fileHash = repHash("2");
    const unreachableHash = repHash("9");
    const rootEntries = `3
${entryHash}:80000000:document:1:1
`;
    const documentEntries = `3
${fileHash}:0:document.content:0:1
`;
    // warm start with the full document plus an orphaned entry that nothing points at
    const cache = JSON.stringify({
      [rootHash]: rootEntries,
      [entryHash]: documentEntries,
      [fileHash]: "leaf",
      [unreachableHash]: "orphan",
    });
    mockFetch(
      emptyResponse(),
      jsonResponse({
        hash: rootHash,
        generation: 0,
        schemaVersion: 3,
      }),
    );

    const api = await remarkable("", { cache });
    await api.pruneCache();

    const { entries: pruned } = JSON.parse(api.dumpCache()) as {
      entries: Record<string, string | null>;
    };
    expect(rootHash in pruned).toBeTrue();
    expect(entryHash in pruned).toBeTrue();
    expect(fileHash in pruned).toBeTrue();
    expect(unreachableHash in pruned).toBeFalse();
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
    await api.listRefs();
    expect(api.dumpCache().length).toBeGreaterThan(0);

    api.clearCache();
    expect(JSON.parse(api.dumpCache())).toEqual({ version: 2, entries: {} });
  });

  test("#dumpCache() keeps utf-8 as text and falls back to base64", async () => {
    mockFetch(emptyResponse(), emptyResponse(), emptyResponse());
    const api = await remarkable("");

    const enc = new TextEncoder();
    const text = await api.raw.putFile(
      "doc.pagedata",
      enc.encode("Blank\né\n"),
    );
    await text[Symbol.asyncDispose]();
    const binary = await api.raw.putFile(
      "doc.rm",
      new Uint8Array([0xff, 0xfe, 0x00, 0x01]),
    );
    await binary[Symbol.asyncDispose]();

    const { entries } = JSON.parse(api.dumpCache()) as {
      entries: Record<string, string | null>;
    };
    expect(entries[text.hash]).toBe("tBlank\né\n");
    // invalid utf-8 can't be stored as text
    expect(entries[binary.hash]).toBe("b//4AAQ==");
  });

  test("#remarkable() forwards maxCachedBytes", async () => {
    mockFetch(emptyResponse(), emptyResponse());
    const api = await remarkable("", { maxCachedBytes: 0 });
    const entry = await api.raw.putFile("doc.rm", new Uint8Array([1, 2, 3]));
    await entry[Symbol.asyncDispose]();

    // nothing over the limit keeps its contents, only its existence
    const { entries } = JSON.parse(api.dumpCache()) as {
      entries: Record<string, string | null>;
    };
    expect(entries[entry.hash]).toBeNull();
  });

  test("a cache with an unrecognized tag is rejected", async () => {
    const hash = repHash("4");
    const dump = JSON.stringify({ version: 2, entries: { [hash]: "zhello" } });
    expect(() => session("tok", { cache: dump })).toThrow();
  });

  test("a cache dumped in the old text-only format still loads", async () => {
    const hash = repHash("3");
    const legacy = JSON.stringify({ [hash]: "Blank\n" });
    mockFetch(emptyResponse());
    const api = await remarkable("", { cache: legacy });
    expect(await api.raw.getText({ id: "doc.pagedata", hash })).toBe("Blank\n");
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
    expect(api.listItems()).rejects.toThrow("expected object");
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
    expect(api.listItems()).rejects.toThrow("expected object");
  });
});

describe("putDocumentArchive() / getDocumentArchive()", () => {
  test("round-trips an archive, rewriting id and metadata", async () => {
    const oldId = "11111111-1111-4111-8111-111111111111";
    const pageId = "22222222-2222-4222-8222-222222222222";
    const parent = "33333333-3333-4333-8333-333333333333";

    const metadata: Metadata = {
      lastModified: "100",
      visibleName: "original",
      parent: "",
      pinned: false,
      type: "DocumentType",
      version: 1,
    };

    // build a source archive with a nested page file
    const src = new JSZip();
    src.file(`${oldId}.metadata`, JSON.stringify(metadata));
    src.file(`${oldId}.content`, JSON.stringify({ fileType: "pdf" }));
    src.file(`${oldId}.pagedata`, "\n");
    src.file(`${oldId}.pdf`, new Uint8Array([1, 2, 3, 4]));
    src.file(`${oldId}/${pageId}.rm`, new Uint8Array([5, 6, 7]));
    const archive = await src.generateAsync({ type: "uint8array" });

    // a stateful content-addressed backend, seeded with an empty root index
    const blobs = new Map<string, Uint8Array>();
    const rootStart = "0".repeat(64);
    blobs.set(rootStart, new TextEncoder().encode("4\n0:.:0:0\n"));
    let root = { hash: rootStart, generation: 1 };

    const spy = spyOn(globalThis, "fetch");
    spy.mockImplementation((async (
      input: string | Request | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = input.toString();
      const method = init?.method ?? "GET";
      if (url.endsWith("/token/json/2/user/new")) {
        return textResponse("session");
      } else if (url.endsWith("/sync/v4/root")) {
        return jsonResponse({ ...root, schemaVersion: 4 });
      } else if (url.endsWith("/sync/v3/root") && method === "PUT") {
        const body = JSON.parse(init!.body as string) as { hash: string };
        root = { hash: body.hash, generation: root.generation + 1 };
        return jsonResponse(root);
      } else if (url.includes("/sync/v3/files/")) {
        const hash = url.slice(url.indexOf("/sync/v3/files/") + 15);
        if (method === "PUT") {
          blobs.set(hash, init!.body as Uint8Array);
          return emptyResponse();
        }
        const blob = blobs.get(hash);
        return blob
          ? bytesResponse(blob)
          : emptyResponse({ status: 404, statusText: "not found" });
      }
      throw new Error(`unexpected ${method} ${url}`);
    }) as unknown as typeof fetch);

    const api = await remarkable("");
    const { id: newId, hash } = await api.putDocumentArchive(archive, {
      parent,
      visibleName: "renamed",
    });

    // a fresh id was minted and the root advanced to point at the new doc
    expect(newId).not.toBe(oldId);
    expect(newId).toHaveLength(36);
    expect(root.hash).not.toBe(rootStart);

    // read it back and confirm every file survived with the new id prefix
    const out = await api.getDocumentArchive({ id: newId, hash });
    const zip = await JSZip.loadAsync(out);
    const files = Object.keys(zip.files).filter(
      (path) => !zip.files[path]!.dir,
    );
    expect(files.sort()).toEqual(
      [
        `${newId}.content`,
        `${newId}.metadata`,
        `${newId}.pagedata`,
        `${newId}.pdf`,
        `${newId}/${pageId}.rm`,
      ].sort(),
    );

    // metadata overrides applied, lastModified bumped
    const outMeta = JSON.parse(
      await zip.file(`${newId}.metadata`)!.async("string"),
    ) as Metadata;
    expect(outMeta.parent).toBe(parent);
    expect(outMeta.visibleName).toBe("renamed");
    expect(outMeta.lastModified).not.toBe("100");

    // binary payloads round-trip byte-for-byte
    expect(
      Array.from(await zip.file(`${newId}.pdf`)!.async("uint8array")),
    ).toEqual([1, 2, 3, 4]);
    expect(
      Array.from(await zip.file(`${newId}/${pageId}.rm`)!.async("uint8array")),
    ).toEqual([5, 6, 7]);

    spy.mockRestore();
  });
});

describe("retries", () => {
  test("putPdf retries a generation conflict without re-uploading blobs", async () => {
    const pdf = new TextEncoder().encode("pdf content");

    const blobs = new Map<string, Uint8Array>();
    const rootStart = "0".repeat(64);
    blobs.set(rootStart, new TextEncoder().encode("4\n0:.:0:0\n"));
    let root = { hash: rootStart, generation: 1 };
    let rootPuts = 0;
    const filePuts: string[] = [];

    const spy = spyOn(globalThis, "fetch");
    spy.mockImplementation((async (
      input: string | Request | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = input.toString();
      const method = init?.method ?? "GET";
      if (url.endsWith("/token/json/2/user/new")) {
        return textResponse("session");
      } else if (url.endsWith("/sync/v4/root")) {
        return jsonResponse({ ...root, schemaVersion: 4 });
      } else if (url.endsWith("/sync/v3/root") && method === "PUT") {
        rootPuts++;
        if (rootPuts === 1) {
          // first attempt loses the race to another writer
          return textResponse('{"message":"precondition failed"}\n', {
            status: 400,
          });
        }
        const body = JSON.parse(init!.body as string) as { hash: string };
        root = { hash: body.hash, generation: root.generation + 1 };
        return jsonResponse(root);
      } else if (url.includes("/sync/v3/files/")) {
        const hash = url.slice(url.indexOf("/sync/v3/files/") + 15);
        if (method === "PUT") {
          filePuts.push(hash);
          blobs.set(hash, init!.body as Uint8Array);
          return emptyResponse();
        }
        const blob = blobs.get(hash);
        return blob
          ? bytesResponse(blob)
          : emptyResponse({ status: 404, statusText: "not found" });
      }
      throw new Error(`unexpected ${method} ${url}`);
    }) as unknown as typeof fetch);

    const api = await remarkable("");
    const res = await api.putPdf("new name", pdf);

    expect(res.id).toHaveLength(36);
    // conflicted once, then succeeded on retry
    expect(rootPuts).toBe(2);
    // every blob uploaded at most once — no re-upload, no orphans
    expect(new Set(filePuts).size).toBe(filePuts.length);

    spy.mockRestore();
  });

  test("retries a transient 5xx response", async () => {
    let rootGets = 0;
    const spy = spyOn(globalThis, "fetch");
    spy.mockImplementation((async (
      input: string | Request | URL,
    ): Promise<Response> => {
      const url = input.toString();
      if (url.endsWith("/token/json/2/user/new")) {
        return textResponse("session");
      } else if (url.endsWith("/sync/v4/root")) {
        rootGets++;
        if (rootGets === 1) {
          return textResponse("boom", {
            status: 503,
            statusText: "unavailable",
          });
        }
        return jsonResponse({
          hash: "0".repeat(64),
          generation: 0,
          schemaVersion: 4,
        });
      } else if (url.includes("/sync/v3/files/")) {
        return textResponse("4\n0:.:0:0\n");
      }
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch);

    const api = await remarkable("");
    const ids = await api.listRefs();

    expect(ids).toEqual([]);
    // failed once, then retried
    expect(rootGets).toBe(2);

    spy.mockRestore();
  });

  test("does not transient-retry the root PUT", async () => {
    const pdf = new TextEncoder().encode("pdf content");
    const blobs = new Map<string, Uint8Array>();
    const rootStart = "0".repeat(64);
    blobs.set(rootStart, new TextEncoder().encode("4\n0:.:0:0\n"));
    let rootPuts = 0;

    const spy = spyOn(globalThis, "fetch");
    spy.mockImplementation((async (
      input: string | Request | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = input.toString();
      const method = init?.method ?? "GET";
      if (url.endsWith("/token/json/2/user/new")) {
        return textResponse("session");
      } else if (url.endsWith("/sync/v4/root")) {
        return jsonResponse({
          hash: rootStart,
          generation: 1,
          schemaVersion: 4,
        });
      } else if (url.endsWith("/sync/v3/root") && method === "PUT") {
        // the root PUT keeps failing transiently; it must NOT be retried, since
        // a retried lost-but-applied write would be double-applied
        rootPuts++;
        return textResponse("boom", { status: 503, statusText: "unavailable" });
      } else if (url.includes("/sync/v3/files/")) {
        const hash = url.slice(url.indexOf("/sync/v3/files/") + 15);
        if (method === "PUT") {
          blobs.set(hash, init!.body as Uint8Array);
          return emptyResponse();
        }
        const blob = blobs.get(hash);
        return blob
          ? bytesResponse(blob)
          : emptyResponse({ status: 404, statusText: "not found" });
      }
      throw new Error(`unexpected ${method} ${url}`);
    }) as unknown as typeof fetch);

    const api = await remarkable("");
    await expect(api.putPdf("new name", pdf)).rejects.toThrow(
      "failed reMarkable request",
    );
    // the compare-and-set root PUT is attempted exactly once, never retried
    expect(rootPuts).toBe(1);

    spy.mockRestore();
  });

  test("serializes concurrent mutators so they don't self-conflict", async () => {
    const blobs = new Map<string, Uint8Array>();
    const rootStart = "0".repeat(64);
    blobs.set(rootStart, new TextEncoder().encode("4\n0:.:0:0\n"));
    let root = { hash: rootStart, generation: 1 };
    let conflicts = 0;

    const spy = spyOn(globalThis, "fetch");
    spy.mockImplementation((async (
      input: string | Request | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = input.toString();
      const method = init?.method ?? "GET";
      if (url.endsWith("/token/json/2/user/new")) {
        return textResponse("session");
      } else if (url.endsWith("/sync/v4/root")) {
        return jsonResponse({ ...root, schemaVersion: 4 });
      } else if (url.endsWith("/sync/v3/root") && method === "PUT") {
        const body = JSON.parse(init!.body as string) as {
          hash: string;
          generation: number;
        };
        if (body.generation !== root.generation) {
          // a compare-and-set miss means the client raced itself
          conflicts++;
          return textResponse('{"message":"precondition failed"}\n', {
            status: 400,
          });
        }
        root = { hash: body.hash, generation: root.generation + 1 };
        return jsonResponse(root);
      } else if (url.includes("/sync/v3/files/")) {
        const hash = url.slice(url.indexOf("/sync/v3/files/") + 15);
        if (method === "PUT") {
          blobs.set(hash, init!.body as Uint8Array);
          return emptyResponse();
        }
        const blob = blobs.get(hash);
        return blob
          ? bytesResponse(blob)
          : emptyResponse({ status: 404, statusText: "not found" });
      }
      throw new Error(`unexpected ${method} ${url}`);
    }) as unknown as typeof fetch);

    const api = await remarkable("");
    const pdf = new TextEncoder().encode("pdf content");
    const [a, b] = await Promise.all([
      api.putPdf("doc a", pdf),
      api.putPdf("doc b", pdf),
    ]);

    // both landed as distinct docs, and the lock kept them from racing into a
    // generation conflict (without it the second would lose the CAS and retry)
    expect(a.id).not.toBe(b.id);
    expect(conflicts).toBe(0);
    expect(root.generation).toBe(3);

    spy.mockRestore();
  });
});
