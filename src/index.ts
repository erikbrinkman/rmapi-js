/**
 * Create and interact with reMarkable cloud.
 *
 * After getting a device token with the {@link register | `register`} method,
 * persist it and create api instances using {@link remarkable | `remarkable`}.
 * Outside of registration, all relevant methods are in
 * {@link RemarkableApi | `RemarkableApi`}, or it's interior
 * {@link RawRemarkableApi | `RawRemarkableApi`} (for lower level functions).
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
 * // list all items (documents and collections)
 * const [first, ...rest] = api.listItems();
 * // rename first item
 * const entry = api.rename(first.hash, "new name");
 * ```
 *
 * @example
 * A simple upload
 * ```ts
 * import { remarkable } from "rmapi-js";
 *
 * const api = await remarkable(...);
 * const entry = await api.putEpub("document name", epubBuffer);
 * ```
 *
 * @remarks
 *
 * The cloud api is essentially a collection of entries. Each entry has an id,
 * which is a uuid4 and a hash, which indicates it's current state, and changes
 * as the item mutates, where the id is constant. Most mutable operations take
 * the initial hash so that merge conflicts can be resolved. Each entry has a
 * number of properties, but a key property is the `parent`, which represents
 * its parent in the file structure. This will be another document id, or one of
 * two special ids, "" (the empty string) for the root directory, or "trash" for
 * the trash.
 *
 * Detailed information about the low-level storage an apis can be found in
 * {@link RawRemarkableApi | `RawRemarkableApi`}.
 *
 * Additionally, this entire api was reverse engineered, so some things are only
 * `[speculative]`, or entirely `[unknown]`. If something breaks, please
 * [file an issue!](https://github.com/erikbrinkman/rmapi-js/issues)
 *
 * @packageDocumentation
 */
import JSZip from "jszip";
import { type CompiledSchema, nullable, string, values } from "jtd-ts";
import { v4 as uuid4 } from "uuid";
import { HashNotFoundError, ValidationError } from "./error";
import { LruCache } from "./lru";
import {
  type BackgroundFilter,
  type CollectionContent,
  type Content,
  type DocumentContent,
  type Entries,
  type Metadata,
  type Orientation,
  type RawEntry,
  RawRemarkable,
  type RawRemarkableApi,
  type RequestMethod,
  type SchemaVersion,
  type SimpleEntry,
  type Tag,
  type TemplateContent,
  type TextAlignment,
  type ZoomMode,
} from "./raw";

export { HashNotFoundError, ValidationError } from "./error";
export type {
  BackgroundFilter,
  CollectionContent,
  Content,
  CPageNumberValue,
  CPagePage,
  CPageStringValue,
  CPages,
  CPageUUID,
  DocumentContent,
  DocumentMetadata,
  Entries,
  FileType,
  KeyboardMetadata,
  Metadata,
  Orientation,
  PageTag,
  RawEntry,
  RawRemarkableApi,
  SchemaVersion,
  SimpleEntry,
  Tag,
  TemplateContent,
  TextAlignment,
  UploadMimeType,
  ZoomMode,
} from "./raw";

const AUTH_HOST = "https://webapp-prod.cloud.remarkable.engineering";
const RAW_HOST = "https://eu.tectonic.remarkable.com";
const UPLOAD_HOST = "https://internal.cloud.remarkable.com";

// ------------ //
// Request Info //
// ------------ //
// The section has all the types that are stored in the remarkable cloud.

const idReg =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}||trash)$/;

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
  /** true if the entry is starred in most ui elements */
  pinned: boolean;
  /**
   * the parent of this entry
   *
   * There are two special parents, "" (empty string) for the root directory,
   * and "trash" for the trash
   */
  parent?: string;
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
  /** the timestamp of the last time this entry was opened */
  lastOpened: string;
}

/** a template, such as from methods.remarkable.com */
export interface TemplateType extends EntryCommon {
  /** the key to identify this as a template */
  type: "TemplateType";
  /** the timestamp of when the template was added/created */
  createdTime?: string;
  /** where this template was installed from */
  source?: string;
  /** indicates if this is a newly-installed template */
  new?: boolean;
}

/** a remarkable entry for cloud items */
export type Entry = CollectionEntry | DocumentType | TemplateType;

/** the new hash of a modified entry */
export interface HashEntry {
  /** the actual hash */
  hash: string;
}

/** the mapping from old hashes to new hashes after a bulk modify */
export interface HashesEntry {
  /** the mapping from old to new hashes */
  hashes: Record<string, string>;
}

/** options for creating a folder */
export interface FolderOptions {
  /** the id of the folder's parent directory, "" or omitted for root */
  parent?: string;
}

/** An error that gets thrown when the backend while trying to update
 *
 * IF you encounter this error, you likely just need to try th request again. If
 * you're trying to do several high-level `put` operations simultaneously,
 * you'll likely encounter this error. You should either try to do them
 * serially, or call the low level api directly to do one generation update.
 *
 * @see {@link RawRemarkableApi | `RawRemarkableApi`}
 */
export class GenerationError extends Error {
  constructor() {
    super("root generation was stale; try put again");
  }
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

/**
 * options for putting a file onto reMarkable
 *
 * This is a more customizable version of the options available when using the
 * simpler upload api. This comes with the risk that is uses lower level apis,
 * and therefore has more failure points.
 *
 * @see {@link Content | `Content`} and {@link Metadata | `Metadata`} for more
 * information on what these fields correspond to
 */
export interface PutOptions {
  /**
   * the collection to put this in
   *
   * The empty string ("") (default) is the root, "trash" is in the trash,
   * otherwise this should be the uuid of a collection item to place this in.
   */
  parent?: string;
  /** true to star the item */
  pinned?: boolean;
  /** 0 for first page, -1 for last visited */
  coverPageNumber?: number;
  /** document metadata authors */
  authors?: string[];
  /** document metadata tile, NOTE this is not visibleName */
  title?: string;
  /** the publication date, as an ISO date or timestamp */
  publicationDate?: string;
  /** the publisher */
  publisher?: string;
  /** extra metadata often in the form of pen choices */
  extraMetadata?: Record<string, string>;
  /** the font to use for rendering */
  fontName?: string;
  /** the line height to render */
  lineHeight?: number;
  /** the margins to render */
  margins?: number;
  /** the document orientation */
  orientation?: Orientation;
  /** the names of the tags to add */
  tags?: string[];
  /** the document text alignment */
  textAlignment?: TextAlignment;
  /** the text scale of the document */
  textScale?: number;
  /** the document zoom mode */
  zoomMode?: ZoomMode;
  /** the contrast filter setting */
  viewBackgroundFilter?: BackgroundFilter;
  /**
   * whether to refresh current file structure before putting
   *
   * If you suspect that other changes have been made to the remarkable backend
   * between the last put and now, setting this to true will avoid a
   * {@link GenerationError | `GenerationError`}, but will cause an unnecessary
   * GET request otherwise.
   */
  refresh?: boolean;
}

/**
 * the api for accessing remarkable functions
 *
 * There are roughly two types of functions.
 * - high-level api functions that provide simple access with a single round
 *   trip based on the web api
 * - low-level wrapped functions that take more round trips, but provide more
 *   control and may be faster since they can be cached.
 *
 * Most of these functions validate the return values so that typescript is
 * accurate. However, sometimes those return values are more strict than the
 * "true" underlying types. If this happens, please [submit a an
 * issue](https://github.com/erikbrinkman/rmapi-js/issues). In the mean time,
 * you should be able to use the low level api to work around any restrictive
 * validation.
 */
export interface RemarkableApi {
  /** scoped access to the raw low-level api */
  raw: RawRemarkableApi;

  /**
   * list all items
   *
   * Items include both collections and documents. Documents that are in folders
   * will have their parent set to something other than "" or "trash", but
   * everything will be returned by this function.
   *
   * @example
   * ```ts
   * await api.listItems();
   * ```
   *
   * @remarks
   * This is now backed by the low level api, and you may notice some
   * performance degradation if not taking advantage of the cache.
   *
   * @param refresh - if true, refresh the root hash before listing
   * @returns a list of all items with some metadata
   */
  listItems(refresh?: boolean): Promise<Entry[]>;

  /**
   * similar to {@link listItems | `listItems`} but backed by the low level api
   *
   * @param refresh - if true, refresh the root hash before listing
   */
  listIds(refresh?: boolean): Promise<SimpleEntry[]>;

  /**
   * get the content metadata from an item hash
   *
   * This takes the high level item hash, e.g. the hashes you get from
   * {@link listItems | `listItems`} or {@link listIds | `listIds`}.
   *
   * @remarks
   * If this fails validation and you still want to get the content, you can use
   * the low-level api to get the raw text of the `.content` file in the
   * `RawEntry` for this hash.
   *
   * @param hash - the hash of the item to get content for
   * @returns the content
   */
  getContent(hash: string): Promise<Content>;

  /**
   * get the metadata from an item hash
   *
   * This takes the high level item hash, e.g. the hashes you get from
   * {@link listItems | `listItems`} or {@link listIds | `listIds`}.
   *
   * @remarks
   * If this fails validation and you still want to get the content, you can use
   * the low-level api to get the raw text of the `.metadata` file in the
   * `RawEntry` for this hash.
   *
   * @param hash - the hash of the item to get metadata for
   * @returns the metadata
   */
  getMetadata(hash: string): Promise<Metadata>;

  /**
   * get the pdf associated with a document hash
   *
   * This returns the raw input pdf, not the rendered pdf with any markup.
   *
   * @param hash - the hash of the document to get the pdf for (e.g. the hash
   *     received from `listItems`)
   * @returns the pdf bytes
   */
  getPdf(hash: string): Promise<Uint8Array>;

  /**
   * get the epub associated with a document hash
   *
   * This returns the raw input epub if a document was created from an epub.
   *
   * @param hash - the hash of the document to get the pdf for (e.g. the hash
   *     received from `listItems`)
   * @returns the epub bytes
   */
  getEpub(hash: string): Promise<Uint8Array>;

  /**
   * get the entire contents of a remarkable document
   *
   * This gets every file of associated with a document, and puts them into a
   * zip archive.
   *
   * @remarks
   * This is an experimental feature, that works for downloading the raw version
   * of the document, but this format isn't understood enoguh to reput this on a
   * different remarkable, so that functionality is currently disabled.
   *
   * @param hash - the hash of the document to get the contents for (e.g. the
   *    hash received from `listItems`)
   */
  getDocument(hash: string): Promise<Uint8Array>;

  /**
   * use the low-level api to add a pdf document
   *
   * Since this uses the low-level api, it provides more options than
   * {@link uploadPdf | `uploadPdf`}, but is a little more finicky. Notably, it
   * may throw a {@link GenerationError | `GenerationError`} if the generation
   * doesn't match the current server generation, requiring you to retry until
   * it works.
   *
   * @param visibleName - the name to display on the reMarkable
   * @param buffer - the raw pdf
   * @param opts - put options
   * @throws GenerationError if the generation doesn't match the current server generation
   * @returns the entry for the newly inserted document
   */
  putPdf(
    visibleName: string,
    buffer: Uint8Array,
    opts?: PutOptions,
  ): Promise<SimpleEntry>;

  /**
   * use the low-level api to add an epub document
   *
   * Since this uses the low-level api, it provides more options than
   * {@link uploadEpub | `uploadEpub`}, but is a little more finicky. Notably, it
   * may throw a {@link GenerationError | `GenerationError`} if the generation
   * doesn't match the current server generation, requiring you to retry until
   * it works.
   *
   * @param visibleName - the name to display on the reMarkable
   * @param buffer - the raw epub
   * @param opts - put options
   * @throws GenerationError if the generation doesn't match the current server generation
   * @returns the entry for the newly inserted document
   */
  putEpub(
    visibleName: string,
    buffer: Uint8Array,
    opts?: PutOptions,
  ): Promise<SimpleEntry>;

  /** create a folder */
  putFolder(
    visibleName: string,
    opts?: FolderOptions,
    refresh?: boolean,
  ): Promise<SimpleEntry>;

  /**
   * upload an epub
   *
   * @example
   * ```ts
   * await api.uploadEpub("My EPub", ...);
   * ```
   *
   * @remarks
   * this uses a simpler api that works even with schema version 4.
   *
   * @param visibleName - the name to show for the uploaded epub
   * @param buffer - the epub contents
   */
  uploadEpub(visibleName: string, buffer: Uint8Array): Promise<SimpleEntry>;

  /**
   * upload a pdf
   *
   * @example
   * ```ts
   * await api.uploadPdf("My PDF", ...);
   * ```
   *
   * @remarks
   * this uses a simpler api that works even with schema version 4.
   *
   * @param visibleName - the name to show for the uploaded epub
   * @param buffer - the epub contents
   */
  uploadPdf(visibleName: string, buffer: Uint8Array): Promise<SimpleEntry>;

  /** create a folder using the simple api */
  uploadFolder(visibleName: string): Promise<SimpleEntry>;

  /**
   * update content metadata for a document
   *
   * @example
   * ```ts
   * await api.updateDocument(doc.hash, { textAlignment: "left" });
   * ```
   *
   * @param hash - the hash of the file to update
   * @param content - the fields of content to update
   */
  updateDocument(
    hash: string,
    content: Partial<DocumentContent>,
    refresh?: boolean,
  ): Promise<HashEntry>;

  /**
   * update content metadata for a collection
   *
   * @example
   * ```ts
   * await api.updateCollection(doc.hash, { textAlignment: "left" });
   * ```
   *
   * @param hash - the hash of the file to update
   * @param content - the fields of content to update
   */
  updateCollection(
    hash: string,
    content: Partial<CollectionContent>,
    refresh?: boolean,
  ): Promise<HashEntry>;

  /**
   * update content metadata for a template
   *
   * @example
   * ```ts
   * await api.updateTemplate(doc.hash, { textAlignment: "left" });
   * ```
   *
   * @param hash - the hash of the file to update
   * @param content - the fields of content to update
   */
  updateTemplate(
    hash: string,
    content: Partial<TemplateContent>,
    refresh?: boolean,
  ): Promise<HashEntry>;

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
  move(hash: string, parent: string, refresh?: boolean): Promise<HashEntry>;

  /**
   * delete an entry
   *
   * @example
   * ```ts
   * await api.delete(file.hash);
   * ```
   * @param hash - the hash of the entry to delete
   */
  delete(hash: string, refresh?: boolean): Promise<HashEntry>;

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
    refresh?: boolean,
  ): Promise<HashEntry>;

  /**
   * set if an entry is stared
   *
   * @example
   * ```ts
   * await api.stared(file.hash, true);
   * ```
   * @param hash - the hash of the entry to rename
   * @param stared - whether the entry should be stared or not
   */
  stared(hash: string, stared: boolean, refresh?: boolean): Promise<HashEntry>;

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
    refresh?: boolean,
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
    refresh?: boolean,
  ): Promise<HashesEntry>;

  /**
   * get the current cache value as a string
   *
   * You can use this to warm start a new instance of
   * {@link remarkable | `remarkable`} with any previously cached results.
   */
  dumpCache(): string;

  /**
   * prune the cache so that it contains only reachable hashes
   *
   * The cache is append only, so it can grow without bound, even as hashes
   * become unreachable. In the future, this may have better cache management to
   * track this in real time, but for now, you can call this method, to keep it
   * from growing continuously.
   *
   * @remarks
   * This won't necessarily reduce the cache size. In order to see if
   * hashes are reachable we first have to search through all existing entry
   * lists.
   *
   * @param refresh - whether to refresh the root hash before pruning
   */
  pruneCache(refresh?: boolean): Promise<void>;

  /**
   * completely delete the cache
   *
   * If the cache is causing memory issues, you can clear it, but this will hurt
   * performance.
   */
  clearCache(): void;
}

/** the implementation of that api */
class Remarkable implements RemarkableApi {
  readonly #sessionToken: string;
  /** the same cache that underlies the raw api, allowing us to modify it */
  readonly #cache: Map<string, string | null>;
  readonly raw: RawRemarkable;
  #lastHashGen: readonly [string, number, SchemaVersion] | undefined;

  constructor(
    sessionToken: string,
    rawHost: string,
    uploadHost: string,
    cache: Map<string, string | null>,
  ) {
    this.#sessionToken = sessionToken;
    this.#cache = cache;
    this.raw = new RawRemarkable(
      (method, url, { body, headers } = {}) =>
        this.#authedFetch(url, { method, body, headers }),
      cache,
      rawHost,
      uploadHost,
    );
  }

  async #getRootHash(
    refresh: boolean = false,
  ): Promise<readonly [string, number, SchemaVersion]> {
    if (refresh || this.#lastHashGen === undefined) {
      this.#lastHashGen = await this.raw.getRootHash();
    }
    return this.#lastHashGen;
  }

  async #putRootHash(hash: string, generation: number): Promise<void> {
    try {
      const [rootHash, gen] = await this.raw.putRootHash(hash, generation);
      const [, , schemaVersion] = this.#lastHashGen!; // guaranteed to be set
      this.#lastHashGen = [rootHash, gen, schemaVersion];
    } catch (ex) {
      // if we hit a generation error, invalidate our cached generation
      if (ex instanceof GenerationError) {
        this.#lastHashGen = undefined;
      }
      throw ex;
    }
  }

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
    },
  ): Promise<Response> {
    const resp = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.#sessionToken}`,
        ...headers,
      },
      // fetch works correctly with uint8 arrays, but is not hinted correctly
      body: body as unknown as ArrayBuffer,
    });
    if (!resp.ok) {
      const msg = await resp.text();
      if (msg === '{"message":"precondition failed"}\n') {
        throw new GenerationError();
      } else {
        throw new ResponseError(
          resp.status,
          resp.statusText,
          `failed reMarkable request: ${msg}`,
        );
      }
    } else {
      return resp;
    }
  }

  async #convertEntry({ hash, id }: SimpleEntry): Promise<Entry> {
    const { entries } = await this.raw.getEntries(hash);
    const metaEnt = entries.find((ent) => ent.id.endsWith(".metadata"));
    const contentEnt = entries.find((ent) => ent.id.endsWith(".content"));
    if (metaEnt === undefined) {
      throw new Error(`couldn't find metadata for hash ${hash}`);
    }

    const [
      {
        visibleName,
        lastModified,
        pinned,
        parent,
        lastOpened,
        new: isNew,
        source,
      },
      content,
    ] = await Promise.all([
      this.raw.getMetadata(metaEnt.hash),
      // collections don't always have content, since content only lists tags
      contentEnt === undefined
        ? Promise.resolve({ fileType: undefined, tags: undefined })
        : this.raw.getContent(contentEnt.hash),
    ]);
    if ("templateVersion" in content) {
      return {
        id,
        hash,
        visibleName,
        lastModified,
        new: isNew,
        pinned,
        source,
        parent,
        type: "TemplateType",
      };
    } else if (content.fileType === undefined) {
      return {
        id,
        hash,
        visibleName,
        lastModified,
        pinned,
        parent,
        tags: content.tags,
        type: "CollectionType",
      };
    } else {
      return {
        id,
        hash,
        visibleName,
        lastModified,
        pinned,
        parent,
        tags: content.tags,
        lastOpened: lastOpened ?? "",
        fileType: content.fileType,
        type: "DocumentType",
      };
    }
  }

  /** list all items */
  async listItems(refresh: boolean = false): Promise<Entry[]> {
    const ids = await this.listIds(refresh);
    return await Promise.all(ids.map((id) => this.#convertEntry(id)));
  }

  async listIds(refresh: boolean = false): Promise<SimpleEntry[]> {
    const [hash] = await this.#getRootHash(refresh);
    const { entries } = await this.raw.getEntries(hash);
    return entries.map(({ id, hash }) => ({ id, hash }));
  }

  async getContent(hash: string): Promise<Content> {
    const { entries } = await this.raw.getEntries(hash);
    const [cont] = entries.filter((e) => e.id.endsWith(".content"));
    if (cont === undefined) {
      throw new Error(`couldn't find contents for hash ${hash}`);
    } else {
      return await this.raw.getContent(cont.hash);
    }
  }

  async getMetadata(hash: string): Promise<Metadata> {
    const { entries } = await this.raw.getEntries(hash);
    const [meta] = entries.filter((e) => e.id.endsWith(".metadata"));
    if (meta === undefined) {
      throw new Error(`couldn't find metadata for hash ${hash}`);
    } else {
      return await this.raw.getMetadata(meta.hash);
    }
  }

  async getPdf(hash: string): Promise<Uint8Array> {
    const { entries } = await this.raw.getEntries(hash);
    const [pdf] = entries.filter((e) => e.id.endsWith(".pdf"));
    if (pdf === undefined) {
      throw new Error(`couldn't find pdf for hash ${hash}`);
    } else {
      return await this.raw.getHash(pdf.hash);
    }
  }

  async getEpub(hash: string): Promise<Uint8Array> {
    const { entries } = await this.raw.getEntries(hash);
    const [epub] = entries.filter((e) => e.id.endsWith(".epub"));
    if (epub === undefined) {
      throw new Error(`couldn't find epub for hash ${hash}`);
    } else {
      return await this.raw.getHash(epub.hash);
    }
  }

  async getDocument(hash: string): Promise<Uint8Array> {
    const { entries } = await this.raw.getEntries(hash);
    const zip = new JSZip();
    for (const entry of entries) {
      // TODO if this is .metadata we might want to assert type === "DocumentType"
      zip.file(entry.id, this.raw.getHash(entry.hash));
    }
    return zip.generateAsync({ type: "uint8array" });
  }

  async #putFile(
    visibleName: string,
    fileType: "epub" | "pdf",
    buffer: Uint8Array,
    {
      refresh,
      parent = "",
      pinned = false,
      zoomMode = "bestFit",
      viewBackgroundFilter,
      textScale = 1,
      textAlignment = "justify",
      fontName = "",
      coverPageNumber = -1,
      authors,
      title,
      publicationDate,
      publisher,
      extraMetadata = {},
      lineHeight = -1,
      margins = 125,
      orientation = "portrait",
      tags,
    }: PutOptions,
  ): Promise<SimpleEntry> {
    if (parent && !idReg.test(parent)) {
      throw new ValidationError(
        parent,
        idReg,
        "parent must be a valid document id",
      );
    }
    const id = uuid4();
    const now = new Date();
    const metadata: Metadata = {
      parent,
      pinned,
      lastModified: (+now).toFixed(),
      createdTime: (+now).toFixed(),
      type: "DocumentType",
      visibleName,
      lastOpened: "0",
      lastOpenedPage: 0,
    };
    const content: DocumentContent = {
      coverPageNumber,
      documentMetadata: { authors, title, publicationDate, publisher },
      extraMetadata,
      lineHeight,
      margins,
      orientation,
      fileType,
      formatVersion: 1,
      tags: tags?.map((name) => ({ name, timestamp: +now })) ?? [],
      fontName,
      textAlignment,
      textScale,
      zoomMode,
      viewBackgroundFilter,
      // NOTE for some reason we need to "fake" the number of pages at 1, and
      // create "valid" output for that
      originalPageCount: 1,
      pageCount: 1,
      pageTags: [],
      pages: [uuid4()],
      redirectionPageMap: [0],
      sizeInBytes: buffer.length.toFixed(),
    };

    // upload raw files, and get root hash
    const [
      [contentEntry, uploadContent],
      [metadataEntry, uploadMetadata],
      [pagedataEntry, uploadPagedata],
      [fileEntry, uploadFile],
      [rootHash, generation, schemaVersion],
    ] = await Promise.all([
      this.raw.putContent(`${id}.content`, content),
      this.raw.putMetadata(`${id}.metadata`, metadata),
      // eslint-disable-next-line spellcheck/spell-checker
      this.raw.putText(`${id}.pagedata`, "\n"),
      this.raw.putFile(`${id}.${fileType}`, buffer),
      this.#getRootHash(refresh),
    ]);

    // now fetch root entries and upload this file entry
    const [[collectionEntry, uploadCollection], { entries: rootEntries }] =
      await Promise.all([
        this.raw.putEntries(
          id,
          [contentEntry, metadataEntry, pagedataEntry, fileEntry],
          schemaVersion,
        ),
        this.raw.getEntries(rootHash),
      ]);

    // now upload a new root entry
    rootEntries.push(collectionEntry);
    const [rootEntry, uploadRoot] = await this.raw.putEntries(
      "root",
      rootEntries,
      schemaVersion,
    );

    // before updating the root hash, first upload everything
    await Promise.all([
      uploadContent,
      uploadMetadata,
      uploadPagedata,
      uploadFile,
      uploadCollection,
      uploadRoot,
    ]);

    // TODO we could return a full entry here, but we should probably decide
    // what that should be, e.g. we could return more fields than the standard
    // entry. Same for putFolder
    // TODO we should also decide if the api should take hashes or ids...
    await this.#putRootHash(rootEntry.hash, generation);
    return { id, hash: collectionEntry.hash };
  }

  async putPdf(
    visibleName: string,
    buffer: Uint8Array,
    opts: PutOptions = {},
  ): Promise<SimpleEntry> {
    return await this.#putFile(visibleName, "pdf", buffer, opts);
  }

  async putEpub(
    visibleName: string,
    buffer: Uint8Array,
    opts: PutOptions = {},
  ): Promise<SimpleEntry> {
    return await this.#putFile(visibleName, "epub", buffer, opts);
  }

  /** create a folder */
  async putFolder(
    visibleName: string,
    { parent = "" }: FolderOptions = {},
    refresh: boolean = false,
  ): Promise<SimpleEntry> {
    if (parent && !idReg.test(parent)) {
      throw new ValidationError(
        parent,
        idReg,
        "parent must be a valid document id",
      );
    }
    const id = uuid4();
    const now = new Date();
    const content: CollectionContent = {
      tags: [],
    };
    const metadata: Metadata = {
      lastModified: (+now).toFixed(),
      createdTime: (+now).toFixed(),
      parent,
      pinned: false,
      type: "CollectionType",
      visibleName,
    };

    // upload folder contents
    const [
      [contentEntry, uploadContent],
      [metadataEntry, uploadMetadata],
      [rootHash, generation, schemaVersion],
    ] = await Promise.all([
      this.raw.putContent(`${id}.content`, content),
      this.raw.putMetadata(`${id}.metadata`, metadata),
      this.#getRootHash(refresh),
    ]);

    // now fetch root entries and upload this file entry
    const [[collectionEntry, uploadCollection], { entries: rootEntries }] =
      await Promise.all([
        this.raw.putEntries(id, [contentEntry, metadataEntry], schemaVersion),
        this.raw.getEntries(rootHash),
      ]);

    // now upload a new root entry
    rootEntries.push(collectionEntry);
    const [rootEntry, uploadRoot] = await this.raw.putEntries(
      "root",
      rootEntries,
      schemaVersion,
    );

    // before updating the root hash, first upload everything
    await Promise.all([
      uploadContent,
      uploadMetadata,
      uploadCollection,
      uploadRoot,
    ]);

    // put root hash and return
    await this.#putRootHash(rootEntry.hash, generation);
    return { id, hash: collectionEntry.hash };
  }

  /** upload an epub */
  async uploadEpub(
    visibleName: string,
    buffer: Uint8Array,
  ): Promise<SimpleEntry> {
    return await this.raw.uploadFile(
      visibleName,
      buffer,
      "application/epub+zip",
    );
  }

  /** upload a pdf */
  async uploadPdf(
    visibleName: string,
    buffer: Uint8Array,
  ): Promise<SimpleEntry> {
    return await this.raw.uploadFile(visibleName, buffer, "application/pdf");
  }

  /** upload a folder */
  async uploadFolder(visibleName: string): Promise<SimpleEntry> {
    return await this.raw.uploadFile(visibleName, new Uint8Array(0), "folder");
  }

  /** edit just a content entry */
  async #editContentRaw(
    id: string,
    hash: string,
    update: Partial<Content>,
    schemaVersion: SchemaVersion,
  ): Promise<[RawEntry, Promise<[void, void]>]> {
    const { entries } = await this.raw.getEntries(hash);
    const contInd = entries.findIndex((ent) => ent.id.endsWith(".content"));
    const contEntry = entries[contInd];
    if (contEntry === undefined) {
      throw new Error("internal error: couldn't find content in entry hash");
    }
    const cont = await this.raw.getContent(contEntry.hash);
    Object.assign(cont, update);
    const [newContEntry, uploadCont] = await this.raw.putContent(
      contEntry.id,
      cont,
    );
    entries[contInd] = newContEntry;
    const [result, uploadEntries] = await this.raw.putEntries(
      id,
      entries,
      schemaVersion,
    );
    const upload = Promise.all([uploadCont, uploadEntries]);
    return [result, upload];
  }

  /** fully sync a content edit */
  async #editContent(
    hash: string,
    update: Partial<Content>,
    expectedType: "DocumentType" | "CollectionType" | "TemplateType",
    refresh: boolean,
  ): Promise<HashEntry> {
    const [rootHash, generation, schemaVersion] =
      await this.#getRootHash(refresh);
    const { entries } = await this.raw.getEntries(rootHash);
    const hashInd = entries.findIndex((ent) => ent.hash === hash);
    const hashEnt = entries[hashInd];
    if (hashEnt === undefined) {
      throw new HashNotFoundError(hash);
    }

    const [[newEnt, uploadEnt], meta] = await Promise.all([
      this.#editContentRaw(hashEnt.id, hash, update, schemaVersion),
      this.getMetadata(hash),
    ]);
    if (meta.type !== expectedType) {
      throw new Error(
        `expected type ${expectedType} but got ${meta.type} for hash ${hash}`,
      );
    }

    entries[hashInd] = newEnt;
    const [rootEntry, uploadRoot] = await this.raw.putEntries(
      "root",
      entries,
      schemaVersion,
    );

    await Promise.all([uploadEnt, uploadRoot]);
    await this.#putRootHash(rootEntry.hash, generation);
    return { hash: newEnt.hash };
  }

  /** update document content */
  async updateDocument(
    hash: string,
    content: Partial<DocumentContent>,
    refresh: boolean = false,
  ): Promise<HashEntry> {
    return await this.#editContent(hash, content, "DocumentType", refresh);
  }

  /** update collection content */
  async updateCollection(
    hash: string,
    content: Partial<CollectionContent>,
    refresh: boolean = false,
  ): Promise<HashEntry> {
    return await this.#editContent(hash, content, "CollectionType", refresh);
  }

  /** update template content */
  async updateTemplate(
    hash: string,
    content: Partial<TemplateContent>,
    refresh: boolean = false,
  ): Promise<HashEntry> {
    return await this.#editContent(hash, content, "TemplateType", refresh);
  }

  async #editMetaRaw(
    id: string,
    hash: string,
    update: Partial<Metadata>,
    schemaVersion: SchemaVersion,
  ): Promise<[RawEntry, Promise<[void, void]>]> {
    const { entries } = await this.raw.getEntries(hash);
    const metaInd = entries.findIndex((ent) => ent.id.endsWith(".metadata"));
    const metaEntry = entries[metaInd];
    if (metaEntry === undefined) {
      throw new Error("internal error: couldn't find metadata in entry hash");
    }
    const meta = await this.raw.getMetadata(metaEntry.hash);
    Object.assign(meta, update);
    const [newMetaEntry, uploadMeta] = await this.raw.putMetadata(
      metaEntry.id,
      meta,
    );
    entries[metaInd] = newMetaEntry;
    const [result, uploadEntries] = await this.raw.putEntries(
      id,
      entries,
      schemaVersion,
    );
    const upload = Promise.all([uploadMeta, uploadEntries]);
    return [result, upload];
  }

  async #editMeta(
    hash: string,
    update: Partial<Metadata>,
    refresh: boolean = false,
  ): Promise<HashEntry> {
    const [rootHash, generation, schemaVersion] =
      await this.#getRootHash(refresh);
    const { entries } = await this.raw.getEntries(rootHash);
    const hashInd = entries.findIndex((ent) => ent.hash === hash);
    const hashEnt = entries[hashInd];
    if (hashEnt === undefined) {
      throw new HashNotFoundError(hash);
    }
    const [newEnt, uploadEnt] = await this.#editMetaRaw(
      hashEnt.id,
      hash,
      update,
      schemaVersion,
    );
    entries[hashInd] = newEnt;
    const [rootEntry, uploadRoot] = await this.raw.putEntries(
      "root",
      entries,
      schemaVersion,
    );

    await Promise.all([uploadEnt, uploadRoot]);

    await this.#putRootHash(rootEntry.hash, generation);
    return { hash: newEnt.hash };
  }

  /** move an entry */
  async move(
    hash: string,
    parent: string,
    refresh: boolean = false,
  ): Promise<HashEntry> {
    if (!idReg.test(parent)) {
      throw new ValidationError(
        parent,
        idReg,
        "parent must be a valid document id",
      );
    }
    return await this.#editMeta(hash, { parent }, refresh);
  }

  /** delete an entry */
  async delete(hash: string, refresh: boolean = false): Promise<HashEntry> {
    return await this.move(hash, "trash", refresh);
  }

  /** rename an entry */
  async rename(
    hash: string,
    visibleName: string,
    refresh: boolean = false,
  ): Promise<HashEntry> {
    return await this.#editMeta(hash, { visibleName }, refresh);
  }

  /** stared */
  async stared(
    hash: string,
    stared: boolean,
    refresh: boolean = false,
  ): Promise<HashEntry> {
    return await this.#editMeta(hash, { pinned: stared }, refresh);
  }

  /** move many hashes */
  async bulkMove(
    hashes: readonly string[],
    parent: string,
    refresh: boolean = false,
  ): Promise<HashesEntry> {
    if (!idReg.test(parent)) {
      throw new ValidationError(
        parent,
        idReg,
        "parent must be a valid document id",
      );
    }

    const [rootHash, generation, schemaVersion] =
      await this.#getRootHash(refresh);
    const { entries } = await this.raw.getEntries(rootHash);

    const hashSet = new Set(hashes);
    const toUpdate: RawEntry[] = [];
    const newEntries: RawEntry[] = [];
    for (const entry of entries) {
      const part = hashSet.has(entry.hash) ? toUpdate : newEntries;
      part.push(entry);
    }

    const resolved = await Promise.all(
      toUpdate.map(({ id, hash }) =>
        this.#editMetaRaw(id, hash, { parent }, schemaVersion),
      ),
    );
    const uploads: Promise<[void, void]>[] = [];
    const result: Record<string, string> = {};
    for (const [i, [newEnt, upload]] of resolved.entries()) {
      newEntries.push(newEnt);
      uploads.push(upload);
      result[toUpdate[i]!.hash] = newEnt.hash;
    }

    const [rootEntry, uploadRoot] = await this.raw.putEntries(
      "root",
      newEntries,
      schemaVersion,
    );
    await Promise.all([Promise.all(uploads), uploadRoot]);

    await this.#putRootHash(rootEntry.hash, generation);
    return { hashes: result };
  }

  /** delete many hashes */
  async bulkDelete(
    hashes: readonly string[],
    refresh: boolean = false,
  ): Promise<HashesEntry> {
    return await this.bulkMove(hashes, "trash", refresh);
  }

  /** dump the raw cache */
  dumpCache(): string {
    return this.raw.dumpCache();
  }

  async pruneCache(refresh?: boolean): Promise<void> {
    const [rootHash] = await this.#getRootHash(refresh);
    // the keys to delete, we'll drop every key we can currently reach
    const toDelete = new Set(this.#cache.keys());

    // bfs through entries (to semi-optimize promise waiting, although this
    // should only go one step) to track all hashes encountered
    // NOTE that we could increase the cache in this process, or it's possible
    // for other calls to increase the cache with misc values.
    const base = await this.raw.getEntries(rootHash);
    let entries = [base.entries];
    let nextEntries: Promise<Entries>[] = [];
    while (entries.length) {
      for (const entryList of entries) {
        for (const { hash, type } of entryList) {
          toDelete.add(hash);
          if (type === 80000000) {
            nextEntries.push(this.raw.getEntries(hash));
          }
        }
      }
      const resolved = await Promise.all(nextEntries);
      entries = resolved.map((ent) => ent.entries);
      nextEntries = [];
    }
    for (const key of toDelete) {
      this.#cache.delete(key);
    }
  }

  // finally remove any values we had in the cache initially, but couldn't reach
  clearCache(): void {
    this.raw.clearCache();
  }
}

/** configuration for exchanging a device token */
export interface AuthOptions {
  /**
   * the url for making authorization requests
   *
   * @defaultValue "https://webapp-prod.cloud.remarkable.engineering"
   */
  authHost?: string;
}

/** options for constructing an api instance from a session token */
export interface RemarkableSessionOptions {
  /**
   * the url for making synchronization requests
   *
   * @defaultValue "https://web.eu.tectonic.remarkable.com"
   */
  syncHost?: string;

  /**
   * the base url for making upload requests
   *
   * @defaultValue "https://internal.cloud.remarkable.com"
   */
  uploadHost?: string;

  /**
   * the url for making requests using the low-level api
   *
   * @defaultValue "https://eu.tectonic.remarkable.com"
   */
  rawHost?: string;

  /**
   * an initial cache value
   *
   * Generated from calling {@link RemarkableApi.dumpCache | `dumpCache`} on a previous
   * instance.
   */
  cache?: string;

  /**
   * the maximum size of the cache in terms of total string length
   *
   * By the JavaScript specification there are two bytes per character, but the
   * total memory usage of the cache will also be larger than just the size of
   * the data stored.
   *
   * @defaultValue Infinity
   */
  maxCacheSize?: number;
}

/** options for a remarkable instance */
export interface RemarkableOptions
  extends AuthOptions,
    RemarkableSessionOptions {}

const cached = values(nullable(string())) satisfies CompiledSchema<
  Record<string, string | null>,
  unknown
>;

/**
 * Exchange a device token for a session token.
 *
 * @param deviceToken - the device token proving this api instance is
 *    registered. Create one with {@link register}.
 * @returns the session token returned by the reMarkable service
 */
export async function auth(
  deviceToken: string,
  { authHost = AUTH_HOST }: AuthOptions = {},
): Promise<string> {
  const resp = await fetch(`${authHost}/token/json/2/user/new`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deviceToken}`,
    },
  });
  if (!resp.ok) {
    throw new Error(`couldn't fetch auth token: ${resp.statusText}`);
  }
  return await resp.text();
}

/**
 * Create an API instance from an existing session token.
 *
 * If requests start failing, simply recreate the api instance with a freshly
 * fetched session token.
 *
 * @param sessionToken - the session token used for authorization
 * @returns an api instance
 */
export function session(
  sessionToken: string,
  {
    rawHost = RAW_HOST,
    uploadHost = UPLOAD_HOST,
    cache,
    maxCacheSize = Infinity,
  }: RemarkableSessionOptions = {},
): RemarkableApi {
  const initCache = JSON.parse(cache ?? "{}") as unknown;
  if (cached.guard(initCache)) {
    const entries = Object.entries(initCache);
    const cacheMap =
      maxCacheSize === Infinity
        ? new Map(entries)
        : new LruCache(maxCacheSize, entries);
    return new Remarkable(sessionToken, rawHost, uploadHost, cacheMap);
  }
  throw new Error(
    "cache was not a valid cache (json string mapping); your cache must be corrupted somehow. Either initialize remarkable without a cache, or fix its format.",
  );
}

/**
 * create an instance of the api
 *
 * This gets a temporary authentication token with the device token and then
 * constructs the api instance.
 *
 * @param deviceToken - the device token proving this api instance is
 *    registered. Create one with {@link register}.
 * @returns an api instance
 */
export async function remarkable(
  deviceToken: string,
  options: RemarkableOptions = {},
): Promise<RemarkableApi> {
  const { authHost, rawHost, uploadHost, cache, maxCacheSize, syncHost } =
    options ?? {};
  const sessionToken = await auth(deviceToken, { authHost });
  return session(sessionToken, {
    rawHost,
    uploadHost,
    cache,
    maxCacheSize,
    syncHost,
  });
}
