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
import { fromByteArray } from "base64-js";
import CRC32C from "crc-32/crc32c";
import JSZip from "jszip";
import {
  boolean,
  elements,
  empty,
  enumeration,
  float64,
  int32,
  nullable,
  properties,
  string,
  timestamp,
  uint32,
  uint8,
  values,
  type CompiledSchema,
} from "jtd-ts";
import { v4 as uuid4 } from "uuid";
import { LruCache } from "./lru";

const AUTH_HOST = "https://webapp-prod.cloud.remarkable.engineering";
const RAW_HOST = "https://eu.tectonic.remarkable.com";

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

/** a tag for an entry */
export interface Tag {
  /** the name of the tag */
  name: string;
  /** the timestamp when this tag was added */
  timestamp: number;
}

const tag = properties(
  {
    name: string(),
    timestamp: float64(),
  },
  undefined,
  true,
) satisfies CompiledSchema<Tag, unknown>;

/** a tag for individual pages */
export interface PageTag extends Tag {
  /** the id of the page this is on */
  pageId: string;
}

const pageTag = properties(
  {
    name: string(),
    pageId: string(),
    timestamp: float64(),
  },
  undefined,
  true,
) satisfies CompiledSchema<PageTag, unknown>;

/** the type of files reMarkable supports */
export type FileType = "epub" | "pdf" | "notebook";

/** all supported document orientations */
export type Orientation = "portrait" | "landscape";

/** all supported text alignments */
export type TextAlignment = "justify" | "left";

/** types of zoom modes for documents, applies primarily to pdf files */
export type ZoomMode = "bestFit" | "customFit" | "fitToHeight" | "fitToWidth";

/**
 * types of background filter
 *
 * off has no background filter, best for images, full page applies the high
 * contrast filter to the entire page. If this is omitted, reMarkable will try
 * to apply the filter only to text areas.
 */
// eslint-disable-next-line spellcheck/spell-checker
export type BackgroundFilter = "off" | "fullpage";

/**
 * the low-level entry corresponding to a collection of files
 *
 * A collection could be for the root collection, or for an individual document,
 * which is often a collection of files. If an entry represents a collection of
 * files, the high level entry will have the same hash and id as the low-level
 * entry for that collection.
 */
export interface RawListEntry {
  /** collection type (80000000) */
  type: 80000000;
  /** the hash of the collection this points to */
  hash: string;
  /** the unique id of the collection */
  id: string;
  /** the number of subfiles */
  subfiles: number;
  /** the total size of everything in the collection */
  size: number;
}

/** the low-level entry for a single file */
export interface RawFileEntry {
  /** file type (0) */
  type: 0;
  /** the hash of the file this points to */
  hash: string;
  /** the unique id of the file */
  id: string;
  /** the number of subfiles, always zero */
  subfiles: 0;
  /** the size of the file in bytes */
  size: number;
}

/** a low-level stored entry */
export type RawEntry = RawListEntry | RawFileEntry;

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

/** an simple entry without any extra information */
export interface SimpleEntry {
  /** the document id */
  id: string;
  /** the document hash */
  hash: string;
}

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

/** an error that results while supplying a hash not found in the entries of the root hash */
export class HashNotFoundError extends Error {
  /** the hash that couldn't be found */
  readonly hash: string;

  constructor(hash: string) {
    super(`'${hash}' not found in the root hash`);
    this.hash = hash;
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

/** options available when uploading a document */
export interface UploadOptions {
  /** an optional parent id to set when uploading */
  parent?: string;
}

/** document metadata stored in {@link Content} */
export interface DocumentMetadata {
  /** a list of authors as a string */
  authors?: string[];
  /** the title as a string */
  title?: string;
  /** the publication date as an ISO date or timestamp */
  publicationDate?: string;
  /** the publisher */
  publisher?: string;
}

const documentMetadata = properties(
  undefined,
  {
    authors: elements(string()),
    title: string(),
    publicationDate: string(),
    publisher: string(),
  },
  true,
) satisfies CompiledSchema<DocumentMetadata, unknown>;

/** [speculative] metadata stored about keyboard interactions */
export interface KeyboardMetadata {
  /** [unknown] */
  count: number;
  /** [unknown] */
  timestamp: number;
}

/** a c-page value who's type is a string */
export interface CPageStringValue {
  /** a pseudo-timestamp of the form "1:1" or "1:2" */
  timestamp: string;
  /** the stored value */
  value: string;
}

/** a c-page value who's type is a string */
export interface CPageNumberValue {
  /** a pseudo-timestamp of the form "1:1" or "1:2" */
  timestamp: string;
  /** the stored value */
  value: number;
}

/** [speculative] information about an individual page */
export interface CPagePage {
  /** [speculative] the page id */
  id: string;
  /** [unknown] values are like "aa", "ab", "ba", etc. */
  idx: CPageStringValue;
  /** [unknown] */
  redir?: CPageNumberValue;
  /** [speculative] the template name of the page */
  template?: CPageStringValue;
  /** [unknown] the value is a timestamp */
  scrollTime?: CPageStringValue;
  /** [unknown] */
  verticalScroll?: CPageNumberValue;
  /** [unknown] */
  deleted?: CPageNumberValue;
}

const cPagePage = properties(
  {
    id: string(),
    idx: properties(
      {
        timestamp: string(),
        value: string(),
      },
      undefined,
      true,
    ),
  },
  {
    template: properties(
      {
        timestamp: string(),
        value: string(),
      },
      undefined,
      true,
    ),
    redir: properties(
      {
        timestamp: string(),
        value: int32(),
      },
      undefined,
      true,
    ),
    scrollTime: properties(
      {
        timestamp: string(),
        value: timestamp(),
      },
      undefined,
      true,
    ),
    verticalScroll: properties(
      {
        timestamp: string(),
        value: float64(),
      },
      undefined,
      true,
    ),
    deleted: properties(
      {
        timestamp: string(),
        value: int32(),
      },
      undefined,
      true,
    ),
  },
  true,
) satisfies CompiledSchema<CPagePage, unknown>;

/** [unknown] */
export interface CPageUUID {
  /** [unknown] */
  first: string;
  /** [unknown] */
  second: number;
}

/** [unknown] metadata about pages */
export interface CPages {
  /** [speculative] the last time the document was opened */
  lastOpened: CPageStringValue;
  /** [unknown] */
  original: CPageNumberValue;
  /** [speculative] information about individual pages */
  pages: CPagePage[];
  /** [unknown] */
  uuids: CPageUUID[];
}

const cPages = properties(
  {
    lastOpened: properties(
      {
        timestamp: string(),
        value: string(),
      },
      undefined,
      true,
    ),
    original: properties(
      {
        timestamp: string(),
        value: int32(),
      },
      undefined,
      true,
    ),
    pages: elements(cPagePage),
    uuids: elements(
      properties(
        {
          first: string(),
          second: uint32(),
        },
        undefined,
        true,
      ),
    ),
  },
  undefined,
  true,
) satisfies CompiledSchema<CPages, unknown>;

/** the content metadata for collections (folders) */
export interface CollectionContent {
  /** the tags for the collection */
  tags?: Tag[];

  /** collections don't have a file type */
  fileType?: undefined;
}

const collectionContent = properties(undefined, {
  tags: elements(tag),
}) satisfies CompiledSchema<CollectionContent, unknown>;

/**
 * content metadata, stored with the "content" extension
 *
 * This largely contains description of how to render the document, rather than
 * metadata about it.
 */
export interface DocumentContent {
  /**
   * which page to use for the thumbnail
   *
   * -1 indicates the last visited page, whereas 0 is the first page.
   */
  coverPageNumber: number; // -1 for last
  /** metadata about the author, publishers, etc. */
  documentMetadata: DocumentMetadata;
  /** It's not known what this field is for */
  dummyDocument?: boolean;
  /** the largely contains metadata about what pens were used and their settings */
  extraMetadata: Record<string, string>;
  /** the underlying file type of this document */
  fileType: FileType;
  // eslint-disable-next-line spellcheck/spell-checker
  /**
   * the name of the font to use for text rendering
   *
   * The reMarkable supports five fonts by default: "Noto Sans", "Noto Sans UI",
   * "EB Garamond", "Noto Mono", and "Noto Serif". You can also set the font to
   * the empty string or omit it for the default.
   */
  fontName: string;
  /** the format version, this should always be 1 */
  formatVersion: number;
  /** the last opened page, starts at zero */
  lastOpenedPage?: number;
  /**
   * the line height
   *
   * The reMarkable uses three built-in line heights: 100, 150, 200, and
   * uses -1 to indicate the default line height, but heights outside of these
   * also work.
   */
  lineHeight: number;
  // 50, 125, 180, 200 - I think 180 is the old rm default, and the rest are the three settings
  /**
   * the document margin in pixels
   *
   * The reMarkable uses three built-in margins: 50, 125, 200, but other margins
   * are possible. The reMarkable used to default to margins of 180.
   */
  margins: number;
  /** the document orientation */
  orientation: Orientation;
  /** this specifies the number of pages, it's not clear how this is different than pageCount */
  originalPageCount?: number;
  /** the number of pages */
  pageCount: number;
  /** the page tags for the document */
  pageTags?: PageTag[];
  /** a list of the ids of each page in the document */
  pages?: string[];
  /** a mapping from page number to page id in pages */
  redirectionPageMap?: number[];
  /** ostensibly the size in bytes of the file, but this differs from other measurements */
  sizeInBytes: string;
  /** document tags for this document */
  tags?: Tag[];
  /** text alignment for this document */
  textAlignment: TextAlignment;
  /**
   * the font size
   *
   * reMarkable uses six built-in text scales: 0.7, 0.8, 1, 1.2, 1.5, 2, but
   * values outside of this range are valid.
   */
  textScale: number;
  /** [speculative] the center of the zoom for zoomed in documents */
  customZoomCenterX?: number;
  /** [speculative] the center of the zoom for zoomed in documents */
  customZoomCenterY?: number;
  /** [speculative] the orientation */
  customZoomOrientation?: Orientation;
  /** [speculative] the zoom height for zoomed in pages */
  customZoomPageHeight?: number;
  /** [speculative] the zoom width for zoomed in pages */
  customZoomPageWidth?: number;
  /** [speculative] the scale for zoomed in pages */
  customZoomScale?: number;
  /** what zoom mode is set for the page */
  zoomMode?: ZoomMode;
  /** [speculative] a transform matrix, a. la. css matrix transform */
  transform?: Record<`m${"1" | "2" | "3"}${"1" | "2" | "3"}`, number>;
  /** [speculative] metadata about keyboard use */
  keyboardMetadata?: KeyboardMetadata;
  /** [speculative] various other page metadata */
  cPages?: CPages;
  /**
   * setting for the adaptive contrast filter
   *
   * off has no background filter, best for images, full page applies the high
   * contrast filter to the entire page. If this is omitted, reMarkable will try
   * to apply the filter only to text areas.
   */
  viewBackgroundFilter?: BackgroundFilter;
}

/**
 * content metadata, stored with the "content" extension
 *
 * This largely contains description of how to render the document, rather than
 * metadata about it.
 */
export interface TemplateContent {
  /** the template name */
  name: string;
  /** the template's author */
  author: string;
  /** Base64-encoded SVG icon image */
  iconData: string;
  /** category names this template belongs to (eg: "Planning", "Productivity") */
  categories: string[];
  /** labels associated with this template (eg: "Project management") */
  labels: string[];
  /** the orientation of this template */
  orientation: "portrait" | "landscape";
  /** semantic version for this template */
  templateVersion: string;
  /** template configuration format version (currently just `1`) */
  formatVersion: number;
  /**
   * which screens the template supports:
   *
   * - `rm2`: reMarkable 2
   * - `rmPP`: reMarkable Paper Pro
   */
  supportedScreens: ("rm2" | "rmPP")[];
  /** constant values used by the commands in `items` */
  constants?: { [name: string]: number }[];
  /** the template definition, an SVG-like DSL in JSON */
  items: object[];
}

const templateContent = properties({
  name: string(),
  author: string(),
  iconData: string(),
  categories: elements(string()),
  labels: elements(string()),
  orientation: enumeration("portrait", "landscape"),
  templateVersion: string(),
  formatVersion: uint8(),
  supportedScreens: elements(enumeration("rm2", "rmPP")),
  constants: elements(values(int32())),
  items: elements(empty() as CompiledSchema<object, unknown>),
}) satisfies CompiledSchema<TemplateContent, unknown>;

/** content metadata for any item */
export type Content = CollectionContent | DocumentContent | TemplateContent;

const documentContent = properties(
  {
    coverPageNumber: int32(),
    documentMetadata,
    extraMetadata: values(string()),
    fileType: enumeration("epub", "notebook", "pdf"),
    fontName: string(),
    formatVersion: uint8(),
    lineHeight: int32(),
    margins: uint32(),
    orientation: enumeration("portrait", "landscape"),
    pageCount: uint32(),
    sizeInBytes: string(),
    textAlignment: enumeration("justify", "left"),
    textScale: float64(),
  },
  {
    cPages,
    customZoomCenterX: float64(),
    customZoomCenterY: float64(),
    customZoomOrientation: enumeration("portrait", "landscape"),
    customZoomPageHeight: float64(),
    customZoomPageWidth: float64(),
    customZoomScale: float64(),
    dummyDocument: boolean(),
    keyboardMetadata: properties(
      {
        count: uint32(),
        timestamp: float64(),
      },
      undefined,
      true,
    ),
    lastOpenedPage: uint32(),
    originalPageCount: int32(),
    pages: elements(string()),
    pageTags: elements(pageTag),
    redirectionPageMap: elements(int32()),
    tags: elements(tag),
    transform: properties(
      {
        m11: float64(),
        m12: float64(),
        m13: float64(),
        m21: float64(),
        m22: float64(),
        m23: float64(),
        m31: float64(),
        m32: float64(),
        m33: float64(),
      },
      undefined,
      true,
    ),
    // eslint-disable-next-line spellcheck/spell-checker
    viewBackgroundFilter: enumeration("off", "fullpage"),
    zoomMode: enumeration("bestFit", "customFit", "fitToHeight", "fitToWidth"),
  },
  true,
) satisfies CompiledSchema<DocumentContent, unknown>;

/**
 * item level metadata
 *
 * Stored with the extension "metadata".
 */
export interface Metadata {
  /** creation time, a string of the epoch timestamp */
  createdTime?: string;
  /** [speculative] true if the item has been actually deleted */
  deleted?: boolean;
  /** the last modify time, the string of the epoch timestamp */
  lastModified: string;
  /** the last opened epoch timestamp, isn't defined for CollectionType */
  lastOpened?: string;
  /** the last page opened, isn't defined for CollectionType, starts at 0*/
  lastOpenedPage?: number;
  /** [speculative] true if the metadata has been modified */
  metadatamodified?: boolean;
  /** [speculative] true if the item has been modified */
  modified?: boolean;
  /**
   * the id of the parent collection
   *
   * This is the empty string for root (no parent), "trash" if it's in the
   * trash, or the id of the parent.
   */
  parent: string;
  /** true of the item is starred */
  pinned: boolean;
  /** [unknown] */
  synced?: boolean;
  /**
   * the type of item this corresponds to
   *
   * DocumentType is a document, an epub, pdf, or notebook, CollectionType is a
   * folder.
   */
  type: "DocumentType" | "CollectionType" | "TemplateType";
  /** whether this is this a newly-installed template */
  new?: boolean;
  /**
   * the provider from which this item was obtained/installed
   *
   * Example: a template from "com.remarkable.methods".
   */
  source?: string;
  /** [speculative] metadata version, always 0 */
  version?: number;
  /** the visible name of the item, what it's called on the reMarkable */
  visibleName: string;
}

const metadata = properties(
  {
    lastModified: string(),
    parent: string(),
    pinned: boolean(),
    type: enumeration("DocumentType", "CollectionType", "TemplateType"),
    visibleName: string(),
  },
  {
    lastOpened: string(),
    lastOpenedPage: uint32(),
    createdTime: string(),
    deleted: boolean(),
    metadatamodified: boolean(),
    modified: boolean(),
    synced: boolean(),
    version: uint8(),
  },
  true,
) satisfies CompiledSchema<Metadata, unknown>;

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
 * access to the low-level reMarkable api
 *
 * This class gives more granualar access to the reMarkable cloud, but is more
 * dangerous.
 *
 * ## Overview
 *
 * reMarkable uses an immutable file system, where each file is referenced by
 * the 32 byte sha256 hash of its contents. Each file also has an id used to
 * keep track of updates, so to "update" a file, you upload a new file, and
 * change the hash associated with it's id.
 *
 * Each "item" (a document or a collection) is actually a list of files.
 * The whole reMarkable state is then a list of these lists. Finally, the hash
 * of that list is called the rootHash. To update anything, you have to update
 * the root hash to point to a new list of updated items.
 *
 * This can be dangerous, as corrupting the root hash can destroy all of your
 * files. It is therefore highly recommended to save your current root hash
 * ({@link getRootHash | `getRootHash`}) before using this api to attempt file
 * writes, so you can recover a previous "snapshot" should anything go wrong.
 *
 * ## Items
 *
 * Each item is a collection of individual files. Using
 * {@link getEntries | `getEntries`} on the root hash will give you a list
 * entries that correspond to items. Using `getEntries` on any of those items
 * will get you the files that make up that item.
 *
 * The documented files are:
 * - `<docid>.pdf` - a raw pdf document
 * - `<docid>.epub` - a raw epub document
 * - `<docid>.content` - a json file roughly describing document properties (see {@link DocumentContent | `DocumentContent`})
 * - `<docid>.metadata` - metadata about the document (see {@link Metadata | `Metadata`})
 * - `<docid>.pagedata` - a text file where each line is the template of that page
 * - `<docid>/<pageid>.rm` - [speculative] raw remarkable vectors, text, etc
 * - `<docid>/<pageid>-metadata.json` - [speculative] metadata about the individual page
 * - `<docid>.highlights/<pageid>.json` - [speculative] highlights on the page
 *
 * Some items will have both a `.pdf` and `.epub` file, likely due to preparing
 * for export. Collections only have `.content` and `.metadata` files, with
 * `.content` only containing tags.
 *
 * ## Caching
 *
 * Since everything is tied to the hash of it's contents, we can agressively
 * cache results. We assume that text contents are "small" and so fully cache
 * them, where as binary files we treat as large and only store that we know
 * they exist to prevent future writes.
 *
 * By default, this only persists as long as the api instance is alive. However,
 * for performance reasons, you should call {@link dumpCache | `dumpCache`} to
 * persist the cache between sessions.
 *
 * @remarks
 *
 * Generally all hashes are 64 character hex strings, and all ids are uuid4.
 */
export interface RawRemarkableApi {
  /**
   * gets the root hash and the current generation
   *
   * When calling `putRootHash`, you should pass the generation you got from
   * this call. That way you tell reMarkable you're updating the previous state.
   *
   * @returns the root hash and the current generation
   */
  getRootHash(): Promise<[string, number]>;

  /**
   * get the raw binary data associated with a hash
   *
   * @param hash - the hash to get the data for
   * @returns the data
   */
  getHash(hash: string): Promise<Uint8Array>;

  /**
   * get raw text data associated with a hash
   *
   * We assume text data are small, and so cache the entire text. If you want to
   * avoid this, use {@link getHash | `getHash`} combined with a TextDecoder.

   * @param hash - the hash to get text for
   * @returns the text
   */
  getText(hash: string): Promise<string>;

  /**
   * get the entries associated with a list hash
   *
   * A list hash is the root hash, or any hash with the type 80000000. NOTE
   * these are hashed differently than files.

   * @param hash - the hash to get entries for
   * @returns the entries
   */
  getEntries(hash: string): Promise<RawEntry[]>;

  /**
   * get the parsed and validated `Content` of a content hash
   *
   * Use {@link getText | `getText`} combined with `JSON.parse` to bypass
   * validation

   * @param hash - the hash to get Content for
   * @returns the content
   */
  getContent(hash: string): Promise<Content>;

  /**
   * get the parsed and validated `Metadata` of a metadata hash
   *
   * Use {@link getText | `getText`} combined with `JSON.parse` to bypass
   * validation

   * @param hash - the hash to get Metadata for
   * @returns the metadata
   */
  getMetadata(hash: string): Promise<Metadata>;

  /**
   * update the current root hash
   *
   * This will fail if generation doesn't match the current server generation.
   * This ensures that you are updating what you expect. IF you get a
   * {@link GenerationError | `GenerationError`}, that indicates that the server
   * was updated after you last got the generation. You should call
   * {@link getRootHash | `getRootHash`} and then recompute the changes you want
   * from the new root hash. If you ignore the update hash value and just call
   * `putRootHash` again, you will overwrite the changes made by the other
   * update.
   *
   * @param hash - the new root hash
   * @param generation - the generation of the current root hash
   * @param broadcast - [unknown] an option in the request
   *
   * @throws GenerationError if the generation doesn't match the current server generation
   * @returns the new root hash and the new generation
   */
  putRootHash(
    hash: string,
    generation: number,
    broadcast?: boolean,
  ): Promise<[string, number]>;

  /**
   * put a raw onto the server
   *
   * This returns the new expeced entry of the file you uploaded, and a promise
   * to finish the upload successful. By splitting these two operations you can
   * start using the uploaded entry while file finishes uploading.
   *
   * NOTE: This won't update the state of the reMarkable until this entry is
   * incorporated into the root hash.
   *
   * @param id - the id of the file to upload
   * @param bytes - the bytes to upload
   * @returns the new entry and a promise to finish the upload
   */
  putFile(
    id: string,
    bytes: Uint8Array,
  ): Promise<[RawFileEntry, Promise<void>]>;

  /** the same as {@link putFile | `putFile`} but with caching for text */
  putText(id: string, content: string): Promise<[RawFileEntry, Promise<void>]>;

  /** the same as {@link putText | `putText`} but with extra validation for Content */
  putContent(
    id: string,
    content: Content,
  ): Promise<[RawFileEntry, Promise<void>]>;

  /** the same as {@link putText | `putText`} but with extra validation for Metadata */
  putMetadata(
    id: string,
    metadata: Metadata,
  ): Promise<[RawFileEntry, Promise<void>]>;

  /**
   * put a set of entries to make an entry list file
   *
   * To fully upload an item:
   * 1. upload all the constituent files and metadata
   * 2. call this with all of the entries
   * 3. append this entry to the root entry and call this again to update this root list
   * 4. put the new root hash
   *
   * @param id - the id of the list to upload - this should be the item id if
   *   uploading an item list, or "root" if uploading a new root list.
   * @param entries - the entries to upload
   * @returns the new list entry and a promise to finish the upload
   */
  putEntries(
    id: string,
    entries: RawEntry[],
  ): Promise<[RawListEntry, Promise<void>]>;

  /**
   * dump the current cache to a string to preserve between session
   *
   * @returns a serialized version of the cache to pass to a new api instance
   */
  dumpCache(): string;

  /** completely clear the cache */
  clearCache(): void;
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
   * `RawListEntry` for this hash.
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
   * `RawListEntry` for this hash.
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
  createFolder(
    visibleName: string,
    opts?: UploadOptions,
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
   * this is now simply a less powerful version of {@link putEpub | `putEpub`}.
   *
   * @param visibleName - the name to show for the uploaded epub
   * @param buffer - the epub contents
   */
  uploadEpub(
    visibleName: string,
    buffer: Uint8Array,
    opts?: UploadOptions,
  ): Promise<SimpleEntry>;

  /**
   * upload a pdf
   *
   * @example
   * ```ts
   * await api.uploadPdf("My PDF", ...);
   * ```
   *
   * @remarks
   * this is now simply a less powerful version of {@link putPdf | `putPdf`}.
   *
   * @param visibleName - the name to show for the uploaded epub
   * @param buffer - the epub contents
   */
  uploadPdf(
    visibleName: string,
    buffer: Uint8Array,
    opts?: UploadOptions,
  ): Promise<SimpleEntry>;

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

interface UpdatedRootHash {
  hash: string;
  generation: number;
}

const updatedRootHash = properties(
  {
    hash: string(),
    generation: float64(),
  },
  undefined,
  true,
) satisfies CompiledSchema<UpdatedRootHash, unknown>;

interface RootHash extends UpdatedRootHash {
  schemaVersion: number;
}

const rootHash = properties(
  {
    hash: string(),
    generation: float64(),
    schemaVersion: uint8(),
  },
  undefined,
  true,
) satisfies CompiledSchema<RootHash, unknown>;

async function digest(buff: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buff);
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

interface AuthedFetch {
  (
    method: RequestMethod,
    url: string,
    init?: { body?: string | Uint8Array; headers?: Record<string, string> },
  ): Promise<Response>;
}

class RawRemarkable implements RawRemarkableApi {
  readonly #authedFetch: AuthedFetch;
  readonly #rawHost: string;
  /**
   * a cache of all hashes we know exist
   *
   * The backend is a readonly file system of hashes to content. After a hash has
   * been read or written successfully, we know it exists, and potentially it's
   * contents. We don't want to cache large binary files, but we can cache the
   * small text based metadata files. For binary files we write null, so we know
   * not to write a a cached value again, but we'll still need to read it.
   */
  readonly #cache: Map<string, string | null>;

  constructor(
    authedFetch: AuthedFetch,
    cache: Map<string, string | null>,
    rawHost: string,
  ) {
    this.#authedFetch = authedFetch;
    this.#cache = cache;
    this.#rawHost = rawHost;
  }
  /** make an authorized request to remarkable */

  async getRootHash(): Promise<[string, number]> {
    const res = await this.#authedFetch("GET", `${this.#rawHost}/sync/v4/root`);
    const raw = await res.text();
    const loaded = JSON.parse(raw) as unknown;
    if (!rootHash.guardAssert(loaded)) throw Error("invalid root hash");
    const { hash, generation, schemaVersion } = loaded;
    if (schemaVersion !== 3) {
      throw new Error(`schema version ${schemaVersion} not supported`);
    } else if (!Number.isSafeInteger(generation)) {
      throw new Error(
        `generation ${generation} was not a safe integer; please file a bug report`,
      );
    } else {
      return [hash, generation];
    }
  }

  async #getHash(hash: string): Promise<Uint8Array> {
    if (!hashReg.test(hash)) {
      throw new ValidationError(hash, hashReg, "hash was not a valid hash");
    }
    const resp = await this.#authedFetch(
      "GET",
      `${this.#rawHost}/sync/v3/files/${hash}`,
    );
    // TODO switch to `.bytes()`.
    const raw = await resp.arrayBuffer();
    return new Uint8Array(raw);
  }

  async getHash(hash: string): Promise<Uint8Array> {
    const cached = this.#cache.get(hash);
    if (cached != null) {
      const enc = new TextEncoder();
      return enc.encode(cached);
    } else {
      const res = await this.#getHash(hash);
      // mark that we know hash exists
      const cacheVal = this.#cache.get(hash);
      if (cacheVal === undefined) {
        this.#cache.set(hash, null);
      }
      return res;
    }
  }

  async getText(hash: string): Promise<string> {
    const cached = this.#cache.get(hash);
    if (cached != null) {
      return cached;
    } else {
      // NOTE two simultaneous requests will fetch twice
      const raw = await this.#getHash(hash);
      const dec = new TextDecoder();
      const res = dec.decode(raw);
      this.#cache.set(hash, res);
      return res;
    }
  }

  async getEntries(hash: string): Promise<RawEntry[]> {
    const rawFile = await this.getText(hash);
    const [version, ...rest] = rawFile.slice(0, -1).split("\n");
    if (version != "3") {
      throw new Error(`schema version ${version} not supported`);
    } else {
      return rest.map((line) => {
        const [hash, type, id, subfiles, size] = line.split(":");
        if (
          hash === undefined ||
          type === undefined ||
          id === undefined ||
          subfiles === undefined ||
          size === undefined
        ) {
          throw new Error(`line '${line}' was not formatted correctly`);
        } else if (type === "80000000") {
          return {
            hash,
            type: 80000000,
            id,
            subfiles: parseInt(subfiles),
            size: parseInt(size),
          };
        } else if (type === "0" && subfiles === "0") {
          return {
            hash,
            type: 0,
            id,
            subfiles: 0,
            size: parseInt(size),
          };
        } else {
          throw new Error(`line '${line}' was not formatted correctly`);
        }
      });
    }
  }

  async getContent(hash: string): Promise<Content> {
    const raw = await this.getText(hash);
    const loaded = JSON.parse(raw) as unknown;

    // jtd can't verify non-discriminated unions, in this case, we have fileType
    // defined or not. As a result, we try each, and concatenate the errors at the end
    const errors: string[] = [];
    for (const [name, valid] of [
      ["collection", collectionContent],
      ["template", templateContent],
      ["document", documentContent],
    ] as const) {
      try {
        if (valid.guardAssert(loaded)) return loaded;
      } catch (ex) {
        const msg = ex instanceof Error ? ex.message : "unknown error type";
        errors.push(`Couldn't validate as ${name} because:\n${msg}`);
      }
    }
    const joined = errors.join("\n\nor\n\n");
    throw new Error(`invalid content: ${joined}`);
  }

  async getMetadata(hash: string): Promise<Metadata> {
    const raw = await this.getText(hash);
    const loaded = JSON.parse(raw) as unknown;
    if (!metadata.guardAssert(loaded)) throw Error("invalid metadata");
    return loaded;
  }

  async putRootHash(
    hash: string,
    generation: number,
    broadcast: boolean = true,
  ): Promise<[string, number]> {
    if (!Number.isSafeInteger(generation)) {
      throw new Error(`generation ${generation} was not a safe integer`);
    } else if (!hashReg.test(hash)) {
      throw new ValidationError(hash, hashReg, "rootHash was not a valid hash");
    }
    const body = JSON.stringify({
      hash,
      generation,
      broadcast,
    });
    const resp = await this.#authedFetch(
      "PUT",
      `${this.#rawHost}/sync/v3/root`,
      { body },
    );
    const raw = await resp.text();
    const loaded = JSON.parse(raw) as unknown;
    if (!updatedRootHash.guardAssert(loaded)) throw Error("invalid root hash");
    const { hash: newHash, generation: newGen } = loaded;
    if (Number.isSafeInteger(newGen)) {
      return [newHash, newGen];
    } else {
      throw new Error(
        `new generation ${newGen} was not a safe integer; please file a bug report`,
      );
    }
  }

  async #putFile(
    hash: string,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<void> {
    // if the hash is already in the cache, writing is pointless
    if (!this.#cache.has(hash)) {
      const crc = CRC32C.buf(bytes, 0);
      const buff = new ArrayBuffer(4);
      new DataView(buff).setInt32(0, crc, false);
      const crcHash = fromByteArray(new Uint8Array(buff));
      await this.#authedFetch("PUT", `${this.#rawHost}/sync/v3/files/${hash}`, {
        body: bytes,
        headers: {
          "rm-filename": fileName,
          // eslint-disable-next-line spellcheck/spell-checker
          "x-goog-hash": `crc32c=${crcHash}`,
        },
      });
      // mark that we know this hash exists
      const cacheVal = this.#cache.get(hash);
      if (cacheVal === undefined) {
        this.#cache.set(hash, null);
      }
    }
  }

  async putFile(
    id: string,
    bytes: Uint8Array,
  ): Promise<[RawFileEntry, Promise<void>]> {
    const hash = await digest(bytes);
    const res: RawFileEntry = {
      id,
      hash,
      type: 0,
      subfiles: 0,
      size: bytes.length,
    };
    return [res, this.#putFile(hash, id, bytes)];
  }

  async putText(
    id: string,
    text: string,
  ): Promise<[RawFileEntry, Promise<void>]> {
    const enc = new TextEncoder();
    const bytes = enc.encode(text);
    const [ent, upload] = await this.putFile(id, bytes);
    return [
      ent,
      upload.then(() => {
        // on success, write to cache
        this.#cache.set(ent.hash, text);
      }),
    ];
  }

  async putContent(
    id: string,
    content: Content,
  ): Promise<[RawFileEntry, Promise<void>]> {
    if (!id.endsWith(".content")) {
      throw new Error(`id ${id} did not end with '.content'`);
    } else {
      return await this.putText(id, JSON.stringify(content));
    }
  }

  async putMetadata(
    id: string,
    metadata: Metadata,
  ): Promise<[RawFileEntry, Promise<void>]> {
    if (!id.endsWith(".metadata")) {
      throw new Error(`id ${id} did not end with '.metadata'`);
    } else {
      return await this.putText(id, JSON.stringify(metadata));
    }
  }

  async putEntries(
    id: string,
    entries: RawEntry[],
  ): Promise<[RawListEntry, Promise<void>]> {
    // NOTE collections have a special hash function, the hash of their
    // contents, so this needs to be different
    entries.sort((a, b) => a.id.localeCompare(b.id));
    const hashBuff = new Uint8Array(entries.length * 32);
    for (const [start, { hash }] of entries.entries()) {
      for (const [i, byte] of (hash.match(/../g) ?? []).entries()) {
        hashBuff[start * 32 + i] = parseInt(byte, 16);
      }
    }
    const hash = await digest(hashBuff);
    const size = entries.reduce((acc, ent) => acc + ent.size, 0);

    const records = ["3\n"];
    for (const { hash, type, id, subfiles, size } of entries) {
      records.push(`${hash}:${type}:${id}:${subfiles}:${size}\n`);
    }
    const res: RawListEntry = {
      id,
      hash,
      type: 80000000,
      subfiles: entries.length,
      size,
    };
    const enc = new TextEncoder();
    return [
      res,
      // NOTE when monitoring requests, this had the extension .docSchema appended, but I'm not entirely sure why
      this.#putFile(hash, `${id}.docSchema`, enc.encode(records.join(""))),
    ];
  }

  dumpCache(): string {
    return JSON.stringify(Object.fromEntries(this.#cache));
  }

  clearCache(): void {
    this.#cache.clear();
  }
}

/** the implementation of that api */
class Remarkable implements RemarkableApi {
  readonly #userToken: string;
  /** the same cache that underlies the raw api, allowing us to modify it */
  readonly #cache: Map<string, string | null>;
  readonly raw: RawRemarkable;
  #lastHashGen: readonly [string, number] | undefined;

  constructor(
    userToken: string,
    rawHost: string,
    cache: Map<string, string | null>,
  ) {
    this.#userToken = userToken;
    this.#cache = cache;
    this.raw = new RawRemarkable(
      (method, url, { body, headers } = {}) =>
        this.#authedFetch(url, { method, body, headers }),
      cache,
      rawHost,
    );
  }

  async #getRootHash(
    refresh: boolean = false,
  ): Promise<readonly [string, number]> {
    if (refresh || this.#lastHashGen === undefined) {
      this.#lastHashGen = await this.raw.getRootHash();
    }
    return this.#lastHashGen;
  }

  async #putRootHash(hash: string, generation: number): Promise<void> {
    try {
      this.#lastHashGen = await this.raw.putRootHash(hash, generation);
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
        Authorization: `Bearer ${this.#userToken}`,
        ...headers,
      },
      body,
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
    const entries = await this.raw.getEntries(hash);
    const metaEnt = entries.find((ent) => ent.id.endsWith(".metadata"));
    const contentEnt = entries.find((ent) => ent.id.endsWith(".content"));
    if (metaEnt === undefined) {
      throw new Error(`couldn't find metadata for hash ${hash}`);
    } else if (contentEnt === undefined) {
      throw new Error(`couldn't find content for hash ${hash}`);
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
      this.raw.getContent(contentEnt.hash),
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
    const entries = await this.raw.getEntries(hash);
    return entries.map(({ id, hash }) => ({ id, hash }));
  }

  async getContent(hash: string): Promise<Content> {
    const entries = await this.raw.getEntries(hash);
    const [cont] = entries.filter((e) => e.id.endsWith(".content"));
    if (cont === undefined) {
      throw new Error(`couldn't find contents for hash ${hash}`);
    } else {
      return await this.raw.getContent(cont.hash);
    }
  }

  async getMetadata(hash: string): Promise<Metadata> {
    const entries = await this.raw.getEntries(hash);
    const [meta] = entries.filter((e) => e.id.endsWith(".metadata"));
    if (meta === undefined) {
      throw new Error(`couldn't find metadata for hash ${hash}`);
    } else {
      return await this.raw.getMetadata(meta.hash);
    }
  }

  async getPdf(hash: string): Promise<Uint8Array> {
    const entries = await this.raw.getEntries(hash);
    const [pdf] = entries.filter((e) => e.id.endsWith(".pdf"));
    if (pdf === undefined) {
      throw new Error(`couldn't find pdf for hash ${hash}`);
    } else {
      return await this.raw.getHash(pdf.hash);
    }
  }

  async getEpub(hash: string): Promise<Uint8Array> {
    const entries = await this.raw.getEntries(hash);
    const [epub] = entries.filter((e) => e.id.endsWith(".epub"));
    if (epub === undefined) {
      throw new Error(`couldn't find epub for hash ${hash}`);
    } else {
      return await this.raw.getHash(epub.hash);
    }
  }

  async getDocument(hash: string): Promise<Uint8Array> {
    const entries = await this.raw.getEntries(hash);
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
      [rootHash, generation],
    ] = await Promise.all([
      this.raw.putContent(`${id}.content`, content),
      this.raw.putMetadata(`${id}.metadata`, metadata),
      // eslint-disable-next-line spellcheck/spell-checker
      this.raw.putText(`${id}.pagedata`, "\n"),
      this.raw.putFile(`${id}.${fileType}`, buffer),
      this.#getRootHash(refresh),
    ]);

    // now fetch root entries and upload this file entry
    const [[collectionEntry, uploadCollection], rootEntries] =
      await Promise.all([
        this.raw.putEntries(id, [
          contentEntry,
          metadataEntry,
          pagedataEntry,
          fileEntry,
        ]),
        this.raw.getEntries(rootHash),
      ]);

    // now upload a new root entry
    rootEntries.push(collectionEntry);
    const [rootEntry, uploadRoot] = await this.raw.putEntries(
      "root",
      rootEntries,
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
  async createFolder(
    visibleName: string,
    { parent = "" }: UploadOptions = {},
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
      [rootHash, generation],
    ] = await Promise.all([
      this.raw.putContent(`${id}.content`, content),
      this.raw.putMetadata(`${id}.metadata`, metadata),
      this.#getRootHash(refresh),
    ]);

    // now fetch root entries and upload this file entry
    const [[collectionEntry, uploadCollection], rootEntries] =
      await Promise.all([
        this.raw.putEntries(id, [contentEntry, metadataEntry]),
        this.raw.getEntries(rootHash),
      ]);

    // now upload a new root entry
    rootEntries.push(collectionEntry);
    const [rootEntry, uploadRoot] = await this.raw.putEntries(
      "root",
      rootEntries,
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
    opts: UploadOptions = {},
  ): Promise<SimpleEntry> {
    return await this.putEpub(visibleName, buffer, opts);
  }

  /** upload a pdf */
  async uploadPdf(
    visibleName: string,
    buffer: Uint8Array,
    opts: UploadOptions = {},
  ): Promise<SimpleEntry> {
    return await this.putPdf(visibleName, buffer, opts);
  }

  async #editMetaRaw(
    id: string,
    hash: string,
    update: Partial<Metadata>,
  ): Promise<[RawListEntry, Promise<void>]> {
    const entries = await this.raw.getEntries(hash);
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
    const [result, uploadentries] = await this.raw.putEntries(id, entries);
    const upload = Promise.all([uploadMeta, uploadentries]).then(() => {});
    return [result, upload];
  }

  async #editMeta(
    hash: string,
    update: Partial<Metadata>,
    refresh: boolean = false,
  ): Promise<HashEntry> {
    const [rootHash, generation] = await this.#getRootHash(refresh);
    const entries = await this.raw.getEntries(rootHash);
    const hashInd = entries.findIndex((ent) => ent.hash === hash);
    const hashEnt = entries[hashInd];
    if (hashEnt === undefined) {
      throw new HashNotFoundError(hash);
    }
    const [newEnt, uploadEnt] = await this.#editMetaRaw(
      hashEnt.id,
      hash,
      update,
    );
    entries[hashInd] = newEnt;
    const [rootEntry, uploadRoot] = await this.raw.putEntries("root", entries);

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

    const [rootHash, generation] = await this.#getRootHash(refresh);
    const entries = await this.raw.getEntries(rootHash);

    const hashSet = new Set(hashes);
    const toUpdate: RawEntry[] = [];
    const newEntries: RawEntry[] = [];
    for (const entry of entries) {
      const part = hashSet.has(entry.hash) ? toUpdate : newEntries;
      part.push(entry);
    }

    const resolved = await Promise.all(
      toUpdate.map(({ id, hash }) => this.#editMetaRaw(id, hash, { parent })),
    );
    const uploads: Promise<void>[] = [];
    const result: Record<string, string> = {};
    for (const [i, [newEnt, upload]] of resolved.entries()) {
      newEntries.push(newEnt);
      uploads.push(upload);
      result[toUpdate[i]!.hash] = newEnt.hash;
    }

    const [rootEntry, uploadRoot] = await this.raw.putEntries(
      "root",
      newEntries,
    );
    uploads.push(uploadRoot);
    await Promise.all(uploads);

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
    let entries = [await this.raw.getEntries(rootHash)];
    let nextEntries: Promise<RawEntry[]>[] = [];
    while (entries.length) {
      for (const entryList of entries) {
        for (const { hash, type } of entryList) {
          toDelete.add(hash);
          if (type === 80000000) {
            nextEntries.push(this.raw.getEntries(hash));
          }
        }
      }
      entries = await Promise.all(nextEntries);
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

/** options for a remarkable instance */
export interface RemarkableOptions {
  /**
   * the url for making authorization requests
   *
   * @defaultValue "https://webapp-prod.cloud.remarkable.engineering"
   */
  authHost?: string;

  /**
   * the url for making synchronization requests
   *
   * @defaultValue "https://web.eu.tectonic.remarkable.com"
   */
  syncHost?: string;

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

const cached = values(nullable(string())) satisfies CompiledSchema<
  Record<string, string | null>,
  unknown
>;

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
    authHost = AUTH_HOST,
    rawHost = RAW_HOST,
    cache,
    maxCacheSize = Infinity,
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
  const initCache = JSON.parse(cache ?? "{}") as unknown;
  if (cached.guard(initCache)) {
    const entries = Object.entries(initCache);
    const cache =
      maxCacheSize === Infinity
        ? new Map(entries)
        : new LruCache(maxCacheSize, entries);
    return new Remarkable(userToken, rawHost, cache);
  } else {
    throw new Error(
      "cache was not a valid cache (json string mapping); your cache must be corrupted somehow. Either initialize remarkable without a cache, or fix its format.",
    );
  }
}
