import { type Mock, mock } from "bun:test";

class MockResponse extends Response {
  constructor(
    private readonly content: Uint8Array,
    override readonly status: number,
    override readonly statusText: string,
  ) {
    super();
  }

  override get ok(): boolean {
    return 200 <= this.status && this.status < 300;
  }

  override arrayBuffer(): Promise<ArrayBuffer> {
    // NOTE this is a hack, but should be fine for our uses
    return Promise.resolve(this.content.buffer as ArrayBuffer);
  }

  override text(): Promise<string> {
    const dec = new TextDecoder();
    return Promise.resolve(dec.decode(this.content));
  }
  override async json(): Promise<object> {
    return JSON.parse(await this.text()) as object;
  }
}

export function emptyResponse({
  status = 200,
  statusText = "",
}: {
  status?: number;
  statusText?: string;
} = {}): Response {
  return new MockResponse(new Uint8Array(), status, statusText);
}

export function bytesResponse(
  content: Uint8Array,
  {
    status = 200,
    statusText = "",
  }: {
    status?: number;
    statusText?: string;
  } = {},
): Response {
  return new MockResponse(content, status, statusText);
}

export function textResponse(
  content: string,
  {
    status = 200,
    statusText = "",
  }: {
    status?: number;
    statusText?: string;
  } = {},
): Response {
  const enc = new TextEncoder();
  return new MockResponse(enc.encode(content), status, statusText);
}

export function jsonResponse(
  content: unknown,
  opts: {
    status?: number;
    statusText?: string;
  } = {},
) {
  return textResponse(JSON.stringify(content), opts);
}

export interface LoggedRequest {
  url: string;
  bodyText: string | undefined;
}

export type Awaitable<T> = T | Promise<T>;

export type MockFetch = (
  input: string | Request | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createMockFetch(
  ...nextResponses: Awaitable<Response>[]
): MockFetch {
  void nextResponses.reverse();

  const mockFetch = async (
    url: string | Request | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const res = nextResponses.pop();
    /* istanbul ignore else */
    if (res) {
      return await res;
    } else {
      const serialized = JSON.stringify(init, null, 2);
      throw new Error(
        // eslint-disable-next-line @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions
        `didn't set next response to ${init?.method} ${url}:\n${serialized}`,
      );
    }
  };

  return mockFetch;
}

export function mockFetch(
  ...nextResponses: Awaitable<Response>[]
): Mock<MockFetch> {
  const mocked = mock(createMockFetch(...nextResponses));
  globalThis.fetch = mocked as unknown as typeof globalThis.fetch;
  return mocked;
}
