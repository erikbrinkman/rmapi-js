/**
 * Create and interact with reMarkable cloud.
 *
 * After getting a device token with the {@link register | `register`} method,
 * persist it and create api instances using {@link remarkable | `remarkable`}.
 * Outside of registration, all relevant methods are in
 * {@link RemarkableApi | `RemarkableApi`}.
 *
 * @example
 * A simple rename
 * ```ts
 * import { register, remarkable } from "rmapi-js";
 *
 * const code = "..."  // eight letter code from https://my.remarkable.com/device/browser/connect
 * const token = await register(code)
 * // persist token
 * const api = await remarkable(token);
 * const [first, ...rest] = api.listfiles();
 * // rename first file
 * const api.rename(first.hash, "new name");
 * ```
 *
 * @example
 * A simple upload
 * ```ts
 * import { remarkable } from "rmapi-js";
 *
 * const api = await remarkable(...);
 * const entry = await api.putEpub("document name", epubBuffer);
 * await api.create(entry);
 * ```
 *
 * @remarks
 *
 * The cloud api is essentially a collection of entries. Each entry has an id,
 * which is a uuid4 and a hash, which indicates it's current state, and changes
 * as the item mutates, where the id is constant. Most mutable operations take
 * the initial hash so that merge conflicts can be resolved. Each entry has a
 * number of properties, but a key is the `parent`, which represents its parent
 * in the file structure. This will be another document id, or one of two
 * special ids, "" (the empty string) for the root directory, or "trash" for the
 * trash.
 *
 * @packageDocumentation
 */
import { fromByteArray } from "base64-js";
import {
  boolean,
  discriminator,
  elements,
  enumeration,
  float64,
  properties,
  string,
  values,
  type CompiledSchema,
} from "jtd-ts";
import { v4 as uuid4 } from "uuid";

const AUTH_HOST = "https://webapp-prod.cloud.remarkable.engineering";
const SYNC_HOST = "https://web.eu.tectonic.remarkable.com";

// ------------ //
// Request Info //
// ------------ //
// The section has all the types that are stored in the remarkable cloud.

/** request types */
export type RequestMethod =
  | "POST"
  | "GET"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "OPTIONS";

const idReg =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}||trash)$/;
const hashReg = /^[0-9a-f]{64}$/;

/** simple verification wrapper that allows for bypassing */
function verification<T>(
  res: unknown,
  schema: CompiledSchema<T, unknown>,
  verify: boolean,
): T {
  if (!verify || schema.guard(res)) {
    return res as T;
  } else {
    throw new Error(
      `couldn't validate schema: ${JSON.stringify(res)} didn't match schema ${JSON.stringify(schema.schema())}`,
    );
  }
}

/** a tag for an entry */
export interface Tag {
  /** the name of the tag */
  name: string;
  /** the timestamp when this tag was added */
  timestamp: number;
}

/** common properties shared by collections and documents */
export interface EntryCommon {
  /** the document id, a uuid4 */
  id: string;
  /** the current hash of the state of this entry */
  hash: string;
  /** the visible display name of this entry */
  visibleName: string;
  /** the last modified timestamp */
  lastModified: string;
  /**
   * the parent of this entry
   *
   * There are two special parents, "" (empty string) for the root directory,
   * and "trash" for the trash
   */
  parent: string;
  /** true if the entry is starred in most ui elements */
  pinned: boolean;
  /** the timestamp of the last time this entry was opened */
  lastOpened: string;
  /** any tags the entry might have */
  tags?: Tag[];
}

/** a folder, referred to in the api as a collection */
export interface CollectionEntry extends EntryCommon {
  /** the key for this as a collection */
  type: "CollectionType";
}

/** a file, referred to in the api as a document */
export interface DocumentType extends EntryCommon {
  /** the key to identify this as a document */
  type: "DocumentType";
  /** the type of the file */
  fileType: "epub" | "pdf" | "notebook";
}

/** a remarkable entry for cloud items */
export type Entry = CollectionEntry | DocumentType;

/** an simple entry produced by the upload api */
export interface UploadEntry {
  /** the document id */
  docID: string;
  /** the document hash */
  hash: string;
}

const uploadEntry = properties({
  docID: string(),
  hash: string(),
}) satisfies CompiledSchema<UploadEntry, unknown>;

const commonProperties = {
  id: string(),
  hash: string(),
  visibleName: string(),
  lastModified: string(),
  parent: string(),
  pinned: boolean(),
  lastOpened: string(),
} as const;

const commonOptionalProperties = {
  tags: elements(
    properties({
      name: string(),
      timestamp: float64(),
    }),
  ),
} as const;

const entry = discriminator("type", {
  CollectionType: properties(commonProperties, commonOptionalProperties, true),
  DocumentType: properties(
    { ...commonProperties, fileType: enumeration("epub", "pdf", "notebook") },
    commonOptionalProperties,
    true,
  ),
}) satisfies CompiledSchema<Entry, unknown>;

const entries = elements(entry) satisfies CompiledSchema<Entry[], unknown>;

/** the new hash of a modified entry */
export interface HashEntry {
  /** the actual hash */
  hash: string;
}

const hashEntry = properties({ hash: string() }) satisfies CompiledSchema<
  HashEntry,
  unknown
>;

/** the mapping from old hashes to new hashes after a bulk modify */
export interface HashesEntry {
  /** the mapping from old to new hashes */
  hashes: Record<string, string>;
}

const hashesEntry = properties({
  hashes: values(string()),
}) satisfies CompiledSchema<HashesEntry, unknown>;

// ------------ //
// Request Info //
// ------------ //
// In order to be generic, we allow custom implementations of tools provided by
// the browser.

/** stripped down version of RequestInit */
export interface RequestInitLike {
  /** request method */
  readonly method?: RequestMethod | undefined;
  /** request headers */
  readonly headers?: Record<string, string>;
  /** request body */
  readonly body?: ArrayBuffer | string;
}

/** stripped down version of Headers */
export interface HeadersLike {
  /** get a specific header value */
  get(key: string): string | null;
}

/** stripped down version of Response */
export interface ResponseLike {
  /** true if request was successful */
  ok: boolean;
  /** http status */
  status: number;
  /** text associated with status */
  statusText: string;
  /** get response body as text */
  text(): Promise<string>;
}

/** stripped down version of fetch */
export interface FetchLike {
  /** the rough interface to fetch */
  (url: string, options?: RequestInitLike): Promise<ResponseLike>;
}

/** an error that results from a failed request */
export class ResponseError extends Error {
  /** the response status number */
  readonly status: number;
  /** the response status text */
  readonly statusText: string;

  constructor(status: number, statusText: string, message: string) {
    super(message);
    this.status = status;
    this.statusText = statusText;
  }
}

/** an error that results from a failed request */
export class ValidationError extends Error {
  /** the response status number */
  readonly field: string;
  /** the response status text */
  readonly regex: RegExp;

  constructor(field: string, regex: RegExp, message: string) {
    super(message);
    this.field = field;
    this.regex = regex;
  }
}

// -------------- //
// Remarkable API //
// -------------- //

/** options for registering with the api */
export interface RegisterOptions {
  /**
   * the device description to use
   *
   * Using an improper one will results in the registration being rejected.
   */
  deviceDesc?:
    | "desktop-windows"
    | "desktop-macos"
    | "desktop-linux"
    | "mobile-android"
    | "mobile-ios"
    | "browser-chrome"
    | "remarkable";
  /**
   * the unique id of this device
   *
   * If omitted it will be randomly generated */
  uuid?: string;
  /** The host to use for authorization requests */
  authHost?: string;
  /** a function for making fetch requests, see {@link RemarkableOptions.fetch} for more info */
  fetch?: FetchLike;
}

/**
 * register a device and get the token needed to access the api
 *
 * Have users go to `https://my.remarkable.com/device/browser/connect` and pass
 * the resulting code into this function to get a device token. Persist that
 * token to use the api.
 *
 * @param code - the eight letter code a user got from `https://my.remarkable.com/device/browser/connect`.
 * @returns the device token necessary for creating an api instace. These never expire so persist as long as necessary.
 */
export async function register(
  code: string,
  {
    deviceDesc = "browser-chrome",
    uuid = uuid4(),
    authHost = AUTH_HOST,
    fetch = globalThis.fetch,
  }: RegisterOptions = {},
): Promise<string> {
  if (code.length !== 8) {
    throw new Error(`code should be length 8, but was ${code.length}`);
  }
  const resp = await fetch(`${authHost}/token/json/2/device/new`, {
    method: "POST",
    headers: {
      Authorization: "Bearer",
    },
    body: JSON.stringify({
      code,
      deviceDesc,
      deviceID: uuid,
    }),
  });
  if (!resp.ok) {
    throw new ResponseError(
      resp.status,
      resp.statusText,
      "couldn't register api",
    );
  } else {
    return await resp.text();
  }
}

/** options for getting responses */
export interface GetOptions {
  /**
   * whether to verify the types of the response
   *
   * Omitting will make the results always work, but they might nit return
   * accurate types anymore.
   */
  verify?: boolean | undefined;
}

export interface UploadOptions extends GetOptions {
  /** an optional parent id to set when uploading */
  parent?: string;
}

/**
 * the api for accessing remarkable functions
 */
export interface RemarkableApi {
  /**
   * list all files
   *
   * @example
   * ```ts
   * await api.listFiles();
   * ```
   */
  listFiles(ops?: GetOptions): Promise<Entry[]>;

  /** create a folder */
  createFolder(visibleName: string, opts?: UploadOptions): Promise<UploadEntry>;

  /**
   * upload an epub
   *
   * @example
   * ```ts
   * await api.uploadEpub("My EPub", ...);
   * ```
   *
   * @param visibleName - the name to show for the uploaded epub
   * @param buffer - the epub contents
   */
  uploadEpub(
    visibleName: string,
    buffer: ArrayBuffer,
    opts?: UploadOptions,
  ): Promise<UploadEntry>;

  /**
   * upload a pdf
   *
   * @example
   * ```ts
   * await api.uploadPdf("My PDF", ...);
   * ```
   *
   * @param visibleName - the name to show for the uploaded epub
   * @param buffer - the epub contents
   */
  uploadPdf(
    visibleName: string,
    buffer: ArrayBuffer,
    opts?: UploadOptions,
  ): Promise<UploadEntry>;

  /**
   * move an entry
   *
   * @example
   * ```ts
   * await api.move(doc.hash, dir.id);
   * ```
   *
   * @param hash - the hash of the file to move
   * @param parent - the id of the directory to move the entry to, "" (root) and "trash" are special parents
   */
  move(hash: string, parent: string, opts?: GetOptions): Promise<HashEntry>;

  /**
   * delete an entry
   *
   * @example
   * ```ts
   * await api.delete(file.hash);
   * ```
   * @param hash - the hash of the entry to delete
   */
  delete(hash: string, opts?: GetOptions): Promise<HashEntry>;

  /**
   * rename an entry
   *
   * @example
   * ```ts
   * await api.rename(file.hash, "new name");
   * ```
   * @param hash - the hash of the entry to rename
   * @param visibleName - the new name to assign
   */
  rename(
    hash: string,
    visibleName: string,
    opts?: GetOptions,
  ): Promise<HashEntry>;

  /**
   * move many entries
   *
   * @example
   * ```ts
   * await api.bulkMove([file.hash], dir.id);
   * ```
   *
   * @param hashes - an array of entry hashes to move
   * @param parent - the directory id to move the entries to, "" (root) and "trash" are special ids
   */
  bulkMove(
    hashes: readonly string[],
    parent: string,
    opts?: GetOptions,
  ): Promise<HashesEntry>;

  /**
   * delete many entries
   *
   * @example
   * ```ts
   * await api.bulkDelete([file.hash]);
   * ```
   *
   * @param hashes - the hashes of the entries to delete
   */
  bulkDelete(
    hashes: readonly string[],
    opts?: GetOptions,
  ): Promise<HashesEntry>;
}

/** the implementation of that api */
class Remarkable implements RemarkableApi {
  readonly #userToken: string;
  readonly #fetch: FetchLike;
  readonly #syncHost: string;

  constructor(userToken: string, fetch: FetchLike, syncHost: string) {
    this.#userToken = userToken;
    this.#fetch = fetch;
    this.#syncHost = syncHost;
  }

  /** make an authorized request to remarkable */
  async #authedFetch(
    url: string,
    {
      body,
      method = "POST",
      headers = {},
    }: {
      body?: ArrayBuffer | string | undefined;
      method?: RequestMethod;
      headers?: Record<string, string>;
    },
  ): Promise<ResponseLike> {
    const resp = await this.#fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.#userToken}`,
        ...headers,
      },
      body,
    });
    if (!resp.ok) {
      const msg = await resp.text();
      throw new ResponseError(
        resp.status,
        resp.statusText,
        `failed reMarkable request: ${msg}`,
      );
    } else {
      return resp;
    }
  }

  /** a generic request to the new files api
   *
   * @param meta - remarkable metadata to set, often json formatted or empty
   * @param method - the http method to use
   * @param contentType - the http content type to set
   * @param body - body content, often raw bytes or json
   * @param hash - the hash of a specific file to target
   */
  async #fileRequest({
    meta = "",
    method = "GET",
    // eslint-disable-next-line spellcheck/spell-checker
    contentType = "text/plain;charset=UTF-8",
    body,
    hash,
  }: {
    meta?: string;
    method?: RequestMethod;
    contentType?: string;
    body?: ArrayBuffer | string;
    hash?: string;
  } = {}): Promise<unknown> {
    const encoder = new TextEncoder();
    const encMeta = encoder.encode(meta);
    const suffix = hash === undefined ? "" : `/${hash}`;
    const resp = await this.#authedFetch(
      `${this.#syncHost}/doc/v2/files${suffix}`,
      {
        body,
        method,
        headers: {
          "content-type": contentType,
          "rm-meta": fromByteArray(encMeta),
          "rm-source": "WebLibrary",
        },
      },
    );
    const raw = await resp.text();
    return JSON.parse(raw) as unknown;
  }

  /** list all files */
  async listFiles({ verify = true }: GetOptions = {}): Promise<Entry[]> {
    const res = await this.#fileRequest();
    return verification(res, entries, verify);
  }

  /** upload a file */
  async #uploadFile(
    parent: string,
    visibleName: string,
    buffer: ArrayBuffer,
    contentType: `application/${"epub+zip" | "pdf"}` | "folder",
    verify: boolean,
  ): Promise<UploadEntry> {
    if (verify && !idReg.test(parent)) {
      throw new ValidationError(
        parent,
        idReg,
        "parent must be a valid document id",
      );
    }
    const res = await this.#fileRequest({
      meta: JSON.stringify({ parent, file_name: visibleName }),
      method: "POST",
      contentType,
      body: buffer,
    });
    return verification(res, uploadEntry, verify);
  }

  /** create a folder */
  async createFolder(
    visibleName: string,
    { parent = "", verify = true }: UploadOptions = {},
  ): Promise<UploadEntry> {
    return await this.#uploadFile(
      parent,
      visibleName,
      new ArrayBuffer(0),
      "folder",
      verify,
    );
  }

  /** upload an epub */
  async uploadEpub(
    visibleName: string,
    buffer: ArrayBuffer,
    { parent = "", verify = true }: UploadOptions = {},
  ): Promise<UploadEntry> {
    return await this.#uploadFile(
      parent,
      visibleName,
      buffer,
      "application/epub+zip",
      verify,
    );
  }

  /** upload a pdf */
  async uploadPdf(
    visibleName: string,
    buffer: ArrayBuffer,
    { parent = "", verify = true }: UploadOptions = {},
  ): Promise<UploadEntry> {
    return await this.#uploadFile(
      parent,
      visibleName,
      buffer,
      "application/pdf",
      verify,
    );
  }

  async #modify(
    hash: string,
    properties: Record<string, unknown>,
    verify: boolean,
  ): Promise<HashEntry> {
    if (verify && !hashReg.test(hash)) {
      throw new ValidationError(
        hash,
        hashReg,
        "hash to modify was not a valid hash",
      );
    }
    // this does not allow setting pinned, although I don't know why
    const res = await this.#fileRequest({
      hash,
      body: JSON.stringify(properties),
      method: "PATCH",
    });
    return verification(res, hashEntry, verify);
  }

  /** move an entry */
  async move(
    hash: string,
    parent: string,
    { verify = true }: GetOptions = {},
  ): Promise<HashEntry> {
    if (verify && !idReg.test(parent)) {
      throw new ValidationError(
        parent,
        idReg,
        "parent must be a valid document id",
      );
    }
    return await this.#modify(hash, { parent }, verify);
  }

  /** delete an entry */
  async delete(hash: string, opts: GetOptions = {}): Promise<HashEntry> {
    return await this.move(hash, "trash", opts);
  }

  /** rename an entry */
  async rename(
    hash: string,
    visibleName: string,
    { verify = true }: GetOptions = {},
  ): Promise<HashEntry> {
    return await this.#modify(hash, { file_name: visibleName }, verify);
  }

  /** bulk modify hashes */
  async #bulkModify(
    hashes: readonly string[],
    properties: Readonly<Record<string, unknown>>,
    verify: boolean,
  ): Promise<HashesEntry> {
    if (verify) {
      const invalidHashes = hashes.filter((hash) => !hashReg.test(hash));
      if (invalidHashes.length) {
        throw new ValidationError(
          hashes.join(", "),
          hashReg,
          "hashes to modify were not a valid hashes",
        );
      }
    }
    // this does not allow setting pinned, although I don't know why
    const res = await this.#fileRequest({
      body: JSON.stringify({
        updates: properties,
        hashes,
      }),
      method: "PATCH",
    });
    return verification(res, hashesEntry, verify);
  }

  /** move many hashes */
  async bulkMove(
    hashes: readonly string[],
    parent: string,
    { verify = true }: GetOptions = {},
  ): Promise<HashesEntry> {
    if (verify && !idReg.test(parent)) {
      throw new ValidationError(
        parent,
        idReg,
        "parent must be a valid document id",
      );
    }
    return await this.#bulkModify(hashes, { parent }, verify);
  }

  /** delete many hashes */
  async bulkDelete(
    hashes: readonly string[],
    opts: GetOptions = {},
  ): Promise<HashesEntry> {
    return await this.bulkMove(hashes, "trash", opts);
  }

  // TODO ostensibly we could implement a bulk rename nut idk why
}

/** options for a remarkable instance */
export interface RemarkableOptions {
  /**
   * the fetch method to use
   *
   * This should loosely conform to the WHATWG fetch, but is relaxed enough that
   * node-fetch also works. This will default to the global definitions of
   * fetch.
   *
   * In node you can either use `"node-fetch"`, or `node --experimental-fetch`
   * for node 17.5 or higher.
   *
   * @defaultValue globalThis.fetch
   */
  fetch?: FetchLike;

  /**
   * the url for making authorization requests
   *
   * @defaultValue "https://webapp-prod.cloud.remarkable.engineering"
   */
  authHost?: string;

  /**
   * the url for making synchronization requests
   *
   * @defaultValue "https://internal.cloud.remarkable.com"
   */
  syncHost?: string;
}

/**
 * create an instance of the api
 *
 * This gets a temporary authentication token with the device token. If
 * requests start failing, simply recreate the api instance.
 *
 * @param deviceToken - the device token proving this api instance is
 *    registered. Create one with {@link register}.
 * @returns an api instance
 */
export async function remarkable(
  deviceToken: string,
  {
    fetch = globalThis.fetch,
    authHost = AUTH_HOST,
    syncHost = SYNC_HOST,
  }: RemarkableOptions = {},
): Promise<RemarkableApi> {
  const resp = await fetch(`${authHost}/token/json/2/user/new`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deviceToken}`,
    },
  });
  if (!resp.ok) {
    throw new Error(`couldn't fetch auth token: ${resp.statusText}`);
  }
  const userToken = await resp.text();
  return new Remarkable(userToken, fetch, syncHost);
}
