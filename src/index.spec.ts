import { describe, expect, test } from "bun:test";
import { ValidationError, register, remarkable } from ".";
import { MockResponse, createMockFetch } from "./test-utils";

// make sure we can't use fetch
global.fetch = undefined as never;

const fakeHash =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function encode(input: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(input).buffer as ArrayBuffer;
}

describe("register()", () => {
  test("success", async () => {
    const fetch = createMockFetch(new MockResponse("custom device token"));

    const token = await register("academic", { fetch });
    expect(token).toBe("custom device token");
    expect(fetch.pastRequests.length).toBe(1);
    const [first] = fetch.pastRequests;
    expect(first).toBeDefined();
  });

  test("invalid", () => {
    const fetch = createMockFetch();

    expect(register("", { fetch })).rejects.toThrow(
      "code should be length 8, but was 0",
    );
  });

  test("error", () => {
    const fetch = createMockFetch(new MockResponse("", 400, "custom error"));

    expect(register("academic", { fetch })).rejects.toThrow(
      "couldn't register api",
    );
  });

  test("default", () => {
    // can call with default syntax, even though this instance will fail
    expect(register("academic")).rejects.toThrow("fetch is not a function");
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

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(remarkable("", { fetch })).rejects.toThrow(
        "couldn't fetch auth token",
      );
    });

    test("default", async () => {
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(remarkable("")).rejects.toThrow("fetch is not a function");
    });
  });

  test("#listFiles()", async () => {
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
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify([file])),
    );

    const api = await remarkable("", { fetch });
    const [loaded] = await api.listFiles();
    expect(loaded).toEqual(file);
  });

  test("#createFolder()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(
        JSON.stringify({ docID: "folder id", hash: "folder hash" }),
      ),
    );

    const api = await remarkable("", { fetch });
    const res = await api.createFolder("new folder");

    expect(res.docID).toBe("folder id");
    expect(res.hash).toBe("folder hash");
  });

  test("#uploadEpub()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify({ docID: "epub id", hash: "epub hash" })),
    );

    const api = await remarkable("", { fetch });
    const content = "my epub content";
    const res = await api.uploadEpub("my epub title", encode(content));

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
    const content = "my pdf content";
    const res = await api.uploadPdf("my pdf title", encode(content));

    expect(res.docID).toBe("pdf id");
    expect(res.hash).toBe("pdf hash");

    const [, req] = fetch.pastRequests;
    expect(req?.bodyText).toBe("my pdf content");
  });

  test("#move()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify({ hash: "hash" })),
    );

    const api = await remarkable("", { fetch });
    const res = await api.move(fakeHash, "");

    expect(res.hash).toBe("hash");
  });

  test("#delete()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify({ hash: "hash" })),
    );

    const api = await remarkable("", { fetch });
    const res = await api.delete(fakeHash);

    expect(res.hash).toBe("hash");
  });

  test("#rename()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify({ hash: "hash" })),
    );

    const api = await remarkable("", { fetch });
    const res = await api.rename(fakeHash, "new name");

    expect(res.hash).toBe("hash");
  });

  test("#bulkMove()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify({ hashes: { oldHash: "newHash" } })),
    );

    const api = await remarkable("", { fetch });
    const res = await api.bulkMove([fakeHash], "");

    expect("oldHash" in res.hashes).toBeTrue();
  });

  test("#bulkDelete()", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify({ hashes: { oldHash: "newHash" } })),
    );

    const api = await remarkable("", { fetch });
    const res = await api.bulkDelete([fakeHash]);

    expect("oldHash" in res.hashes).toBeTrue();
  });

  test("request fail", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify([{}])),
    );

    const api = await remarkable("", { fetch });
    expect(api.listFiles()).rejects.toThrow("couldn't validate schema:");
  });

  test("response fail", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse("fail", 400, "bad request"),
    );

    const api = await remarkable("", { fetch });
    expect(api.listFiles()).rejects.toThrow("failed reMarkable request:");
  });

  test("verification fail", async () => {
    const fetch = createMockFetch(
      new MockResponse(),
      new MockResponse(JSON.stringify([{}])),
    );

    const api = await remarkable("", { fetch });
    expect(api.listFiles()).rejects.toThrow("couldn't validate schema:");
  });
});

test("ValidationError()", () => {
  const error = new ValidationError("incorrect hash", /./, "message");
  expect(error.field).toBe("incorrect hash");
});
