import { FetchLike, RequestInitLike, ResponseLike } from ".";

export class MockResponse implements ResponseLike {
  constructor(
    private readonly content: string = "",
    readonly status: number = 200,
    readonly statusText: string = "",
    readonly mapHeaders: Record<string, string> = {},
  ) {}

  get ok(): boolean {
    return 200 <= this.status && this.status < 300;
  }

  text(): Promise<string> {
    return Promise.resolve(this.content);
  }
}

export interface LoggedRequest extends RequestInitLike {
  url: string;
  bodyText: string | undefined;
}

export interface MockFetch extends FetchLike {
  pastRequests: LoggedRequest[];
}

const dec = new TextDecoder();

function extractBodyText(
  body: string | ArrayBuffer | undefined,
): string | undefined {
  if (body === undefined) {
    return undefined;
  } else if (typeof body === "string") {
    return body;
  } else {
    return dec.decode(body);
  }
}

export type Awaitable<T> = T | Promise<T>;

export function createMockFetch(
  ...nextResponses: Awaitable<MockResponse>[]
): MockFetch {
  void nextResponses.reverse();
  const pastRequests: LoggedRequest[] = [];

  const mockFetch = async (
    url: string,
    options?: RequestInitLike,
  ): Promise<ResponseLike> => {
    pastRequests.push({
      url,
      bodyText: extractBodyText(options?.body),
      ...options,
    });
    const res = nextResponses.pop();
    /* istanbul ignore else */
    if (res) {
      return await res;
    } else {
      throw new Error("didn't set next response");
    }
  };
  mockFetch.pastRequests = pastRequests;
  return mockFetch;
}
