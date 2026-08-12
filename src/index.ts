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
 * const [first, ...rest] = await api.listItems();
 * // rename first item
 * const entry = await api.rename(first, "new name");
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
 * both, as an {@link ItemRef | `ItemRef`}: the id says which item, and the hash
 * says which state you meant to change, so a conflicting update fails rather
 * than overwriting. Each entry has a number of properties, but a key property
 * is the `parent`, which represents its parent in the file structure. This will
 * be another document id, or one of two special ids, "" (the empty string) for
 * the root directory, or "trash" for the trash.
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
import { v4 as uuid4 } from "uuid";
import { z } from "zod";
import { HashNotFoundError, ValidationError } from "./error.js";
import { LruCache } from "./lru.js";
import {
  type BackgroundFilter,
  BYTES_PREFIX,
  CACHE_VERSION,
  type CollectionContent,
  type Content,
  type DocumentContent,
  type Entries,
  type EntryType,
  type Highlight,
  type ItemRef,
  type Metadata,
  type Orientation,
  type PageMetadata,
  type PendingEntry,
  parseMetadata,
  type RawEntry,
  RawRemarkable,
  type RawRemarkableApi,
  type RequestMethod,
  type RmPage,
  type SchemaVersion,
  type Tag,
  TEXT_PREFIX,
  type TemplateContent,
  type TextAlignment,
  type ZoomMode,
} from "./raw.js";

export {
  type DeviceModel,
  type DeviceScreen,
  deviceScreens,
} from "./devices.js";
export { HashNotFoundError, ValidationError } from "./error.js";
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
  EntryType,
  FileType,
  Highlight,
  HighlightRect,
  ItemRef,
  KeyboardMetadata,
  LegacyCollectionContent,
  LegacyDocumentContent,
  Metadata,
  Orientation,
  PageLayer,
  PageMetadata,
  PageTag,
  PendingEntry,
  RawEntry,
  RawRemarkableApi,
  RmPage,
  SchemaVersion,
  Tag,
  TemplateContent,
  TextAlignment,
  UploadMimeType,
  ZoomMode,
} from "./raw.js";
export type {
  RmBrush,
  RmLayer,
  RmLine,
  RmPageV5,
  RmPoint,
  RmVersion,
} from "./rm5.js";
export { decodeBrush, rmColors } from "./rm5.js";

export type {
  AuthorIdsBlock,
  CrdtId,
  GlyphRange,
  LwwValue,
  MigrationInfoBlock,
  PageInfoBlock,
  Rectangle,
  RmBlock,
  RmScene,
  RmSceneItem,
  RmSceneLayer,
  RmV6Line,
  RmV6Point,
  RmV6Text,
  RmV6TextValue,
  RootTextBlock,
  SceneGlyphItemBlock,
  SceneGroupItemBlock,
  SceneInfoBlock,
  SceneItem,
  SceneLineItemBlock,
  SceneTextItemBlock,
  SceneTombstoneItemBlock,
  SceneTreeBlock,
  TreeNodeAnchor,
  TreeNodeBlock,
  UnknownBlock,
} from "./rm6.js";
export { crdtKey } from "./rm6.js";

const AUTH_HOST = "https://webapp-prod.cloud.remarkable.engineering";
const RAW_HOST = "https://eu.tectonic.remarkable.com";
const UPLOAD_HOST = "https://internal.cloud.remarkable.com";

/** the parent id of the root directory */
const ROOT_ID = "";
/** the parent id of the trash */
const TRASH_ID = "trash";
/** the id of the root entry list */
const ROOT_LIST = "root";
/** the file name of the root entry index */

/** base backoff in milliseconds for transient request retries */
const TRANSIENT_BASE_MS = 200;
/** base backoff in milliseconds for generation-conflict retries */
const GENERATION_BASE_MS = 25;

/** resolve after a number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // don't let a pending backoff keep a node process alive
    (timer as { unref?: () => void }).unref?.();
  });
}

/** exponential backoff with full jitter, capped at 30 seconds */
function backoffMs(attempt: number, baseMs: number): number {
  const capped = Math.min(baseMs * 2 ** attempt, 30_000);
  return Math.random() * capped;
}

/**
 * a mutex held for the scope of the acquiring block
 *
 * `await using lock = await mutex.lock()` releases when the block exits, by
 * return or by throw. Waiters are served in acquisition order.
 */
class Mutex {
  #tail: Promise<void> = Promise.resolve();

  async lock(): Promise<AsyncDisposable> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return {
      async [Symbol.asyncDispose]() {
        release();
      },
    };
  }
}

/** the ordered page ids of a document's content, from cPages or the legacy list */
function pageOrder(content: Content): string[] {
  if ("cPages" in content && content.cPages) {
    return content.cPages.pages
      .filter((page) => page.deleted === undefined)
      .map((page) => page.id);
  } else if ("pages" in content && content.pages) {
    return content.pages;
  } else {
    return [];
  }
}

/** a sidecar file a document stores once per page, keyed by page id */
interface PageFile<T> {
  name(docId: string, pageId: string): string;
  read(entry: RawEntry): Promise<T>;
}

interface WritablePageFile<Read, Write = Read> extends PageFile<Read> {
  write(fileName: string, value: Write): Promise<PendingEntry>;
}

// The section has all the types that are stored in the remarkable cloud.

const idReg =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}||trash)$/;

/** common properties shared by collections and documents */
export interface EntryCommon extends ItemRef {
  /** the visible display name of this entry */
  visibleName: string;
  /** the last modified timestamp */
  lastModified?: string;
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
  tags?: Tag[] | string[];
}

/** a folder, referred to in the api as a collection */
export interface CollectionEntry extends EntryCommon {
  /** the key for this as a collection */
  type: "CollectionType";
}

/** a file, referred to in the api as a document */
export interface DocumentEntry extends EntryCommon {
  /** the key to identify this as a document */
  type: "DocumentType";
  /** the type of the file */
  fileType: "epub" | "pdf" | "notebook";
  /** the timestamp of the last time this entry was opened */
  lastOpened: string;
}

/** a template, such as from methods.remarkable.com */
export interface TemplateEntry extends EntryCommon {
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
export type Entry = CollectionEntry | DocumentEntry | TemplateEntry;

/** options for creating a folder */
export interface FolderOptions {
  /** the id of the folder's parent directory, "" or omitted for root */
  parent?: string;
}

/** options for uploading a full document archive */
export interface PutDocumentOptions {
  /** if true, refresh the root hash before uploading */
  refresh?: boolean;
  /** the parent to place the document under, overriding the archived value */
  parent?: string;
  /** the visible name to use, overriding the archived value */
  visibleName?: string;
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
  /** the custom zoom scale, applied when zoomMode is "customFit" */
  customZoomScale?: number;
  /** the horizontal center offset for customFit zoom */
  customZoomCenterX?: number;
  /** the vertical center offset for customFit zoom */
  customZoomCenterY?: number;
  /** the rendered page width in pixels, the unit customFit centers use */
  customZoomPageWidth?: number;
  /** the rendered page height in pixels, the unit customFit centers use */
  customZoomPageHeight?: number;
  /** the orientation the customFit zoom was set in */
  customZoomOrientation?: Orientation;
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
class Remarkable {
  readonly #sessionToken: string;
  /** the same cache that underlies the raw api, allowing us to modify it */
  readonly #cache: Map<string, Uint8Array | null>;
  /** scoped access to the raw low-level api */
  readonly raw: RawRemarkable;
  readonly #maxGenerationRetries: number;
  readonly #maxTransientRetries: number;
  #lastHashGen: readonly [string, number] | undefined;
  #schemaVersion: SchemaVersion | undefined;
  /** serializes root updates on this instance so they don't self-conflict */
  readonly #rootMutex = new Mutex();

  constructor(
    sessionToken: string,
    rawHost: string,
    uploadHost: string,
    cache: Map<string, Uint8Array | null>,
    maxGenerationRetries: number,
    maxTransientRetries: number,
    maxCachedBytes: number,
  ) {
    this.#sessionToken = sessionToken;
    this.#cache = cache;
    this.#maxGenerationRetries = maxGenerationRetries;
    this.#maxTransientRetries = maxTransientRetries;
    this.raw = new RawRemarkable(
      (method, url, { body, headers } = {}) =>
        this.#authedFetch(url, { method, body, headers }),
      cache,
      rawHost,
      uploadHost,
      maxCachedBytes,
    );
  }

  async #getRootHash(
    refresh: boolean = false,
  ): Promise<readonly [string, number, SchemaVersion]> {
    if (refresh || this.#lastHashGen === undefined) {
      const [hash, generation, schemaVersion] = await this.raw.getRootHash();
      // a slow older fetch can resolve after a newer write; only accept it if
      // it doesn't regress the cached generation past a committed root
      if (
        this.#lastHashGen === undefined ||
        generation >= this.#lastHashGen[1]
      ) {
        this.#lastHashGen = [hash, generation];
        this.#schemaVersion = schemaVersion;
      }
    }
    return [...this.#lastHashGen, this.#schemaVersion!];
  }

  async #putRootHash(hash: string, generation: number): Promise<void> {
    try {
      const [rootHash, gen] = await this.raw.putRootHash(hash, generation);
      this.#lastHashGen = [rootHash, gen];
    } catch (ex) {
      // if we hit a generation error, invalidate our cached generation
      if (ex instanceof GenerationError) {
        this.#lastHashGen = undefined;
      }
      throw ex;
    }
  }

  /**
   * run a root-mutating operation, retrying on generation conflicts
   *
   * On a {@link GenerationError | `GenerationError`} the cached generation was
   * already invalidated by {@link #putRootHash}, so re-running `op` re-reads the
   * latest root and re-applies the change. Callers must resolve any random ids
   * before this so retries reuse the same (cached) blobs.
   */
  async #withRetry<T>(op: () => Promise<T>): Promise<T> {
    // hold the root lock across the whole read-merge-write so concurrent
    // mutators serialize instead of sharing a generation and forcing each
    // other into avoidable conflicts
    await using _lock = await this.#rootMutex.lock();
    for (let attempt = 0; ; attempt++) {
      try {
        return await op();
      } catch (ex) {
        if (
          ex instanceof GenerationError &&
          attempt < this.#maxGenerationRetries
        ) {
          await sleep(backoffMs(attempt, GENERATION_BASE_MS));
        } else {
          throw ex;
        }
      }
    }
  }

  /**
   * splice an already-uploaded item entry into the root
   *
   * The entry and all its blobs must already be uploaded; only the
   * generation-dependent root merge is retried, so a conflict re-reads the
   * latest root and re-appends the (stable) entry without re-uploading blobs.
   */
  async #commit(entry: RawEntry): Promise<void> {
    await this.#withRetry(async () => {
      const [rootHash, generation] = await this.#getRootHash();
      const { entries } = await this.raw.getEntries({
        id: ROOT_LIST,
        hash: rootHash,
      });
      entries.push(entry);
      let newRoot: string;
      {
        await using rootEntry = await this.raw.putEntries(
          ROOT_LIST,
          entries,
          4,
        );
        newRoot = rootEntry.hash;
      }
      await this.#putRootHash(newRoot, generation);
    });
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
    // the root PUT is a compare-and-set; retrying a lost-but-applied response
    // would resurface as a false generation conflict and be double-applied by
    // #withRetry, so never transient-retry it (GETs and content-addressed file
    // PUTs are idempotent and safe to retry)
    const transientRetries =
      method === "PUT" && url.endsWith("/sync/v3/root")
        ? 0
        : this.#maxTransientRetries;
    for (let attempt = 0; ; attempt++) {
      let resp: Response;
      try {
        resp = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.#sessionToken}`,
            ...headers,
          },
          // fetch works correctly with uint8 arrays, but is not hinted correctly
          body: body as unknown as ArrayBuffer,
        });
      } catch (ex) {
        // a network-level failure, retry if we have attempts left
        if (attempt < transientRetries) {
          await sleep(backoffMs(attempt, TRANSIENT_BASE_MS));
          continue;
        }
        throw ex;
      }
      if (resp.ok) {
        return resp;
      }
      const msg = await resp.text();
      if (msg === '{"message":"precondition failed"}\n') {
        // a generation conflict; handled by #withRetry at the high level
        throw new GenerationError();
      } else if (
        (resp.status >= 500 || resp.status === 429) &&
        attempt < transientRetries
      ) {
        await sleep(backoffMs(attempt, TRANSIENT_BASE_MS));
      } else {
        throw new ResponseError(
          resp.status,
          resp.statusText,
          `failed reMarkable request: ${msg}`,
        );
      }
    }
  }

  async #convertEntry(ref: ItemRef): Promise<Entry> {
    const { id, hash } = ref;
    const { entries } = await this.raw.getEntries(ref);
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
        createdTime,
        new: isNew,
        source,
      },
      content,
    ] = await Promise.all([
      this.raw.getMetadata(metaEnt),
      // collections don't always have content, since content only lists tags
      contentEnt === undefined
        ? Promise.resolve({ fileType: undefined, tags: undefined })
        : this.raw.getContent(contentEnt),
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
        createdTime,
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
  async listItems(refresh: boolean = false): Promise<Entry[]> {
    const ids = await this.listRefs(refresh);
    return await Promise.all(ids.map((id) => this.#convertEntry(id)));
  }

  /**
   * list a reference to every item, backed by the low level api
   *
   * Unlike {@link listItems | `listItems`} this doesn't read each item's
   * metadata, so it's cheaper but only gives you ids and hashes.
   *
   * @param refresh - if true, refresh the root hash before listing
   */
  async listRefs(refresh: boolean = false): Promise<ItemRef[]> {
    const [hash] = await this.#getRootHash(refresh);
    const { entries } = await this.raw.getEntries({ id: ROOT_LIST, hash });
    return entries.map(({ id, hash }) => ({ id, hash }));
  }

  /**
   * get the content metadata for an item
   *
   * @remarks
   * If this fails validation and you still want to get the content, you can use
   * the low-level api to get the raw text of the `.content` file in the
   * `RawEntry` for this hash.
   *
   * @param ref - a reference to the item (e.g. from `listItems` or `listRefs`)
   * @returns the content
   */
  async getContent(ref: ItemRef): Promise<Content> {
    const { hash } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const cont = entries.find((e) => e.id.endsWith(".content"));
    if (cont === undefined) {
      throw new Error(`couldn't find contents for hash ${hash}`);
    } else {
      return await this.raw.getContent(cont);
    }
  }

  /**
   * get the metadata for an item
   *
   * @remarks
   * If this fails validation and you still want to get the content, you can use
   * the low-level api to get the raw text of the `.metadata` file in the
   * `RawEntry` for this hash.
   *
   * @param ref - a reference to the item (e.g. from `listItems` or `listRefs`)
   * @returns the metadata
   */
  async getMetadata(ref: ItemRef): Promise<Metadata> {
    const { hash } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const meta = entries.find((e) => e.id.endsWith(".metadata"));
    if (meta === undefined) {
      throw new Error(`couldn't find metadata for hash ${hash}`);
    } else {
      return await this.raw.getMetadata(meta);
    }
  }

  /**
   * get the pdf associated with a document
   *
   * This returns the raw input pdf, not the rendered pdf with any markup.
   *
   * @param ref - a reference to the document (e.g. from `listItems`)
   * @returns the pdf bytes
   */
  async getPdf(ref: ItemRef): Promise<Uint8Array> {
    const { hash } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const pdf = entries.find((e) => e.id.endsWith(".pdf"));
    if (pdf === undefined) {
      throw new Error(`couldn't find pdf for hash ${hash}`);
    } else {
      return await this.raw.getHash(pdf);
    }
  }

  /**
   * get the epub associated with a document
   *
   * This returns the raw input epub if a document was created from an epub.
   *
   * @param ref - a reference to the document (e.g. from `listItems`)
   * @returns the epub bytes
   */
  async getEpub(ref: ItemRef): Promise<Uint8Array> {
    const { hash } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const epub = entries.find((e) => e.id.endsWith(".epub"));
    if (epub === undefined) {
      throw new Error(`couldn't find epub for hash ${hash}`);
    } else {
      return await this.raw.getHash(epub);
    }
  }

  readonly #rmPageFile: WritablePageFile<RmPage> = {
    name: (docId, pageId) => `${docId}/${pageId}.rm`,
    read: (entry) => this.raw.getRm(entry),
    write: (fileName, page) => this.raw.putRm(fileName, page),
  };

  readonly #highlightPageFile: WritablePageFile<
    Highlight[][],
    readonly Highlight[][]
  > = {
    name: (docId, pageId) => `${docId}.highlights/${pageId}.json`,
    read: (entry) => this.raw.getHighlights(entry),
    write: (fileName, highlights) =>
      this.raw.putHighlights(fileName, highlights),
  };

  readonly #pageMetadataFile: WritablePageFile<PageMetadata> = {
    name: (docId, pageId) => `${docId}/${pageId}-metadata.json`,
    read: (entry) => this.raw.getPageMetadata(entry),
    write: (fileName, meta) => this.raw.putPageMetadata(fileName, meta),
  };

  async #getPageFile<T>(
    ref: ItemRef,
    pageId: string,
    file: PageFile<T>,
  ): Promise<T | undefined> {
    const { id } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const content = await this.getContent(ref);
    if (!pageOrder(content).includes(pageId)) {
      throw new Error(`document ${id} has no page ${pageId}`);
    }
    const entry = entries.find((ent) => ent.id === file.name(id, pageId));
    if (entry === undefined) {
      return undefined;
    } else {
      return await file.read(entry);
    }
  }

  async #getPageFiles<T>(
    ref: ItemRef,
    file: PageFile<T>,
  ): Promise<Map<string, T>> {
    const { id } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const content = await this.getContent(ref);
    const byName = new Map(entries.map((entry) => [entry.id, entry]));
    const found = pageOrder(content)
      .map((pageId) => [pageId, byName.get(file.name(id, pageId))] as const)
      .filter((pair): pair is [string, RawEntry] => pair[1] !== undefined);
    const parsed = await Promise.all(
      found.map(([, entry]) => file.read(entry)),
    );
    return new Map(found.map(([pageId], index) => [pageId, parsed[index]!]));
  }

  async #putPageFilesRaw<Read, Write>(
    ref: ItemRef,
    pages: ReadonlyMap<string, Write>,
    file: WritablePageFile<Read, Write>,
    schemaVersion: SchemaVersion,
  ): Promise<PendingEntry> {
    const { id, hash } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const contentEntry = entries.find((ent) => ent.id.endsWith(".content"));
    if (contentEntry === undefined) {
      throw new Error(`couldn't find contents for hash ${hash}`);
    }
    const content = await this.raw.getContent(contentEntry);
    const order = new Set(pageOrder(content));
    for (const pageId of pages.keys()) {
      if (!order.has(pageId)) {
        throw new Error(`document ${id} has no page ${pageId}`);
      }
    }

    await using uploads = new AsyncDisposableStack();
    const written = await Promise.all(
      [...pages].map(([pageId, value]) =>
        file.write(file.name(id, pageId), value),
      ),
    );
    for (const pageEntry of written) {
      uploads.use(pageEntry);
      const pageInd = entries.findIndex((ent) => ent.id === pageEntry.id);
      if (pageInd === -1) {
        entries.push(pageEntry);
      } else {
        entries[pageInd] = pageEntry;
      }
    }
    return await this.raw.putEntries(id, entries, schemaVersion);
  }

  async #putPageFiles<Read, Write>(
    ref: ItemRef,
    pages: ReadonlyMap<string, Write>,
    file: WritablePageFile<Read, Write>,
    refresh: boolean,
  ): Promise<ItemRef> {
    if (pages.size === 0) {
      return ref;
    } else {
      return await this.#editEntry(ref, refresh, (item, schemaVersion) =>
        this.#putPageFilesRaw(item, pages, file, schemaVersion),
      );
    }
  }

  /**
   * get a single page's parsed reMarkable lines (`.rm`) drawing
   *
   * @param ref - a reference to the document (e.g. from `listItems`)
   * @param pageId - the id of the page, from the document's `.content` page
   *     list (see {@link getRmPages | `getRmPages`} for every page)
   * @returns the parsed page, or `undefined` if the page exists but has no
   *     `.rm` drawing (a page you haven't drawn on has no `.rm` file)
   * @throws if `pageId` is not a page of the document
   */
  async getRmPage(ref: ItemRef, pageId: string): Promise<RmPage | undefined> {
    return await this.#getPageFile(ref, pageId, this.#rmPageFile);
  }

  /**
   * get every drawn page of a document, parsed, keyed by page id
   *
   * Returns a map from page id to its parsed {@link RmPage | `RmPage`},
   * iterating in the page order given by the document's `.content`. Pages with
   * no drawing (and soft-deleted pages) are omitted. Version 3, 5, and 6 pages
   * are all supported.
   *
   * @param ref - a reference to the document (e.g. from `listItems`)
   * @returns the drawn pages, keyed by page id, in document order
   */
  async getRmPages(ref: ItemRef): Promise<Map<string, RmPage>> {
    return await this.#getPageFiles(ref, this.#rmPageFile);
  }

  /**
   * write a single page's reMarkable lines (`.rm`) drawing
   *
   * @param ref - a reference to the document
   * @param pageId - the id of the page, from the document's `.content` page list
   * @param page - the drawing to write, replacing any already there
   * @throws GenerationError if the generation doesn't match the current server generation
   * @throws if `pageId` is not a page of the document
   * @returns a reference to the updated document, with its new hash
   */
  async putRmPage(
    ref: ItemRef,
    pageId: string,
    page: RmPage,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.putRmPages(ref, new Map([[pageId, page]]), refresh);
  }

  /**
   * write several pages' reMarkable lines (`.rm`) drawings in one commit
   *
   * @param ref - a reference to the document
   * @param pages - the drawings to write, keyed by page id, replacing any
   *     already on those pages and leaving every other page alone
   * @throws GenerationError if the generation doesn't match the current server generation
   * @throws if any key is not a page of the document
   * @returns a reference to the updated document, with its new hash
   */
  async putRmPages(
    ref: ItemRef,
    pages: ReadonlyMap<string, RmPage>,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#putPageFiles(ref, pages, this.#rmPageFile, refresh);
  }

  /**
   * get a single page's text highlights
   *
   * These are separate from the highlighter strokes drawn in a `.rm` scene.
   *
   * @param ref - a reference to the document
   * @param pageId - the id of the page, from the document's `.content` page list
   * @returns the page's highlights, or `undefined` if the page has none
   * @throws if `pageId` is not a page of the document
   */
  async getHighlights(
    ref: ItemRef,
    pageId: string,
  ): Promise<Highlight[][] | undefined> {
    return await this.#getPageFile(ref, pageId, this.#highlightPageFile);
  }

  /**
   * get every highlighted page of a document, keyed by page id
   *
   * @param ref - a reference to the document
   * @returns the highlights in page order, omitting pages with none
   */
  async getHighlightPages(ref: ItemRef): Promise<Map<string, Highlight[][]>> {
    return await this.#getPageFiles(ref, this.#highlightPageFile);
  }

  /**
   * write a single page's text highlights, replacing any already there
   *
   * @param ref - a reference to the document
   * @param pageId - the id of the page, from the document's `.content` page list
   * @param highlights - the highlights to write
   * @throws GenerationError if the generation doesn't match the current server generation
   * @throws if `pageId` is not a page of the document
   * @returns a reference to the updated document, with its new hash
   */
  async putHighlights(
    ref: ItemRef,
    pageId: string,
    highlights: readonly Highlight[][],
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.putHighlightPages(
      ref,
      new Map([[pageId, highlights]]),
      refresh,
    );
  }

  /**
   * write several pages' text highlights in one commit
   *
   * @param ref - a reference to the document
   * @param pages - the highlights to write, keyed by page id, replacing any
   *     already on those pages and leaving every other page alone
   * @throws GenerationError if the generation doesn't match the current server generation
   * @throws if any key is not a page of the document
   * @returns a reference to the updated document, with its new hash
   */
  async putHighlightPages(
    ref: ItemRef,
    pages: ReadonlyMap<string, readonly Highlight[][]>,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#putPageFiles(
      ref,
      pages,
      this.#highlightPageFile,
      refresh,
    );
  }

  /**
   * get a template attached to an item as a `.template` sidecar
   *
   * This is distinct from a {@link TemplateEntry | `TemplateEntry`} (whose
   * template is its `.content`); collections and documents can carry a template
   * this way.
   *
   * @param ref - a reference to the item
   * @returns the template content, or `undefined` if the item has no `.template`
   */
  async getTemplate(ref: ItemRef): Promise<TemplateContent | undefined> {
    const { id } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const entry = entries.find((e) => e.id === `${id}.template`);
    if (entry === undefined) {
      return undefined;
    } else {
      return await this.raw.getTemplate(entry);
    }
  }

  /**
   * attach a template to an item as a `.template` sidecar
   *
   * @param ref - a reference to the item
   * @param template - the template to attach, replacing any already there
   * @throws GenerationError if the generation doesn't match the current server generation
   * @returns a reference to the updated item, with its new hash
   */
  async putTemplate(
    ref: ItemRef,
    template: TemplateContent,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#editEntry(ref, refresh, async (item, schemaVersion) => {
      const { id } = item;
      const { entries } = await this.raw.getEntries(item);
      await using templateEntry = await this.raw.putTemplate(
        `${id}.template`,
        template,
      );
      const ind = entries.findIndex((ent) => ent.id === templateEntry.id);
      if (ind === -1) {
        entries.push(templateEntry);
      } else {
        entries[ind] = templateEntry;
      }
      return await this.raw.putEntries(id, entries, schemaVersion);
    });
  }

  /**
   * get a document's per-page template names
   *
   * The `.pagedata` file lists one template name per page, in page order (an
   * empty string for a page with no template).
   *
   * @param ref - a reference to the document
   * @returns the per-page template names, or `undefined` if the document has
   *     no `.pagedata`
   */
  async getPagedata(ref: ItemRef): Promise<string[] | undefined> {
    const { id } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const entry = entries.find((e) => e.id === `${id}.pagedata`);
    if (entry === undefined) {
      return undefined;
    } else {
      const lines = (await this.raw.getText(entry)).split("\n");
      if (lines.at(-1) === "") lines.pop();
      return lines;
    }
  }

  /**
   * set a document's per-page template names
   *
   * @param ref - a reference to the document
   * @param templates - one template name per page, in page order, an empty
   *     string for a page with no template
   * @throws GenerationError if the generation doesn't match the current server generation
   * @returns a reference to the updated document, with its new hash
   */
  async putPagedata(
    ref: ItemRef,
    templates: readonly string[],
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#editEntry(ref, refresh, async (item, schemaVersion) => {
      const { id } = item;
      const { entries } = await this.raw.getEntries(item);
      await using pagedataEntry = await this.raw.putPagedata(
        `${id}.pagedata`,
        templates,
      );
      const ind = entries.findIndex((ent) => ent.id === pagedataEntry.id);
      if (ind === -1) {
        entries.push(pagedataEntry);
      } else {
        entries[ind] = pagedataEntry;
      }
      return await this.raw.putEntries(id, entries, schemaVersion);
    });
  }

  /**
   * get a single page's layer metadata
   *
   * @param ref - a reference to the document
   * @param pageId - the id of the page, from the document's `.content` page list
   * @returns the page's layer metadata, or `undefined` if the page has none
   * @throws if `pageId` is not a page of the document
   */
  async getPageMetadata(
    ref: ItemRef,
    pageId: string,
  ): Promise<PageMetadata | undefined> {
    return await this.#getPageFile(ref, pageId, this.#pageMetadataFile);
  }

  /**
   * get every page's layer metadata, keyed by page id
   *
   * @param ref - a reference to the document
   * @returns the layer metadata in page order, omitting pages with none
   */
  async getPageMetadataPages(ref: ItemRef): Promise<Map<string, PageMetadata>> {
    return await this.#getPageFiles(ref, this.#pageMetadataFile);
  }

  /**
   * write a single page's layer metadata, replacing any already there
   *
   * @param ref - a reference to the document
   * @param pageId - the id of the page, from the document's `.content` page list
   * @param meta - the layer metadata to write
   * @throws GenerationError if the generation doesn't match the current server generation
   * @throws if `pageId` is not a page of the document
   * @returns a reference to the updated document, with its new hash
   */
  async putPageMetadata(
    ref: ItemRef,
    pageId: string,
    meta: PageMetadata,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.putPageMetadataPages(
      ref,
      new Map([[pageId, meta]]),
      refresh,
    );
  }

  /**
   * write several pages' layer metadata in one commit
   *
   * @param ref - a reference to the document
   * @param pages - the layer metadata to write, keyed by page id, replacing any
   *     already on those pages and leaving every other page alone
   * @throws GenerationError if the generation doesn't match the current server generation
   * @throws if any key is not a page of the document
   * @returns a reference to the updated document, with its new hash
   */
  async putPageMetadataPages(
    ref: ItemRef,
    pages: ReadonlyMap<string, PageMetadata>,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#putPageFiles(
      ref,
      pages,
      this.#pageMetadataFile,
      refresh,
    );
  }

  /**
   * get a document's entire contents as a zip archive
   *
   * This gets every file associated with a document and puts them into a zip
   * archive.
   *
   * @remarks
   * This is an experimental feature. The resulting archive round-trips back
   * through {@link putDocumentArchive | `putDocumentArchive`}.
   *
   * @param ref - a reference to the document (e.g. from `listItems`)
   */
  async getDocumentArchive(ref: ItemRef): Promise<Uint8Array> {
    const { entries } = await this.raw.getEntries(ref);
    const zip = new JSZip();
    for (const entry of entries) {
      // TODO if this is .metadata we might want to assert type === "DocumentType"
      zip.file(entry.id, this.raw.getHash(entry));
    }
    return zip.generateAsync({ type: "uint8array" });
  }

  /**
   * upload a document archive produced by {@link getDocumentArchive | `getDocumentArchive`}
   *
   * This explodes the zip archive back into its constituent files, uploads each
   * as a blob, and commits a new document into the root.
   *
   * @remarks
   * This is an experimental feature. A fresh document id is generated, so
   * re-uploading to the same account doesn't collide with the original. Like
   * the other low-level puts, this may throw a
   * {@link GenerationError | `GenerationError`} if the generation is stale,
   * requiring a retry.
   *
   * @param buffer - the archive bytes, as returned by `getDocumentArchive`
   * @param options - overrides for parent and visible name
   */
  async putDocumentArchive(
    buffer: Uint8Array,
    { refresh = false, parent, visibleName }: PutDocumentOptions = {},
  ): Promise<ItemRef> {
    if (parent !== undefined && parent && !idReg.test(parent)) {
      throw new ValidationError(
        parent,
        idReg,
        "parent must be a valid document id",
      );
    }
    const zip = await JSZip.loadAsync(buffer);
    const paths = Object.keys(zip.files).filter(
      (path) => !zip.files[path]!.dir,
    );
    const metaPath = paths.find((path) => path.endsWith(".metadata"));
    if (metaPath === undefined) {
      throw new Error("archive did not contain a .metadata file");
    }
    const oldId = metaPath.slice(0, -9);
    if (oldId.includes("/")) {
      throw new Error(`unexpected nested .metadata path '${metaPath}'`);
    }
    const newId = uuid4();

    // rewrite the old document id prefix on every archived file to the new id,
    // patching the .metadata as we pass it (parent/name/lastModified). the
    // blobs don't depend on the generation, so upload the rewritten files and
    // the document index once, then let #commit retry only the root merge
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const lastModified = Date.now().toFixed();
    const [, , schemaVersion] = await this.#getRootHash(refresh);
    const fileUploads = await Promise.all(
      paths.map(async (path) => {
        if (!path.startsWith(oldId)) {
          throw new Error(
            `archived file '${path}' did not start with '${oldId}'`,
          );
        }
        const newPath = `${newId}${path.slice(oldId.length)}`;
        let bytes = await zip.files[path]!.async("uint8array");
        if (path === metaPath) {
          const meta = parseMetadata(dec.decode(bytes));
          if (parent !== undefined) meta.parent = parent;
          if (visibleName !== undefined) meta.visibleName = visibleName;
          meta.lastModified = lastModified;
          bytes = enc.encode(JSON.stringify(meta));
        }
        return this.raw.putFile(newPath, bytes);
      }),
    );
    let docEntry: RawEntry;
    {
      await using uploads = new AsyncDisposableStack();
      for (const entry of fileUploads) {
        uploads.use(entry);
      }
      await using indexEntry = await this.raw.putEntries(
        newId,
        fileUploads,
        schemaVersion,
      );
      docEntry = indexEntry;
    }

    await this.#commit(docEntry);
    return { id: newId, hash: docEntry.hash };
  }

  async #putFile(
    visibleName: string,
    fileType: "epub" | "pdf",
    buffer: Uint8Array,
    {
      refresh,
      parent = ROOT_ID,
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
      customZoomScale,
      customZoomCenterX,
      customZoomCenterY,
      customZoomPageWidth,
      customZoomPageHeight,
      customZoomOrientation,
    }: PutOptions,
  ): Promise<ItemRef> {
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
      customZoomScale,
      customZoomCenterX,
      customZoomCenterY,
      customZoomPageWidth,
      customZoomPageHeight,
      customZoomOrientation,
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

    // the schema version is needed to encode the document index; the blobs
    // themselves don't depend on the generation, so upload them once and let
    // #commit retry only the root merge
    const [, , schemaVersion] = await this.#getRootHash(refresh);
    // TODO we could return a full entry here, but we should probably decide
    // what that should be, e.g. we could return more fields than the standard
    // entry. Same for putFolder
    // TODO we should also decide if the api should take hashes or ids...
    let collectionEntry: RawEntry;
    {
      const contentReq = this.raw.putContent(`${id}.content`, content);
      const metadataReq = this.raw.putMetadata(`${id}.metadata`, metadata);
      const pagedataReq = this.raw.putFile(
        `${id}.pagedata`,
        new TextEncoder().encode("\n"),
      );
      const fileReq = this.raw.putFile(`${id}.${fileType}`, buffer);
      await using contentEntry = await contentReq;
      await using metadataEntry = await metadataReq;
      await using pagedataEntry = await pagedataReq;
      await using fileEntry = await fileReq;

      await using indexEntry = await this.raw.putEntries(
        id,
        [contentEntry, metadataEntry, pagedataEntry, fileEntry],
        schemaVersion,
      );
      collectionEntry = indexEntry;
    }
    await this.#commit(collectionEntry);
    return { id, hash: collectionEntry.hash };
  }

  /**
   * use the low-level api to add a pdf document
   *
   * Since this uses the low-level api, it provides more options than
   * {@link uploadPdf | `uploadPdf`}, but is a little more finicky. Notably, it
   * may throw a {@link GenerationError | `GenerationError`} if the generation
   * doesn't match the current server generation, requiring you to retry until
   * it works.
   *
   * @remarks
   * When `zoomMode` is `"customFit"` the `customZoom*` fields describe the view,
   * all in the source page's device pixels: `customZoomPageWidth` and
   * `customZoomPageHeight` are the page dimensions scaled by the device dpi
   * (`pagePt * dpi / 72`, see {@link deviceScreens | `deviceScreens`}), and the
   * centers are in those pixels.
   *
   * The view always has the device's aspect ratio — you control its height and
   * position, not its shape. `customZoomScale = screenHeight / viewHeight` in
   * device pixels (`screenHeight` fixed per model, see {@link deviceScreens |
   * `deviceScreens`}), normalized to 1:1 native pixels: at `1` the view is
   * screen-tall, showing `screenHeight / customZoomPageHeight` of the page.
   *
   * `customZoomCenterX` offsets the center of the view horizontally from the
   * page center, and `customZoomCenterY` is the absolute distance of the center
   * down from the top of the page; the view's width follows from its height and
   * the device aspect ratio.
   *
   * The fields are a single document-wide setting, but `customZoomCenterY` is
   * applied against each page's own rendered height. On a page rendered taller
   * than `customZoomPageHeight` that distance is a smaller fraction of the page,
   * so the view sits higher and cuts off the bottom; on a shorter page it sits
   * lower and cuts off the top. `customZoomScale` (a ratio) and
   * `customZoomCenterX` (an offset from center) do not shift with page size.
   *
   * @param visibleName - the name to display on the reMarkable
   * @param buffer - the raw pdf
   * @param opts - put options
   * @throws GenerationError if the generation doesn't match the current server generation
   * @returns the entry for the newly inserted document
   */
  async putPdf(
    visibleName: string,
    buffer: Uint8Array,
    opts: PutOptions = {},
  ): Promise<ItemRef> {
    return await this.#putFile(visibleName, "pdf", buffer, opts);
  }

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
  async putEpub(
    visibleName: string,
    buffer: Uint8Array,
    opts: PutOptions = {},
  ): Promise<ItemRef> {
    return await this.#putFile(visibleName, "epub", buffer, opts);
  }

  /** create a folder */
  async putFolder(
    visibleName: string,
    { parent = ROOT_ID }: FolderOptions = {},
    refresh: boolean = false,
  ): Promise<ItemRef> {
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

    // the blobs don't depend on the generation, so upload them once and let
    // #commit retry only the root merge
    const [, , schemaVersion] = await this.#getRootHash(refresh);
    let collectionEntry: RawEntry;
    {
      const contentReq = this.raw.putContent(`${id}.content`, content);
      const metadataReq = this.raw.putMetadata(`${id}.metadata`, metadata);
      await using contentEntry = await contentReq;
      await using metadataEntry = await metadataReq;

      await using indexEntry = await this.raw.putEntries(
        id,
        [contentEntry, metadataEntry],
        schemaVersion,
      );
      collectionEntry = indexEntry;
    }

    await this.#commit(collectionEntry);
    return { id, hash: collectionEntry.hash };
  }

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
  async uploadEpub(visibleName: string, buffer: Uint8Array): Promise<ItemRef> {
    return await this.raw.uploadFile(
      visibleName,
      buffer,
      "application/epub+zip",
    );
  }

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
  async uploadPdf(visibleName: string, buffer: Uint8Array): Promise<ItemRef> {
    return await this.raw.uploadFile(visibleName, buffer, "application/pdf");
  }

  /** create a folder using the simple api */
  async uploadFolder(visibleName: string): Promise<ItemRef> {
    return await this.raw.uploadFile(visibleName, new Uint8Array(0), "folder");
  }

  /** edit just a content entry */
  async #editContentRaw(
    ref: ItemRef,
    update: Partial<Content>,
    schemaVersion: SchemaVersion,
  ): Promise<PendingEntry> {
    const { id } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const contInd = entries.findIndex((ent) => ent.id.endsWith(".content"));
    const contEntry = entries[contInd];
    if (contEntry === undefined) {
      throw new Error("internal error: couldn't find content in entry hash");
    }
    const cont = await this.raw.getContent(contEntry);
    Object.assign(cont, update);
    await using newContEntry = await this.raw.putContent(contEntry.id, cont);
    entries[contInd] = newContEntry;
    return await this.raw.putEntries(id, entries, schemaVersion);
  }

  /**
   * rewrite one item's files and splice the result into the root
   *
   * `edit` receives a ref to the item and the schema version, and returns its
   * new entry plus a promise for the uploads. Everything generation-dependent
   * lives here, so writers only describe the file change.
   */
  async #editEntry(
    ref: ItemRef,
    refresh: boolean,
    edit: (
      item: ItemRef,
      schemaVersion: SchemaVersion,
    ) => Promise<PendingEntry>,
  ): Promise<ItemRef> {
    return await this.#withRetry(async () => {
      const [rootHash, generation, schemaVersion] =
        await this.#getRootHash(refresh);
      const { entries } = await this.raw.getEntries({
        id: ROOT_LIST,
        hash: rootHash,
      });
      const hashInd = entries.findIndex(
        (ent) => ent.id === ref.id && ent.hash === ref.hash,
      );
      const hashEnt = entries[hashInd];
      if (hashEnt === undefined) {
        throw new HashNotFoundError(ref.hash);
      }

      let newRoot: string;
      let newHash: string;
      {
        await using newEnt = await edit(
          { id: hashEnt.id, hash: ref.hash },
          schemaVersion,
        );
        entries[hashInd] = newEnt;
        await using rootEntry = await this.raw.putEntries(
          ROOT_LIST,
          entries,
          4,
        );
        newRoot = rootEntry.hash;
        newHash = newEnt.hash;
      }
      await this.#putRootHash(newRoot, generation);
      return { id: hashEnt.id, hash: newHash };
    });
  }

  /** fully sync a content edit */
  async #editContent(
    ref: ItemRef,
    update: Partial<Content>,
    expectedType: EntryType,
    refresh: boolean,
  ): Promise<ItemRef> {
    return await this.#editEntry(ref, refresh, async (item, schemaVersion) => {
      const [newEnt, meta] = await Promise.all([
        this.#editContentRaw(item, update, schemaVersion),
        this.getMetadata(item),
      ]);
      if (meta.type !== expectedType) {
        throw new Error(
          `expected type ${expectedType} but got ${meta.type} for hash ${item.hash}`,
        );
      }
      return newEnt;
    });
  }

  /**
   * update content metadata for a document
   *
   * @example
   * ```ts
   * const next = await api.updateDocument(doc, { textAlignment: "left" });
   * ```
   *
   * @param ref - a reference to the file to update
   * @param content - the fields of content to update
   * @returns a reference to the updated entry, with its new hash
   */
  async updateDocument(
    ref: ItemRef,
    content: Partial<DocumentContent>,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#editContent(ref, content, "DocumentType", refresh);
  }

  /**
   * update content metadata for a collection
   *
   * @example
   * ```ts
   * const next = await api.updateCollection(dir, { textAlignment: "left" });
   * ```
   *
   * @param ref - a reference to the collection to update
   * @param content - the fields of content to update
   * @returns a reference to the updated entry, with its new hash
   */
  async updateCollection(
    ref: ItemRef,
    content: Partial<CollectionContent>,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#editContent(ref, content, "CollectionType", refresh);
  }

  /**
   * update content metadata for a template
   *
   * @example
   * ```ts
   * const next = await api.updateTemplate(tmpl, { textAlignment: "left" });
   * ```
   *
   * @param ref - a reference to the template to update
   * @param content - the fields of content to update
   * @returns a reference to the updated entry, with its new hash
   */
  async updateTemplate(
    ref: ItemRef,
    content: Partial<TemplateContent>,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#editContent(ref, content, "TemplateType", refresh);
  }

  async #editMetaRaw(
    ref: ItemRef,
    update: Partial<Metadata>,
    schemaVersion: SchemaVersion,
  ): Promise<PendingEntry> {
    const { id } = ref;
    const { entries } = await this.raw.getEntries(ref);
    const metaInd = entries.findIndex((ent) => ent.id.endsWith(".metadata"));
    const metaEntry = entries[metaInd];
    if (metaEntry === undefined) {
      throw new Error("internal error: couldn't find metadata in entry hash");
    }
    const meta = await this.raw.getMetadata(metaEntry);
    Object.assign(meta, update);
    meta.version = (meta.version ?? 0) + 1;
    meta.metadatamodified = true;
    await using newMetaEntry = await this.raw.putMetadata(metaEntry.id, meta);
    entries[metaInd] = newMetaEntry;
    return await this.raw.putEntries(id, entries, schemaVersion);
  }

  async #editMeta(
    ref: ItemRef,
    update: Partial<Metadata>,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#editEntry(ref, refresh, (item, schemaVersion) =>
      this.#editMetaRaw(item, update, schemaVersion),
    );
  }

  /**
   * move an entry
   *
   * @example
   * ```ts
   * const next = await api.move(doc, dir.id);
   * ```
   *
   * @param ref - a reference to the entry to move
   * @param parent - the id of the directory to move the entry to, "" (root) and "trash" are special parents
   * @returns a reference to the moved entry, with its new hash
   */
  async move(
    ref: ItemRef,
    parent: string,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    if (!idReg.test(parent)) {
      throw new ValidationError(
        parent,
        idReg,
        "parent must be a valid document id",
      );
    }
    return await this.#editMeta(ref, { parent }, refresh);
  }

  /**
   * delete an entry
   *
   * @example
   * ```ts
   * await api.delete(file);
   * ```
   * @param ref - a reference to the entry to delete
   * @returns a reference to the deleted entry, with its new hash
   */
  async delete(ref: ItemRef, refresh: boolean = false): Promise<ItemRef> {
    return await this.move(ref, TRASH_ID, refresh);
  }

  /**
   * rename an entry
   *
   * @example
   * ```ts
   * const next = await api.rename(file, "new name");
   * ```
   * @param ref - a reference to the entry to rename
   * @param visibleName - the new name to assign
   * @returns a reference to the renamed entry, with its new hash
   */
  async rename(
    ref: ItemRef,
    visibleName: string,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#editMeta(ref, { visibleName }, refresh);
  }

  /**
   * star or unstar an entry
   *
   * @example
   * ```ts
   * const next = await api.star(file, true);
   * ```
   * @param ref - a reference to the entry to star
   * @param starred - whether the entry should be starred or not
   * @returns a reference to the updated entry, with its new hash
   */
  async star(
    ref: ItemRef,
    starred: boolean,
    refresh: boolean = false,
  ): Promise<ItemRef> {
    return await this.#editMeta(ref, { pinned: starred }, refresh);
  }

  /**
   * move many entries
   *
   * @example
   * ```ts
   * const next = await api.bulkMove([file], dir.id);
   * ```
   *
   * @param refs - references to the entries to move
   * @param parent - the directory id to move the entries to, "" (root) and "trash" are special ids
   * @returns references to the moved entries, each with its new hash
   */
  async bulkMove(
    refs: readonly ItemRef[],
    parent: string,
    refresh: boolean = false,
  ): Promise<ItemRef[]> {
    if (!idReg.test(parent)) {
      throw new ValidationError(
        parent,
        idReg,
        "parent must be a valid document id",
      );
    }

    return await this.#withRetry(async () => {
      const [rootHash, generation, schemaVersion] =
        await this.#getRootHash(refresh);
      const { entries } = await this.raw.getEntries({
        id: ROOT_LIST,
        hash: rootHash,
      });

      const wanted = new Set(refs.map((ref) => `${ref.id}\0${ref.hash}`));
      const found = new Set<string>();
      const toUpdate: RawEntry[] = [];
      const newEntries: RawEntry[] = [];
      for (const entry of entries) {
        const key = `${entry.id}\0${entry.hash}`;
        if (wanted.has(key)) {
          toUpdate.push(entry);
          found.add(key);
        } else {
          newEntries.push(entry);
        }
      }
      for (const ref of refs) {
        if (!found.has(`${ref.id}\0${ref.hash}`)) {
          throw new HashNotFoundError(ref.hash);
        }
      }

      const resolved = await Promise.all(
        toUpdate.map((entry) =>
          this.#editMetaRaw(entry, { parent }, schemaVersion),
        ),
      );
      const result: ItemRef[] = [];
      for (const [i, newEnt] of resolved.entries()) {
        newEntries.push(newEnt);
        result.push({ id: toUpdate[i]!.id, hash: newEnt.hash });
      }

      let newRoot: string;
      {
        await using docs = new AsyncDisposableStack();
        for (const entry of resolved) {
          docs.use(entry);
        }
        await using rootEntry = await this.raw.putEntries(
          ROOT_LIST,
          newEntries,
          4,
        );
        newRoot = rootEntry.hash;
      }
      await this.#putRootHash(newRoot, generation);
      return result;
    });
  }

  /**
   * delete many entries
   *
   * @example
   * ```ts
   * await api.bulkDelete([file]);
   * ```
   *
   * @param refs - references to the entries to delete
   * @returns references to the deleted entries, each with its new hash
   */
  async bulkDelete(
    refs: readonly ItemRef[],
    refresh: boolean = false,
  ): Promise<ItemRef[]> {
    return await this.bulkMove(refs, TRASH_ID, refresh);
  }

  /**
   * get the current cache value as a string
   *
   * You can use this to warm start a new instance of
   * {@link remarkable | `remarkable`} with any previously cached results.
   */
  dumpCache(): string {
    return this.raw.dumpCache();
  }

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
  async pruneCache(refresh?: boolean): Promise<void> {
    const [rootHash] = await this.#getRootHash(refresh);
    // start by assuming every cached hash is unreachable, then keep the ones we reach
    const toDelete = new Set(this.#cache.keys());
    toDelete.delete(rootHash);

    // bfs through entries (to semi-optimize promise waiting, although this
    // should only go one step) to track all hashes encountered
    // NOTE that we could increase the cache in this process, or it's possible
    // for other calls to increase the cache with misc values.
    const base = await this.raw.getEntries({ id: ROOT_LIST, hash: rootHash });
    let entries = [base.entries];
    let nextEntries: Promise<Entries>[] = [];
    while (entries.length) {
      for (const entryList of entries) {
        for (const entry of entryList) {
          toDelete.delete(entry.hash);
          if (entry.subfiles > 0) {
            nextEntries.push(this.raw.getEntries(entry));
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

  /**
   * completely delete the cache
   *
   * If the cache is causing memory issues, you can clear it, but this will hurt
   * performance.
   */
  clearCache(): void {
    this.raw.clearCache();
  }
}

export type { Remarkable as RemarkableApi };

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
   * the maximum size of the cache, in bytes of cached content plus key length
   *
   * The total memory usage of the cache will be somewhat larger than this,
   * since it counts only the stored data.
   *
   * @defaultValue Infinity
   */
  maxCacheSize?: number;

  /**
   * the largest stored file to keep the contents of, in bytes
   *
   * Anything larger is fetched normally but only its existence is recorded, so
   * one big pdf can't evict everything else. Set to `0` to cache nothing but
   * existence, or `Infinity` to keep whatever is read.
   *
   * @defaultValue 1048576
   */
  maxCachedBytes?: number;

  /**
   * how many times to retry updating the root hash after a generation conflict
   *
   * High-level mutators re-fetch the latest root and re-apply their change on a
   * {@link GenerationError | `GenerationError`} up to this many times. Because
   * the document id and uploaded blobs are stable across attempts, retries
   * reuse the cache and don't orphan blobs. Set to `0` to surface the error
   * immediately, matching the previous behavior.
   *
   * @defaultValue 10
   */
  maxGenerationRetries?: number;

  /**
   * how many times to retry a request after a transient network or 5xx error
   *
   * Applies to every request; generation conflicts are not counted here.
   *
   * @defaultValue 3
   */
  maxTransientRetries?: number;
}

/** options for a remarkable instance */
export interface RemarkableOptions
  extends AuthOptions,
    RemarkableSessionOptions {}

/** the default {@link RemarkableSessionOptions.maxCachedBytes} */
const MAX_CACHED_BYTES = 1024 * 1024;

const cacheEntries: z.ZodType<Record<string, string | null>> = z.record(
  z.string(),
  z.string().nullable(),
);

/**
 * a dumped cache, either the tagged envelope or the original bare mapping
 *
 * The original format had no version, so its absence marks untagged text.
 */
const cacheDump = z
  .object({
    version: z.literal(CACHE_VERSION),
    entries: cacheEntries,
  })
  .or(cacheEntries.transform((entries) => ({ version: undefined, entries })));

/** decode a dumped cache into the byte map the api holds */
function decodeCache(dumped: unknown): [string, Uint8Array | null][] {
  const parsed = cacheDump.safeParse(dumped);
  if (!parsed.success) {
    throw new Error(
      `cache was neither a version ${CACHE_VERSION} dump nor the original mapping of hashes to text. Either construct the api without a cache, or fix its format.`,
    );
  }
  const { version, entries } = parsed.data;
  const enc = new TextEncoder();
  return Object.entries(entries).map(([hash, value]) => {
    if (value === null) {
      return [hash, null];
    } else if (version === undefined) {
      return [hash, enc.encode(value)];
    } else if (value.startsWith(BYTES_PREFIX)) {
      return [hash, Uint8Array.fromBase64(value.slice(1))];
    } else if (value.startsWith(TEXT_PREFIX)) {
      return [hash, enc.encode(value.slice(1))];
    } else {
      throw new Error(
        `cache entry ${hash} wasn't tagged '${TEXT_PREFIX}' or '${BYTES_PREFIX}'. Either construct the api without a cache, or fix its format.`,
      );
    }
  });
}

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
    maxCachedBytes = MAX_CACHED_BYTES,
    maxGenerationRetries = 10,
    maxTransientRetries = 3,
  }: RemarkableSessionOptions = {},
): Remarkable {
  const entries = decodeCache(JSON.parse(cache ?? "{}") as unknown);
  const cacheMap =
    maxCacheSize === Infinity
      ? new Map(entries)
      : new LruCache(maxCacheSize, entries);
  return new Remarkable(
    sessionToken,
    rawHost,
    uploadHost,
    cacheMap,
    maxGenerationRetries,
    maxTransientRetries,
    maxCachedBytes,
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
): Promise<Remarkable> {
  // forward everything but the auth option, so a new session option can't be
  // dropped here by omission
  const { authHost, ...sessionOptions } = options ?? {};
  const sessionToken = await auth(deviceToken, { authHost });
  return session(sessionToken, sessionOptions);
}
