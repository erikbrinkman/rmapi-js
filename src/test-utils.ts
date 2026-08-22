import { type Mock, spyOn } from "bun:test";

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
        `didn't set next response to ${init?.method} ${url}:\n${serialized}`,
      );
    }
  };

  return mockFetch;
}

export function mockFetch(
  ...nextResponses: Awaitable<Response>[]
): Mock<MockFetch> {
  const spy = spyOn(globalThis, "fetch") as unknown as Mock<MockFetch>;
  spy.mockClear();
  spy.mockImplementation(createMockFetch(...nextResponses));
  return spy;
}

/** the device id carried by {@link authResponse} */
export const mockDeviceId = "5bd526e8-a264-4e7b-ac82-78fbd72960b8";

/** a token shaped like the ones reMarkable mints, but unsigned */
export function jwt(claims: object): string {
  const payload = new TextEncoder()
    .encode(JSON.stringify(claims))
    .toBase64({ alphabet: "base64url", omitPadding: true });
  return `header.${payload}.signature`;
}

/** the response `auth` gets back when it exchanges a device token */
export function authResponse(): Response {
  return textResponse(jwt({ "device-id": mockDeviceId }));
}
