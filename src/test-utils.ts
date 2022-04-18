import {
  CacheLike,
  FetchLike,
  HeadersLike,
  RequestInitLike,
  ResponseLike,
} from ".";

export class MockResponse implements ResponseLike {
  constructor(
    private readonly content: string = "",
    readonly status: number = 200,
    readonly statusText: string = "",
    readonly mapHeaders: Record<string, string> = {}
  ) {}

  get ok(): boolean {
    return 200 <= this.status && this.status < 300;
  }

  get headers(): HeadersLike {
    const { mapHeaders } = this;
    return {
      get(key: string): string | null {
        return mapHeaders[key] ?? null;
      },
    };
  }

  text(): string {
    return this.content;
  }

  arrayBuffer(): ArrayBuffer {
    const enc = new TextEncoder();
    return enc.encode(this.content);
  }
}

export interface LoggedRequest extends RequestInitLike {
  url: string;
  bodyText: string | undefined;
}

export interface MockFetch extends FetchLike {
  nextResponses: MockResponse[];
  pastRequests: LoggedRequest[];
}

const dec = new TextDecoder();

function extractBodyText(
  body: string | ArrayBuffer | undefined
): string | undefined {
  if (body === undefined) {
    return undefined;
  } else if (typeof body === "string") {
    return body;
  } else {
    return dec.decode(body);
  }
}

export function createMockFetch(...responses: MockResponse[]): MockFetch {
  const nextResponses: MockResponse[] = responses.reverse();
  const pastRequests: LoggedRequest[] = [];

  function mockFetch(
    url: string,
    options?: RequestInitLike | undefined
  ): ResponseLike {
    pastRequests.push({
      url,
      bodyText: extractBodyText(options?.body),
      ...options,
    });
    const res = nextResponses.pop();
    /* istanbul ignore else */
    if (res) {
      return res;
    } else {
      throw new Error("didn't set next response");
    }
  }
  mockFetch.nextResponses = nextResponses;
  mockFetch.pastRequests = pastRequests;
  return mockFetch;
}

export function mapCache(backedBy: Map<string, string> = new Map()): CacheLike {
  return {
    get(key: string): string | undefined {
      return backedBy.get(key);
    },
    set(key: string, val: string): void {
      backedBy.set(key, val);
    },
  };
}
