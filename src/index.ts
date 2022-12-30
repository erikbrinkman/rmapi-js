/**
 * Create and interact with reMarkable cloud.
 *
 * After getting a device token with the {@link register | `register`} method,
 * persist it and create api instances using {@link remarkable | `remarkable`}.
 * Outside of registration, all relevant methods are in
 * {@link RemarkableApi | `RemarkableApi`}.
 *
 * @example
 * A simple fetch
 * ```ts
 * import { register, remarkable } from "rmapi-js";
 *
 * const code = "..."  // eight letter code from https://my.remarkable.com/device/browser/connect
 * const token = await register(code)
 * // persist token
 * const api = await remarkable(token);
 * const [root] = await api.getRootHash();
 * const fileEntries = await api.getEntries(root);
 * for (const entry of fileEntries) {
 *   const children = await api.getEntries(entry.hash);
 *   for (const { hash, documentId } of children) {
 *     if (documentId.endsWith(".metadata")) {
 *       const meta = api.getMetadata(hash);
 *       // get metadata for entry
 *       console.log(meta);
 *     }
 *   }
 * }
 * ```
 *
 * @example
 * A simple upload
 * ```ts
 * import { remarkable } from "rmapi-js";
 *
 * const api = await remarkable(...);
 * const entry = await api.putEpub("document name", epubBuffer);
 * const [root, gen] = await api.getRootHash();
 * const rootEntries = await api.getEntries(root);
 * rootEntries.push(entry);
 * const { hash } = await api.putEntries("", rootEntries);
 * const nextGen = await api.putRootHash(hash, gen);
 * await api.syncComplete(nextGen);
 * ```
 *
 * @packageDocumentation
 */
import { fromByteArray } from "base64-js";
import { v4 as uuid4 } from "uuid";
import { concatBuffers, fromHex, toHex } from "./utils";
import { JtdSchema, validate } from "./validate";

const SCHEMA_VERSION = "3";
const AUTH_HOST = "https://webapp-prod.cloud.remarkable.engineering";
const SYNC_HOST = "https://internal.cloud.remarkable.com";
const GENERATION_HEADER = "x-goog-generation";
const GENERATION_RACE_HEADER = "x-goog-if-generation-match";
const CONTENT_LENGTH_RANGE_HEADER = "x-goog-content-length-range";

// ------------ //
// Request Info //
// ------------ //
// The section has all the types that are stored in the remarkable cloud.

/** request types */
export type RequestMethod = "POST" | "GET" | "PUT" | "DELETE";

/** text alignment types */
export type TextAlignment = "justify" | "left";

/** tool options */
export const builtinTools = [
  "Ballpoint",
  "Ballpointv2",
  "Brush",
  "Calligraphy",
  "ClearPage",
  "EraseSection",
  "Eraser",
  "Fineliner",
  "Finelinerv2",
  "Highlighter",
  "Highlighterv2",
  "Marker",
  "Markerv2",
  "Paintbrush",
  "Paintbrushv2",
  "Pencilv2",
  "SharpPencil",
  "SharpPencilv2",
  "SolidPen",
  "ZoomTool",
] as const;

/** font name options */
export const builtinFontNames = [
  "Maison Neue",
  "EB Garamond",
  "Noto Sans",
  "Noto Serif",
  "Noto Mono",
  "Noto Sans UI",
] as const;

/** text scale options */
export const builtinTextScales = {
  /** the smallest */
  xs: 0.7,
  /** small */
  sm: 0.8,
  /** medium / default */
  md: 1.0,
  /** large */
  lg: 1.2,
  /** extra large */
  xl: 1.5,
  /** double extra large */
  xx: 2.0,
} as const;

/** margin options */
export const builtinMargins = {
  /** small */
  sm: 50,
  /** medium */
  md: 125,
  /** default for read on remarkable */
  rr: 180,
  /** large */
  lg: 200,
} as const;

/** line height options */
export const builtinLineHeights = {
  /** default */
  df: -1,
  /** normal */
  md: 100,
  /** half */
  lg: 150,
  /** double */
  xl: 200,
} as const;

/** a remarkable entry for a cloud collection */
export interface CollectionEntry {
  /** collection type */
  type: "80000000";
  /** the hash of the collection this points to */
  hash: string;
  /** the unique id of the collection */
  documentId: string;
  /** the number of subfiles */
  subfiles: number;
  /** collections don't have sizes */
  size: bigint;
}

/** a remarkable entry for cloud data */
export interface FileEntry {
  /** file type */
  type: "0";
  /** the hash of the file this points to */
  hash: string;
  /** the unique id of the file */
  documentId: string;
  /** files don't have subfiles */
  subfiles: 0;
  /** size of the file */
  size: bigint;
}

/** a remarkable entry for cloud items */
export type Entry = CollectionEntry | FileEntry;

/** an simple entry produced by the upload api */
export interface UploadEntry {
  /** the document id */
  docID: string;
  /** the document hash */
  hash: string;
}

const uploadEntrySchema: JtdSchema<UploadEntry> = {
  properties: {
    docID: { type: "string" },
    hash: { type: "string" },
  },
};

/** the response when fetching a signed url from google cloud */
interface UrlResponse {
  /** hash requested */
  relative_path: string;
  /** signed url */
  url: string;
  /** expiry time */
  expires: string;
  /** method for request */
  method: RequestMethod;
  /** max upload bytes */
  maxuploadsize_bytes?: number;
}

const urlResponseSchema: JtdSchema<UrlResponse> = {
  properties: {
    relative_path: { type: "string" },
    url: { type: "string" },
    expires: { type: "timestamp" },
    method: { enum: ["POST", "GET", "PUT", "DELETE"] },
  },
  optionalProperties: {
    maxuploadsize_bytes: { type: "float64" },
  },
};

/** common metadata for documents and collections */
export interface CommonMetadata {
  /** name of content */
  visibleName: string;
  /** parent uuid (documentId) or "" for root or "trash" */
  parent?: string;
  /** last modified time */
  lastModified: string;
  /** unknown significance */
  version?: number;
  /** unknown significance */
  pinned?: boolean;
  /** unknown significance */
  synced?: boolean;
  /** unknown significance */
  modified?: boolean;
  /** if file is deleted */
  deleted?: boolean;
  /** unknown significance */
  metadatamodified?: boolean;
}

/** metadata for collection types */
export interface CollectionTypeMetadata extends CommonMetadata {
  /** the key for collection types */
  type: "CollectionType";
}

/** metadata for document types */
export interface DocumentTypeMetadata extends CommonMetadata {
  /** the key for document types */
  type: "DocumentType";
  /** last opened time for documents */
  lastOpened?: string;
  /** last opened page for documents */
  lastOpenedPage?: number;
}

/**
 * metadata for a document or collection (folder)
 *
 * This is found in the the `.metadata` file.
 */
export type Metadata = CollectionTypeMetadata | DocumentTypeMetadata;

/** fields common to all {@link MetadataEntry | MetadataEntries} */
export interface BaseMetadataEntry {
  /** the document id of the entry */
  id: string;
  /** the hash of the entry */
  hash: string;
}

/** the metadata entry for a collection */
export interface CollectionMetadataEntry
  extends BaseMetadataEntry,
    CollectionTypeMetadata {}

/** the metadata entry for a document */
export interface DocumentMetadataEntry
  extends BaseMetadataEntry,
    DocumentTypeMetadata {
  /** the type of the document */
  fileType: FileType;
}

/** a full metadata entry returned by {@link RemarkableApi.getEntriesMetadata} */
export type MetadataEntry = CollectionMetadataEntry | DocumentMetadataEntry;

const commonProperties = {
  visibleName: { type: "string" },
  lastModified: { type: "string" },
} as const;

const commonOptionalProperties = {
  version: { type: "int32" },
  pinned: { type: "boolean" },
  synced: { type: "boolean" },
  modified: { type: "boolean" },
  deleted: { type: "boolean" },
  metadatamodified: { type: "boolean" },
  parent: { type: "string" },
} as const;

const metadataSchema: JtdSchema<Metadata> = {
  discriminator: "type",
  mapping: {
    CollectionType: {
      properties: commonProperties,
      optionalProperties: commonOptionalProperties,
    },
    DocumentType: {
      properties: commonProperties,
      optionalProperties: {
        ...commonOptionalProperties,
        lastOpened: { type: "string" },
        lastOpenedPage: { type: "int32" },
      },
    },
  },
};

const baseMetadataProperties = {
  id: { type: "string" },
  hash: { type: "string" },
} as const;

const metadataEntrySchema: JtdSchema<MetadataEntry> = {
  discriminator: "type",
  mapping: {
    CollectionType: {
      properties: {
        ...commonProperties,
        ...baseMetadataProperties,
      },
      optionalProperties: commonOptionalProperties,
    },
    DocumentType: {
      properties: {
        ...commonProperties,
        ...baseMetadataProperties,
        fileType: { enum: ["notebook", "epub", "pdf", ""] },
      },
      optionalProperties: {
        ...commonOptionalProperties,
        lastOpened: { type: "string" },
        lastOpenedPage: { type: "int32" },
      },
    },
  },
};

/** extra content metadata */
export type ExtraMetadata = Record<string, string | undefined>;

/** remarkable file type; empty for notebook */
export type FileType = "notebook" | "pdf" | "epub" | "";

/** document matrix transform */
export type Transform = Record<`m${1 | 2 | 3}${1 | 2 | 3}`, number>;

/** content document metadata */
export interface DocumentMetadata {
  /** document title */
  title?: string;
  /** document authors */
  authors?: string[];
}

/**
 * content metadata
 *
 * This is found in the `.content` file.
 */
// TODO probably discriminant union on fileType
export interface Content {
  /** is this a dummy document */
  dummyDocument: boolean;
  /** document metadata */
  documentMetadata?: DocumentMetadata;
  /** extra metadata */
  extraMetadata: ExtraMetadata;
  /** file type */
  fileType: FileType;
  /** font */
  fontName?: string;
  /** last opened page */
  lastOpenedPage: number;
  /** line height */
  lineHeight: number;
  /** page margins in points */
  margins: number;
  /** orientation */
  orientation?: "portrait" | "landscape";
  /** number of pages */
  pageCount: number;
  /** page ids */
  pages: string[];
  /** number to use for the coverage page, -1 for last opened */
  coverPageNumber: number;
  /** text scale */
  textScale: number;
  /** page transform */
  transform?: Transform;
  /** format version */
  formatVersion: number;
  /** text alignment */
  textAlignment?: TextAlignment;
}

// ------------ //
// Request Info //
// ------------ //
// In order to be generic, we allow custom implementations of tools provided by
// the browser.

/** anything that can be awaited */
export type Awaitable<T> = T | PromiseLike<T>;

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
  /** headers in response */
  headers: HeadersLike;
  /** get response body as text */
  text(): Awaitable<string>;
  /** get response body as an array buffer */
  arrayBuffer(): Awaitable<ArrayBuffer>;
}

/** stripped down version of fetch */
export interface FetchLike {
  (url: string, options?: RequestInitLike | undefined): Awaitable<ResponseLike>;
}

/** async storage, map like */
export interface CacheLike {
  /** get value for key or undefined if missing */
  get(key: string): Awaitable<string | undefined>;
  /** set value for key */
  set(key: string, value: string): Awaitable<void>;
}

/** stripped down version of subtle crypto */
export interface SubtleCryptoLike {
  /** a digest function */
  digest(algorithm: "SHA-256", data: ArrayBuffer): Promise<ArrayBuffer>;
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

/**
 * an error that results from trying yp update the wrong generation.
 *
 * If we try to update the root hash of files, but the generation has changed
 * relative to the one we're updating from, this will fail.
 */
export class GenerationError extends Error {
  constructor() {
    super(
      "Generation preconditions failed. This means the current state is out of date with the cloud and needs to be re-synced."
    );
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
  }: RegisterOptions = {}
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
      "couldn't register api"
    );
  } else {
    return await resp.text();
  }
}

/** options for uploading an epub document */
export interface PutEpubOptions {
  /** the parent id, default to root */
  parent?: string | undefined;
  /** the margins of the epub 180 is good for articles, 125 for books */
  margins?: number | keyof typeof builtinMargins | undefined;
  /** the height of lines */
  lineHeight?: number | keyof typeof builtinLineHeights | undefined;
  /** the scale of text */
  textScale?: number | keyof typeof builtinTextScales | undefined;
  /** the page orientation */
  orientation?: "portrait" | "landscape" | undefined;
  /** the text alignment */
  textAlignment?: TextAlignment | undefined;
  /** which page should be shone as the cover */
  cover?: "first" | "visited" | undefined;
  /** the font name, should probably come from `builtinFontNames` */
  fontName?: string | undefined;
  /** the tool to have enabled by default */
  lastTool?: string;
}

/** options for uploading a pdf */
export interface PutPdfOptions {
  /** the parent id, default to root */
  parent?: string | undefined;
  /** the page orientation */
  orientation?: "portrait" | "landscape" | undefined;
  /** which page should be shone as the cover */
  cover?: "first" | "visited" | undefined;
  /** the tool to have enabled by default */
  lastTool?: string;
}

/**
 * the api for accessing remarkable functions
 */
export interface RemarkableApi {
  /**
   * get the root hash and the current generation
   *
   * If this hasn't changed, then neither have any of the files.
   */
  getRootHash(): Promise<[string, bigint]>;

  /**
   * write the root hash, incrimenting from the current generation
   *
   * This will fail if the current generation isn't equal to the passed in
   * generation. Use this to preven race conditions. If this rejects, refetch
   * the root hash, resync the updates, and then try to put again.
   *
   * @param hash - the hash of the new root collection
   * @param generation - the current generation this builds off of
   * @returns the new generation
   * @throws {@link GenerationError} if the current cloud generation didn't
   * match the expected pushed generation.
   */
  putRootHash(hash: string, generation: bigint): Promise<bigint>;

  /**
   * get array buffer associated with a hash
   *
   * @param hash - the hash to get text data from
   */
  getBuffer(hash: string): Promise<ArrayBuffer>;

  /**
   * get text content associated with hash
   *
   * This call uses the cache if provided since contents of a specific hash
   * should never change. This isn't atomic so calling with the same hash in
   * quick succession could result in two requests being fired instead of the
   * second waiting for the first.
   *
   * @param hash - the hash to get text data from
   */
  getText(hash: string): Promise<string>;

  /** get metadata from hash */
  getMetadata(hash: string): Promise<Metadata>;

  /** get entries from a collection hash */
  getEntries(hash: string): Promise<Entry[]>;

  /** put a reference to a set of entries into the cloud */
  putEntries(documentId: string, entries: Entry[]): Promise<CollectionEntry>;

  /** put a raw buffer in the cloud */
  putBuffer(documentId: string, buffer: Uint8Array): Promise<FileEntry>;

  /**
   * put a raw text in the cloud
   *
   * This is similar to `putBuffer` but will also cache the upload.
   */
  putText(documentId: string, contents: string): Promise<FileEntry>;

  /**
   * put metadata into the cloud
   *
   * This is a small wrapper around {@link RemarkableApi.putText | `putText`}.
   *
   * @param documentId - this should be the documentId of the item that this is
   *   metadata for; it should not end in `.metadata`
   * @param metadata - the metadata to upload
   */
  putMetadata(documentId: string, metadata: Metadata): Promise<FileEntry>;

  /**
   * create a new collection (folder)
   *
   * @param documentId - the name of the new folder
   * @param parent - the documentId of the parent collection (folder)
   */
  putCollection(visibleName: string, parent?: string): Promise<CollectionEntry>;

  /**
   * upload an epub
   *
   * @remarks this only uploads the raw data and returns an entry that could be
   * uploaded as part of a larger collection. To make sure devices know about
   * it, you'll still need to update the root hash, and potentially notify
   * other devices.
   *
   * @example
   * This example shows a full process upload. Note that it may fail if other
   * devices are simultaneously syncing content. See {@link putRootHash} for
   * more information.
   *
   * ```ts
   * const entry = await api.putEpub(...);
   * const [root, gen] = await api.getRootHash();
   * const rootEntries = await api.getEntries(root);
   * rootEntries.push(entry);
   * const { hash } = await api.putEntries("", rootEntries);
   * const nextGen = await api.putRootHash(hash, gen);
   * await api.syncComplete(nextGen);
   * ```
   *
   * @param visibleName - the name to show for the uploaded epub
   * @param buffer - the epub contents
   * @param opts - extra options you can specify at upload
   */
  putEpub(
    visibleName: string,
    buffer: Uint8Array,
    opts?: PutEpubOptions
  ): Promise<CollectionEntry>;

  /**
   * upload a pdf
   *
   * @remarks this only uploads the raw data and returns an entry that could be
   * uploaded as part of a larger collection. To make sure devices know about
   * it, you'll still need to update the root hash, and potentially notify
   * other devices.
   *
   * @example
   * This example shows a full process upload. Note that it may fail if other
   * devices are simultaneously syncing content. See {@link putRootHash} for
   * more information.
   *
   * ```ts
   * const entry = await api.putPdf(...);
   * const [root, gen] = await api.getRootHash();
   * const rootEntries = await api.getEntries(root);
   * rootEntries.push(entry);
   * const { hash } = await api.putEntries("", rootEntries);
   * const nextGen = await api.putRootHash(hash, gen);
   * await api.syncComplete(nextGen);
   * ```
   *
   * @param visibleName - the name to show for the uploaded pdf
   * @param buffer - the pdf contents
   * @param opts - extra options you can specify at upload
   */
  putPdf(
    visibleName: string,
    buffer: Uint8Array,
    opts?: PutPdfOptions
  ): Promise<CollectionEntry>;

  /**
   * indicate that a sync is complete and push updates to other devices
   *
   * @remarks after successfully putting a new root hash, use this to indicate
   * that other devices should pick up the change.
   */
  syncComplete(generation: bigint): Promise<void>;

  /**
   * get metadata on all entries
   *
   * @remarks this uses a newer api, that returns metadata associated with all
   * entries and their hash and documentId.
   */
  getEntriesMetadata(): Promise<MetadataEntry[]>;

  /**
   * upload an epub
   *
   * @remarks this uses a newer api that performs a full upload and sync, but
   * doesn't allow adding the same level of extra content data. Useful if you
   * just want to upload a document with no fuss.
   *
   * @example
   * ```ts
   * await api.uploadEpub("My EPub", ...);
   * ```
   *
   * @param visibleName - the name to show for the uploaded epub
   * @param buffer - the epub contents
   */
  uploadEpub(visibleName: string, buffer: Uint8Array): Promise<UploadEntry>;

  /**
   * upload a pdf
   *
   * this currently uploads invalid pdfs, but it's not clear why, which is why
   * this is marked as experimental. Potentially some tweak in the formatting
   * of buffer will fix it.
   *
   * @remarks this uses a newer api that performs a full upload and sync, but
   * doesn't allow adding the same level of extra information.
   *
   * @example
   * ```ts
   * await api.uploadPdf("My PDF", ...);
   * ```
   *
   * @param visibleName - the name to show for the uploaded epub
   * @param buffer - the epub contents
   * @experimental
   */
  uploadPdf(visibleName: string, buffer: Uint8Array): Promise<UploadEntry>;
}

/** format an entry */
export function formatEntry({
  hash,
  type,
  documentId,
  subfiles,
  size,
}: Entry): string {
  return `${hash}:${type}:${documentId}:${subfiles}:${size}\n`;
}

/** parse an entry */
export function parseEntry(line: string): Entry {
  const [hash, type, documentId, subfiles, size] = line.split(":");
  if (
    hash === undefined ||
    type === undefined ||
    documentId === undefined ||
    subfiles === undefined ||
    size === undefined
  ) {
    throw new Error(`entries line didn't contain five fields: '${line}'`);
  }
  if (type === "80000000") {
    return {
      hash,
      type,
      documentId,
      subfiles: parseInt(subfiles),
      size: BigInt(size),
    };
  } else if (type === "0") {
    if (subfiles !== "0") {
      throw new Error(
        `file type entry had nonzero number of subfiles: ${subfiles}`
      );
    } else {
      return {
        hash,
        type,
        documentId,
        subfiles: 0,
        size: BigInt(size),
      };
    }
  } else {
    throw new Error(`entries line contained invalid type: ${type}`);
  }
}

/** the implementation of that api */
class Remarkable implements RemarkableApi {
  readonly #userToken: string;
  readonly #fetch: FetchLike;
  readonly #cache: CacheLike | undefined;
  readonly #subtle: SubtleCryptoLike;
  readonly #syncHost: string;

  constructor(
    userToken: string,
    fetch: FetchLike,
    cache: CacheLike | undefined,
    subtle: SubtleCryptoLike,
    syncHost: string
  ) {
    this.#userToken = userToken;
    this.#fetch = fetch;
    this.#cache = cache;
    this.#subtle = subtle;
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
      body?: Uint8Array | string | undefined;
      method?: RequestMethod;
      headers?: Record<string, string>;
    }
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
        `failed reMarkable request: ${msg}`
      );
    } else {
      return resp;
    }
  }

  /** make a signed request to the cloud */
  async #signedFetch(
    { url, method, maxuploadsize_bytes }: UrlResponse,
    body?: string | Uint8Array | undefined,
    add_headers: Record<string, string> = {}
  ): Promise<ResponseLike> {
    const headers = maxuploadsize_bytes
      ? {
          ...add_headers,
          [CONTENT_LENGTH_RANGE_HEADER]: `0,${maxuploadsize_bytes}`,
        }
      : add_headers;
    const resp = await this.#fetch(url, {
      method,
      body,
      headers,
    });
    if (!resp.ok) {
      const msg = await resp.text();
      throw new ResponseError(resp.status, resp.statusText, msg);
    } else {
      return resp;
    }
  }

  /** get the details for how to make a signed request to remarkable cloud */
  async #getUrl(
    relativePath: string,
    gen?: bigint | null | undefined,
    rootHash?: string
  ): Promise<UrlResponse> {
    const key = gen === undefined ? "downloads" : "uploads";
    // NOTE this is done manually to serialize the bigints appropriately
    const body = rootHash
      ? `{ "http_method": "PUT", "relative_path": "${relativePath}", "root_schema": "${rootHash}", "generation": ${gen} }`
      : JSON.stringify({ http_method: "GET", relative_path: relativePath });
    const resp = await this.#authedFetch(
      `${this.#syncHost}/sync/v2/signed-urls/${key}`,
      { body }
    );
    const raw = await resp.text();
    const res = JSON.parse(raw);
    validate(urlResponseSchema, res);
    return res;
  }

  /**
   * get the root hash and the current generation
   */
  async getRootHash(): Promise<[string, bigint]> {
    const signed = await this.#getUrl("root");
    const resp = await this.#signedFetch(signed);
    const generation = resp.headers.get(GENERATION_HEADER);
    if (!generation) {
      throw new Error("no generation header in root hash");
    }
    return [await resp.text(), BigInt(generation)];
  }

  /**
   * write the root hash, incrementing from the current generation
   */
  async putRootHash(hash: string, generation: bigint): Promise<bigint> {
    const signed = await this.#getUrl("root", generation, hash);
    let resp;
    try {
      resp = await this.#signedFetch(signed, hash, {
        [GENERATION_RACE_HEADER]: `${generation}`,
      });
    } catch (ex) {
      if (ex instanceof ResponseError && ex.status === 412) {
        throw new GenerationError();
      } else {
        throw ex;
      }
    }
    const gen = resp.headers.get(GENERATION_HEADER);
    if (!gen) {
      throw new Error("no generation header in root hash");
    }
    return BigInt(gen);
  }

  /**
   * get text content associated with hash
   */
  async getBuffer(hash: string): Promise<ArrayBuffer> {
    const signed = await this.#getUrl(hash);
    const resp = await this.#signedFetch(signed);
    return await resp.arrayBuffer();
  }

  /**
   * get text content associated with hash
   */
  async getText(hash: string): Promise<string> {
    const cached = await this.#cache?.get(hash);
    if (cached) {
      return cached;
    } else {
      const signed = await this.#getUrl(hash);
      const resp = await this.#signedFetch(signed);
      const raw = await resp.text();
      await this.#cache?.set(hash, raw);
      return raw;
    }
  }

  /**
   * get metadata from hash
   */
  async getMetadata(hash: string): Promise<Metadata> {
    const raw = await this.getText(hash);
    const parsed = JSON.parse(raw);
    validate(metadataSchema, parsed);
    return parsed;
  }

  /**
   * get entries from a collection hash
   */
  async getEntries(hash: string): Promise<Entry[]> {
    const raw = await this.getText(hash);
    // slice for trailing new line
    const [schema, ...lines] = raw.slice(0, -1).split("\n");
    if (schema !== SCHEMA_VERSION) {
      throw new Error(`got unexpected schema version: ${schema}`);
    }

    return lines.map(parseEntry);
  }

  /** upload data to hash */
  async #putHash(hash: string, body: Uint8Array | string): Promise<void> {
    const signed = await this.#getUrl(hash, null);
    await this.#signedFetch(signed, body);
  }

  /** put a reference to a set of entries into the cloud */
  async putEntries(
    documentId: string,
    entries: Entry[]
  ): Promise<CollectionEntry> {
    // hash of a collection is the hash of all hashes in documentId order
    const enc = new TextEncoder();
    entries.sort((a, b) => a.documentId.localeCompare(b.documentId));

    const hashes = concatBuffers(entries.map((ent) => fromHex(ent.hash)));
    const digest = await this.#subtle.digest("SHA-256", hashes);
    const hash = toHex(digest);

    const entryContents = entries.map(formatEntry).join("");
    const contents = `${SCHEMA_VERSION}\n${entryContents}`;
    const buffer = enc.encode(contents);
    await this.#putHash(hash, buffer);
    await this.#cache?.set(hash, contents);

    return {
      hash,
      type: "80000000",
      documentId,
      subfiles: entries.length,
      size: 0n,
    };
  }

  /** put a raw buffer in the cloud */
  async putBuffer(documentId: string, buffer: Uint8Array): Promise<FileEntry> {
    const digest = await this.#subtle.digest("SHA-256", buffer);
    const hash = toHex(digest);
    await this.#putHash(hash, buffer);
    return {
      hash,
      type: "0",
      documentId,
      subfiles: 0,
      size: BigInt(buffer.length),
    };
  }

  /** put cached text in the cloud */
  async putText(documentId: string, contents: string): Promise<FileEntry> {
    const enc = new TextEncoder();
    const entry = await this.putBuffer(documentId, enc.encode(contents));
    await this.#cache?.set(entry.hash, contents);
    return entry;
  }

  /** put metadata into the cloud */
  async putMetadata(
    documentId: string,
    metadata: Metadata
  ): Promise<FileEntry> {
    return await this.putText(
      `${documentId}.metadata`,
      JSON.stringify(metadata)
    );
  }

  /** put a new collection (folder) */
  async putCollection(
    visibleName: string,
    parent: string = ""
  ): Promise<CollectionEntry> {
    const documentId = uuid4();
    const lastModified = `${new Date().valueOf()}`;

    const entryPromises: Promise<Entry>[] = [];

    // upload metadata
    const metadata: CollectionTypeMetadata = {
      type: "CollectionType",
      visibleName,
      version: 0,
      parent,
      synced: true,
      lastModified,
    };
    entryPromises.push(this.putMetadata(documentId, metadata));
    entryPromises.push(this.putText(`${documentId}.content`, "{}"));

    const entries = await Promise.all(entryPromises);
    return await this.putEntries(documentId, entries);
  }

  /** upload a content file */
  async #putContent(
    visibleName: string,
    buffer: Uint8Array,
    fileType: "epub" | "pdf",
    parent: string,
    content: Content
  ): Promise<CollectionEntry> {
    /* istanbul ignore if */
    if (content.fileType !== fileType) {
      throw new Error(
        `internal error: fileTypes don't match: ${fileType}, ${content.fileType}`
      );
    }

    const documentId = uuid4();
    const lastModified = `${new Date().valueOf()}`;

    const entryPromises: Promise<Entry>[] = [];

    // upload main document
    entryPromises.push(this.putBuffer(`${documentId}.${fileType}`, buffer));

    // upload metadata
    const metadata: DocumentTypeMetadata = {
      type: "DocumentType",
      visibleName,
      version: 0,
      parent,
      synced: true,
      lastModified,
    };
    entryPromises.push(this.putMetadata(documentId, metadata));
    entryPromises.push(
      this.putText(`${documentId}.content`, JSON.stringify(content))
    );

    // NOTE we technically get the entries a bit earlier, so could upload this
    // before all contents are uploaded, but this also saves us from uploading
    // the contents entry before all have uploaded successfully
    const entries = await Promise.all(entryPromises);
    return await this.putEntries(documentId, entries);
  }

  /** upload an epub */
  async putEpub(
    visibleName: string,
    buffer: Uint8Array,
    {
      parent = "",
      margins = 125,
      orientation,
      textAlignment,
      textScale = 1,
      lineHeight = -1,
      fontName = "",
      cover = "visited",
      lastTool,
    }: PutEpubOptions = {}
  ): Promise<CollectionEntry> {
    // upload content file
    const content: Content = {
      dummyDocument: false,
      extraMetadata: {
        LastTool: lastTool,
      },
      fileType: "epub",
      pageCount: 0,
      lastOpenedPage: 0,
      lineHeight:
        typeof lineHeight === "string"
          ? builtinLineHeights[lineHeight]
          : lineHeight,
      margins: typeof margins === "string" ? builtinMargins[margins] : margins,
      textScale:
        typeof textScale === "string"
          ? builtinTextScales[textScale]
          : textScale,
      pages: [],
      coverPageNumber: cover === "first" ? 0 : -1,
      formatVersion: 1,
      orientation,
      textAlignment,
      fontName,
    };
    return await this.#putContent(visibleName, buffer, "epub", parent, content);
  }

  /** upload a pdf */
  async putPdf(
    visibleName: string,
    buffer: Uint8Array,
    { parent = "", orientation, cover = "first", lastTool }: PutPdfOptions = {}
  ): Promise<CollectionEntry> {
    // upload content file
    const content: Content = {
      dummyDocument: false,
      extraMetadata: {
        LastTool: lastTool,
      },
      fileType: "pdf",
      pageCount: 0,
      lastOpenedPage: 0,
      lineHeight: -1,
      margins: 125,
      textScale: 1,
      pages: [],
      coverPageNumber: cover === "first" ? 0 : -1,
      formatVersion: 1,
      orientation,
    };
    return await this.#putContent(visibleName, buffer, "pdf", parent, content);
  }

  /** send sync complete request */
  async syncComplete(generation: bigint): Promise<void> {
    // NOTE this is done manually to properly serialize the bigint
    const body = `{ "generation": ${generation} }`;
    await this.#authedFetch(`${this.#syncHost}/sync/v2/sync-complete`, {
      body,
    });
  }

  /** get entries and metadata for all files */
  async getEntriesMetadata(): Promise<MetadataEntry[]> {
    const resp = await this.#authedFetch(`${this.#syncHost}/doc/v2/files`, {
      method: "GET",
      headers: {
        "rm-source": "RoR-Browser",
      },
    });
    const raw = await resp.text();
    const res = JSON.parse(raw);
    const schema: JtdSchema<MetadataEntry[]> = {
      elements: metadataEntrySchema,
    };
    validate(schema, res);
    return res;
  }

  /** upload a file */
  async #uploadFile(
    visibleName: string,
    buffer: Uint8Array,
    contentType: `application/${"epub+zip" | "pdf"}`
  ): Promise<UploadEntry> {
    const encoder = new TextEncoder();
    const meta = encoder.encode(JSON.stringify({ file_name: visibleName }));
    const resp = await this.#authedFetch(`${this.#syncHost}/doc/v2/files`, {
      body: buffer,
      headers: {
        "content-type": contentType,
        "rm-meta": fromByteArray(meta),
        "rm-source": "RoR-Browser",
      },
    });
    const raw = await resp.text();
    const res = JSON.parse(raw);
    validate(uploadEntrySchema, res);
    return res;
  }

  /** upload an epub */
  async uploadEpub(
    visibleName: string,
    buffer: Uint8Array
  ): Promise<UploadEntry> {
    return await this.#uploadFile(visibleName, buffer, "application/epub+zip");
  }

  /** upload a pdf */
  async uploadPdf(
    visibleName: string,
    buffer: Uint8Array
  ): Promise<UploadEntry> {
    // TODO why doesn't this work
    return await this.#uploadFile(visibleName, buffer, "application/pdf");
  }
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
   */
  fetch?: FetchLike;

  /**
   * an optional cache for text requests
   *
   * If you're using the api to sync between a local copy and the cloud, you'll
   * want to keep a cache so that as long as a file's hash doesn't change you
   * don't need to request another copy.
   *
   * @remarks currently there are no mechanisms that actually clear the cache,
   * so be warned if the cache doesn't have an auto clearning mechansim that
   * some old files may stay around for quite a while
   */
  cache?: CacheLike;

  /**
   * a subtle-crypto-like object
   *
   * This should have a digest function like the api of `crypto.subtle`, it's
   * default value.  In node try
   * `import { webcrypto } from "crypto"; global.crypto = webcrypto` or pass in
   * `webcrypto.subtle`.
   */
  subtle?: SubtleCryptoLike;

  /** the url for making authorization requests */
  authHost?: string;

  /** the url for making raw document requests */
  docHost?: string;

  /** the url for making synchronization requests */
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
    cache,
    subtle = globalThis.crypto?.subtle,
    authHost = AUTH_HOST,
    syncHost = SYNC_HOST,
  }: RemarkableOptions = {}
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
  return new Remarkable(userToken, fetch, cache, subtle, syncHost);
}
