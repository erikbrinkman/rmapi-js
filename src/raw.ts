import CRC32C from "crc-32/crc32c.js";
import {
  hexToUint8Array,
  uint8ArrayToBase64,
  uint8ArrayToHex,
} from "uint8array-extras";
import { z } from "zod";
import { ValidationError } from "./error.js";
import {
  HEADER_LENGTH,
  parseV5,
  type RmPageV5,
  serializeRm,
  VERSION_PREFIX,
} from "./rm5.js";
import { parseRmScene, type RmScene } from "./rm6.js";
import { concatArrays } from "./utils.js";

const hashReg = /^[0-9a-f]{64}$/;

/**
 * a parsed reMarkable `.rm` page
 *
 * A discriminated union on `version`: versions 3/5 parse to the flat, renderable
 * {@link RmPageV5 | `RmPageV5`}; version 6 parses to the richer
 * {@link RmScene | `RmScene`} CRDT scene (`version: 6`).
 */
export type RmPage = RmPageV5 | RmScene;

/**
 * parse the bytes of a reMarkable `.rm` page file
 *
 * Dispatches on the header version: versions 3/5 parse to a flat
 * {@link RmPageV5 | `RmPageV5`}; version 6 parses to an
 * {@link RmScene | `RmScene`}. Throws for an unknown version or malformed data.
 *
 * @param data - the raw `.rm` file bytes
 * @returns the parsed page
 */
export function parseRm(data: Uint8Array): RmPage {
  if (data.length < HEADER_LENGTH) {
    throw new Error("data is too short to be a reMarkable .lines file");
  }
  const header = new TextDecoder().decode(data.subarray(0, HEADER_LENGTH));
  if (!header.startsWith(VERSION_PREFIX)) {
    throw new Error(`unrecognized .lines header: ${JSON.stringify(header)}`);
  }
  const versionChar = header.charAt(VERSION_PREFIX.length);
  if (versionChar === "6") {
    return parseRmScene(data);
  } else if (versionChar === "3" || versionChar === "5") {
    return parseV5(data, versionChar === "3" ? 3 : 5);
  } else {
    throw new Error(`unsupported .lines version '${versionChar}'`);
  }
}

/** request types */
export type RequestMethod =
  | "POST"
  | "GET"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "OPTIONS";

/** the supported upload mime types */
export type UploadMimeType =
  | "application/pdf"
  | "application/epub+zip"
  | "folder";

/** the schema version */
export type SchemaVersion = 3 | 4;

/**
 * a reference to stored cloud data: an id paired with the hash of its state
 *
 * This is the canonical way to point at something in the cloud. The `id` names
 * *what*: a document's uuid at the high level, or a stored file name (like
 * `<id>.content`) at the low level. The `hash` names *which version*, and
 * changes every time that data mutates. Reads take one of these, and mutations
 * return a fresh one with the new hash.
 */
export interface ItemRef {
  /** the id of the referenced data: a document uuid, or a stored file name */
  id: string;
  /** the hash of the referenced state */
  hash: string;
}

/**
 * the low-level entry corresponding to a collection of files
 *
 * A collection could be for the root collection, or for an individual document,
 * which is often a collection of files. If an entry represents a collection of
 * files, the high level entry will have the same hash and id as the low-level
 * entry for that collection.
 */
export interface RawEntry extends ItemRef {
  /** 80000000 for schema 3 collection type or 0 for schema 4 or schema 3 files or */
  type: 80000000 | 0;
  /** the number of subfiles */
  subfiles: number;
  /** the total size of everything in the collection */
  size: number;
}

/** the type of files reMarkable supports */
export type FileType = "epub" | "pdf" | "notebook";

/**
 * a parsed entries file
 *
 * id and size are defined for schema 4 but not for 3
 */
export interface Entries {
  /** the raw entries in the file */
  entries: RawEntry[];
  /** the id of this entry, only specified for schema 4 */
  id?: string;
  /** the recursive size of this entry, only specified for schema 4 */
  size?: number;
}

/** a tag for an entry */
export interface Tag {
  /** the name of the tag */
  name: string;
  /** the timestamp when this tag was added */
  timestamp: number;
}

const tag: z.ZodType<Tag> = z
  .object({
    name: z.string(),
    timestamp: z.number(),
  })
  .passthrough();

/** a tag for individual pages */
export interface PageTag extends Tag {
  /** the id of the page this is on */
  pageId: string;
}

const pageTag: z.ZodType<PageTag> = z
  .object({
    name: z.string(),
    pageId: z.string(),
    timestamp: z.number(),
  })
  .passthrough();

/** all supported document orientations */
export type Orientation = "portrait" | "landscape";

/** all supported text alignments */
export type TextAlignment = "" | "justify" | "left";

/** types of zoom modes for documents, applies primarily to pdf files */
export type ZoomMode = "bestFit" | "customFit" | "fitToHeight" | "fitToWidth";

/**
 * types of background filter
 *
 * off has no background filter, best for images, full page applies the high
 * contrast filter to the entire page. If this is omitted, reMarkable will try
 * to apply the filter only to text areas.
 */
export type BackgroundFilter = "off" | "fullpage";

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

const documentMetadata: z.ZodType<DocumentMetadata> = z
  .object({
    authors: z.array(z.string()).optional(),
    title: z.string().optional(),
    publicationDate: z.string().optional(),
    publisher: z.string().optional(),
  })
  .passthrough();

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
  /**
   * a per-page last-modified epoch-milliseconds timestamp
   *
   * The misspelling is reMarkable's own: the firmware writes this key as
   * `modifed`. Unlike the sibling fields it is a bare string, not a
   * timestamped value.
   */
  modifed?: string;
}

const cPagePage: z.ZodType<CPagePage> = z
  .object({
    id: z.string(),
    idx: z.object({ timestamp: z.string(), value: z.string() }).passthrough(),
    template: z
      .object({ timestamp: z.string(), value: z.string() })
      .passthrough()
      .optional(),
    redir: z
      .object({ timestamp: z.string(), value: z.number().int() })
      .passthrough()
      .optional(),
    scrollTime: z
      .object({
        timestamp: z.string(),
        value: z.string().datetime({ offset: true }),
      })
      .passthrough()
      .optional(),
    verticalScroll: z
      .object({ timestamp: z.string(), value: z.number() })
      .passthrough()
      .optional(),
    deleted: z
      .object({ timestamp: z.string(), value: z.number().int() })
      .passthrough()
      .optional(),
    modifed: z.string().optional(),
  })
  .passthrough();

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
  uuids: CPageUUID[] | null;
}

const cPages: z.ZodType<CPages> = z
  .object({
    lastOpened: z
      .object({ timestamp: z.string(), value: z.string() })
      .passthrough(),
    original: z
      .object({ timestamp: z.string(), value: z.number().int() })
      .passthrough(),
    pages: z.array(cPagePage),
    uuids: z
      .array(
        z
          .object({ first: z.string(), second: z.number().int().nonnegative() })
          .passthrough(),
      )
      .nullable(),
  })
  .passthrough();

/** the content metadata for collections (folders) */
export interface CollectionContent {
  /** the tags for the collection */
  tags?: Tag[];

  /** collections don't have a file type */
  fileType?: undefined;
}

/** legacy collection content can store tags as raw strings */
export interface LegacyCollectionContent {
  /** the legacy tag names for the collection */
  tags?: string[];

  /** collections don't have a file type */
  fileType?: undefined;
}

const collectionContent: z.ZodType<CollectionContent> = z
  .object({
    tags: z.array(tag).optional(),
  })
  .strict();

const legacyCollectionContent: z.ZodType<LegacyCollectionContent> = z
  .object({
    tags: z.array(z.string()).optional(),
  })
  .strict();

/**
 * content metadata, stored with the "content" extension
 *
 * This largely contains description of how to render the document, rather than
 * metadata about it.
 */
/** fields shared by current and legacy document content payloads */
export interface CommonDocumentContent {
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
  /**
   * the name of the font to use for text rendering
   *
   * The reMarkable supports five fonts by default: "Noto Sans", "Noto Sans UI",
   * "EB Garamond", "Noto Mono", and "Noto Serif". You can also set the font to
   * the empty string or omit it for the default.
   */
  fontName: string;
  /** the format version, this should always be 1 */
  formatVersion?: number;
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
  margins?: number;
  /** the document orientation */
  orientation: Orientation;
  /** this specifies the number of pages, it's not clear how this is different than pageCount */
  originalPageCount?: number;
  /** the number of pages */
  pageCount: number;
  /** the page tags for the document */
  pageTags?: PageTag[];
  /** a list of the ids of each page in the document, or null when never opened */
  pages?: string[] | null;
  /** a mapping from page number to page id in pages */
  redirectionPageMap?: number[];
  /** ostensibly the size in bytes of the file, but this differs from other measurements */
  sizeInBytes?: string;
  /** text alignment for this document */
  textAlignment: TextAlignment;
  /**
   * the font size
   *
   * reMarkable uses six built-in text scales: 0.7, 0.8, 1, 1.2, 1.5, 2, but
   * values outside of this range are valid.
   */
  textScale: number;
  /**
   * the horizontal center of a customFit zoom
   *
   * An offset in device pixels from the horizontal center of the page (0 =
   * centered, negative = left, positive = right). This and
   * {@link customZoomCenterY} are in the page's own frame, so device
   * orientation does not affect them.
   */
  customZoomCenterX?: number;
  /**
   * the vertical center of a customFit zoom
   *
   * An absolute distance in device pixels from the top of the page (negative =
   * up, positive = down); centering is half the page's rendered height.
   */
  customZoomCenterY?: number;
  /** the orientation the customFit zoom was set in */
  customZoomOrientation?: Orientation;
  /**
   * the rendered height of the pdf page, in device pixels
   *
   * Computed from the pdf page height in points and the device dpi as
   * `heightPt * dpi / 72`; the dpi depends on the model (see
   * {@link deviceScreens | `deviceScreens`}).
   */
  customZoomPageHeight?: number;
  /** the rendered width of the pdf page, in device pixels */
  customZoomPageWidth?: number;
  /**
   * the scale for a customFit zoom
   *
   * `customZoomScale = screenHeight / viewHeight` in device pixels, normalized to
   * 1:1 native pixels: at 1 the view is screen-tall, showing `screenHeight /
   * customZoomPageHeight` of the page. reMarkable generally allows 0.5 to 5, but
   * values outside that bound are still supported.
   */
  customZoomScale?: number;
  /** the zoom mode; customFit applies the customZoom* fields, the rest auto-fit */
  zoomMode?: ZoomMode;
  /** [speculative] a transform matrix, a. la. css matrix transform */
  transform?: Partial<Record<`m${"1" | "2" | "3"}${"1" | "2" | "3"}`, number>>;
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

/** document content with modern structured tag payloads */
export interface DocumentContent extends CommonDocumentContent {
  /** document tags for this document */
  tags?: Tag[];
}

/** legacy document content can store tags as raw strings */
export interface LegacyDocumentContent extends CommonDocumentContent {
  /** the legacy tag names for this document */
  tags?: string[];
}

const documentContentRequired = {
  coverPageNumber: z.number().int(),
  documentMetadata,
  extraMetadata: z.record(z.string(), z.string()),
  fileType: z.enum(["epub", "notebook", "pdf"]),
  fontName: z.string(),
  lineHeight: z.number().int(),
  orientation: z.enum(["portrait", "landscape"]),
  pageCount: z.number().int().nonnegative(),
  textAlignment: z.enum(["", "justify", "left"]),
  textScale: z.number(),
};

const documentContentOptional = {
  cPages: cPages.optional(),
  customZoomCenterX: z.number().optional(),
  customZoomCenterY: z.number().optional(),
  customZoomOrientation: z.enum(["portrait", "landscape"]).optional(),
  customZoomPageHeight: z.number().optional(),
  customZoomPageWidth: z.number().optional(),
  customZoomScale: z.number().optional(),
  dummyDocument: z.boolean().optional(),
  formatVersion: z.number().int().nonnegative().optional(),
  keyboardMetadata: z
    .object({ count: z.number().int().nonnegative(), timestamp: z.number() })
    .passthrough()
    .optional(),
  lastOpenedPage: z.number().int().optional(),
  margins: z.number().int().nonnegative().optional(),
  originalPageCount: z.number().int().optional(),
  pages: z.array(z.string()).nullable().optional(),
  pageTags: z.array(pageTag).optional(),
  redirectionPageMap: z.array(z.number().int()).optional(),
  sizeInBytes: z.string().optional(),
  transform: z
    .object({
      m11: z.number().optional(),
      m12: z.number().optional(),
      m13: z.number().optional(),
      m21: z.number().optional(),
      m22: z.number().optional(),
      m23: z.number().optional(),
      m31: z.number().optional(),
      m32: z.number().optional(),
      m33: z.number().optional(),
    })
    .passthrough()
    .optional(),
  viewBackgroundFilter: z.enum(["off", "fullpage"]).optional(),
  zoomMode: z
    .enum(["bestFit", "customFit", "fitToHeight", "fitToWidth"])
    .optional(),
};

const commonDocumentContent = z
  .object({ ...documentContentRequired, ...documentContentOptional })
  .passthrough() satisfies z.ZodType<CommonDocumentContent>;

const documentContent: z.ZodType<DocumentContent> = commonDocumentContent
  .extend({ tags: z.array(tag).optional() })
  .passthrough();

const legacyDocumentContent: z.ZodType<LegacyDocumentContent> =
  commonDocumentContent
    .extend({ tags: z.array(z.string()).optional() })
    .passthrough();

/**
 * content metadata, stored with the "content" extension
 *
 * This largely contains description of how to render the document, rather than
 * metadata about it.
 */
export interface TemplateContent {
  /** the template's own id, when present */
  id?: string;
  /** the template name */
  name: string;
  /** the template's author */
  author: string;
  /** Base64-encoded SVG icon image */
  iconData: string;
  /** category names this template belongs to (eg: "Planning", "Productivity") */
  categories: string[];
  /** labels associated with this template (eg: "Project management") */
  labels?: string[];
  /** the orientation of this template */
  orientation: "portrait" | "landscape";
  /** semantic version for this template */
  templateVersion: string;
  /** template configuration format version (currently just `1`) */
  formatVersion?: number;
  /**
   * which screens the template supports:
   *
   * - `rm2`: reMarkable 2
   * - `rmPP`: reMarkable Paper Pro
   */
  supportedScreens?: ("rm2" | "rmPP")[];
  /**
   * named constants used by the `items` DSL
   *
   * A value is either a literal number or an expression string that references
   * other constants and `templateWidth`, e.g. `"templateWidth - (offsetX * 2)"`.
   */
  constants?: { [name: string]: number | string }[];
  /** the template definition, an SVG-like DSL in JSON */
  items: object[];
}

const templateContent: z.ZodType<TemplateContent> = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    author: z.string(),
    iconData: z.string(),
    categories: z.array(z.string()),
    labels: z.array(z.string()).optional(),
    orientation: z.enum(["portrait", "landscape"]),
    templateVersion: z.string(),
    supportedScreens: z.array(z.enum(["rm2", "rmPP"])).optional(),
    constants: z
      .array(z.record(z.string(), z.union([z.number(), z.string()])))
      .optional(),
    items: z.array(z.unknown() as unknown as z.ZodType<object>),
    formatVersion: z.number().int().nonnegative().optional(),
  })
  .passthrough();

/** content metadata for any item */
export type Content =
  | CollectionContent
  | LegacyCollectionContent
  | DocumentContent
  | LegacyDocumentContent
  | TemplateContent;

// content payloads aren't discriminable (legacy/modern differ only by tags
// element type), so this is an ordered union: the first matching variant wins
const content: z.ZodType<Content> = z.union([
  collectionContent,
  legacyCollectionContent,
  templateContent,
  documentContent,
  legacyDocumentContent,
]);

/**
 * item level metadata
 *
 * Stored with the extension "metadata".
 */
export interface Metadata {
  /** creation time, a string of the epoch timestamp */
  createdTime?: string;
  /** [speculative] true if the item has been actually deleted */
  deleted?: boolean | null;
  /** the last modify time, the string of the epoch timestamp */
  lastModified?: string;
  /** the last opened epoch timestamp, isn't defined for CollectionType */
  lastOpened?: string;
  /** the last page opened, isn't defined for CollectionType, starts at 0*/
  lastOpenedPage?: number;
  /** [speculative] true if the metadata has been modified */
  metadatamodified?: boolean | null;
  /** [speculative] true if the item has been modified */
  modified?: boolean | null;
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
  synced?: boolean | null;
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

const metadata: z.ZodType<Metadata> = z
  .object({
    lastModified: z.string().optional(),
    parent: z.string(),
    pinned: z.boolean(),
    type: z.enum(["DocumentType", "CollectionType", "TemplateType"]),
    visibleName: z.string(),
    lastOpened: z.string().optional(),
    lastOpenedPage: z.number().int().optional(),
    createdTime: z.string().optional(),
    deleted: z.boolean().nullish(),
    metadatamodified: z.boolean().nullish(),
    modified: z.boolean().nullish(),
    synced: z.boolean().nullish(),
    version: z.number().int().nonnegative().optional(),
    new: z.boolean().optional(),
    source: z.string().optional(),
  })
  .passthrough();

/** parse and validate the json text of a `.metadata` file */
export function parseMetadata(text: string): Metadata {
  const loaded = JSON.parse(text) as unknown;
  return metadata.parse(loaded);
}

interface UpdatedRootHash {
  hash: string;
  generation: number;
}

const updatedRootHash: z.ZodType<UpdatedRootHash> = z
  .object({
    hash: z.string(),
    generation: z.number(),
  })
  .passthrough();

interface RootHash extends UpdatedRootHash {
  schemaVersion: number;
}

const rootHash: z.ZodType<RootHash> = z
  .object({
    hash: z.string(),
    generation: z.number(),
    schemaVersion: z.number().int().nonnegative(),
  })
  .passthrough();

interface NativeItemRef {
  docID: string;
  hash: string;
}

const nativeItemRef: z.ZodType<NativeItemRef> = z
  .object({
    docID: z.string(),
    hash: z.string(),
  })
  .passthrough();

async function digest(buff: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    // NOTE this is type hinted wrong, but it does work correctly on a uint8 view
    buff as unknown as ArrayBuffer,
  );
  return uint8ArrayToHex(new Uint8Array(digest));
}

type AuthedFetch = (
  method: RequestMethod,
  url: string,
  init?: { body?: string | Uint8Array; headers?: Record<string, string> },
) => Promise<Response>;

function parseRawEntryLine(line: string): RawEntry {
  const [hash, type, id, subfiles, size] = line.split(":");
  if (
    hash === undefined ||
    type === undefined ||
    id === undefined ||
    subfiles === undefined ||
    size === undefined
  ) {
    throw new Error(`line '${line}' was not formatted correctly`);
  } else if (type === "80000000" || type === "0") {
    return {
      hash,
      type: type === "0" ? 0 : 80000000,
      id,
      subfiles: parseInt(subfiles, 10),
      size: parseInt(size, 10),
    };
  } else {
    throw new Error(`line '${line}' was not formatted correctly`);
  }
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
export class RawRemarkable {
  readonly #authedFetch: AuthedFetch;
  readonly #rawHost: string;
  readonly #uploadHost: string;
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
    uploadHost: string,
  ) {
    this.#authedFetch = authedFetch;
    this.#cache = cache;
    this.#rawHost = rawHost;
    this.#uploadHost = uploadHost;
  }
  /** make an authorized request to remarkable */

  /**
   * gets the root hash and the current generation
   *
   * When calling `putRootHash`, you should pass the generation you got from
   * this call. That way you tell reMarkable you're updating the previous state.
   *
   * @returns the root hash and the current generation
   */
  async getRootHash(): Promise<[string, number, SchemaVersion]> {
    const res = await this.#authedFetch("GET", `${this.#rawHost}/sync/v4/root`);
    const raw = await res.text();
    const loaded = JSON.parse(raw) as unknown;
    const { hash, generation, schemaVersion } = rootHash.parse(loaded);
    if (schemaVersion !== 3 && schemaVersion !== 4) {
      throw new Error(`schema version ${schemaVersion} not supported`);
    } else if (!Number.isSafeInteger(generation)) {
      throw new Error(
        `generation ${generation} was not a safe integer; please file a bug report`,
      );
    } else {
      return [hash, generation, schemaVersion];
    }
  }

  async #getHash(fileName: string, hash: string): Promise<Uint8Array> {
    if (!hashReg.test(hash)) {
      throw new ValidationError(hash, hashReg, "hash was not a valid hash");
    }
    const resp = await this.#authedFetch(
      "GET",
      `${this.#rawHost}/sync/v3/files/${hash}`,
      { headers: { "rm-filename": fileName } },
    );
    // TODO switch to `.bytes()`.
    const raw = await resp.arrayBuffer();
    return new Uint8Array(raw);
  }

  /**
   * get the raw binary data associated with a hash
   *
   * @param ref - a reference to the stored file. Its `id` is the logical file
   *   name (`<id>.<ext>` for files, or `<id>.docSchema` / `"root.docSchema"`
   *   for entry indexes), which reMarkable validates against the rm-filename
   *   header. Sub-entries from {@link getEntries | `getEntries`} can be passed
   *   directly.
   * @returns the data
   */
  async getHash({ id: fileName, hash }: ItemRef): Promise<Uint8Array> {
    const cached = this.#cache.get(hash);
    if (cached != null) {
      const enc = new TextEncoder();
      return enc.encode(cached);
    } else {
      const res = await this.#getHash(fileName, hash);
      // mark that we know hash exists
      const cacheVal = this.#cache.get(hash);
      if (cacheVal === undefined) {
        this.#cache.set(hash, null);
      }
      return res;
    }
  }

  /**
   * get raw text data associated with a hash
   *
   * We assume text data are small, and so cache the entire text. If you want to
   * avoid this, use {@link getHash | `getHash`} combined with a TextDecoder.
   *
   * @param ref - a reference to the stored file (see {@link getHash})
   * @returns the text
   */
  async getText({ id: fileName, hash }: ItemRef): Promise<string> {
    const cached = this.#cache.get(hash);
    if (cached != null) {
      return cached;
    } else {
      // NOTE two simultaneous requests will fetch twice
      const raw = await this.#getHash(fileName, hash);
      const dec = new TextDecoder();
      const res = dec.decode(raw);
      this.#cache.set(hash, res);
      return res;
    }
  }

  /**
   * get the entries associated with a list hash
   *
   * A list hash is the root hash, or any hash with the type 80000000. NOTE
   * these are hashed differently than files.
   *
   * @param ref - a reference whose `id` is `"root.docSchema"` for the root, or
   *   `"<id>.docSchema"` for a sub-document's entry index
   * @returns the entries
   */
  async getEntries(ref: ItemRef): Promise<Entries> {
    const rawFile = await this.getText(ref);
    const [version, ...rest] = rawFile.slice(0, -1).split("\n");
    if (version === "3") {
      return { entries: rest.map(parseRawEntryLine) };
    } else if (version === "4") {
      const [info, ...remaining] = rest;
      if (!info) throw new Error("missing info line for schema version 4");
      const [lead, id, count, size] = info.split(":");
      if (
        lead !== "0" ||
        id === undefined ||
        count === undefined ||
        size === undefined
      ) {
        throw new Error(
          `schema 4 info line '${info}' was not formatted correctly`,
        );
      }
      const entries = remaining.map(parseRawEntryLine);
      if (parseInt(count, 10) !== entries.length) {
        throw new Error(
          `schema 4 expected ${count} entries, but found ${entries.length}`,
        );
      } else {
        return { entries, id, size: parseInt(size, 10) };
      }
    } else {
      throw new Error(`schema version ${version} not supported`);
    }
  }

  /**
   * get the parsed and validated `Content` of a content hash
   *
   * Use {@link getText | `getText`} combined with `JSON.parse` to bypass
   * validation
   *
   * @param ref - a reference to the stored file, typically `"<id>.content"`
   * @returns the content
   */
  async getContent(ref: ItemRef): Promise<Content> {
    const raw = await this.getText(ref);
    const loaded = JSON.parse(raw) as unknown;
    return content.parse(loaded);
  }

  /**
   * get the parsed and validated `Metadata` of a metadata hash
   *
   * Use {@link getText | `getText`} combined with `JSON.parse` to bypass
   * validation
   *
   * @param ref - a reference to the stored file, typically `"<id>.metadata"`
   * @returns the metadata
   */
  async getMetadata(ref: ItemRef): Promise<Metadata> {
    const raw = await this.getText(ref);
    const loaded = JSON.parse(raw) as unknown;
    return metadata.parse(loaded);
  }

  /**
   * get the parsed reMarkable lines (`.rm`) drawing of a page hash
   *
   * @param ref - a reference to the stored file, typically `"<id>/<pageid>.rm"`
   * @returns the parsed page
   */
  async getRm(ref: ItemRef): Promise<RmPage> {
    const bytes = await this.getHash(ref);
    return parseRm(bytes);
  }

  /**
   * the same as {@link putFile | `putFile`} but rendering an `RmPage` to `.rm`
   * bytes
   *
   * Only version 3 and 5 pages can be rendered; version 6 pages are read-only.
   */
  async putRm(
    fileName: string,
    page: RmPageV5,
  ): Promise<[RawEntry, Promise<void>]> {
    if (!fileName.endsWith(".rm")) {
      throw new Error(`fileName ${fileName} did not end with '.rm'`);
    } else {
      return await this.putFile(fileName, serializeRm(page));
    }
  }

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
    const { hash: newHash, generation: newGen } = updatedRootHash.parse(loaded);
    if (Number.isSafeInteger(newGen)) {
      return [newHash, newGen];
    } else {
      throw new Error(
        `new generation ${newGen} was not a safe integer; please file a bug report`,
      );
    }
  }

  async #putFile(
    fileName: string,
    hash: string,
    bytes: Uint8Array,
  ): Promise<void> {
    // if the hash is already in the cache, writing is pointless
    if (!this.#cache.has(hash)) {
      const crc = CRC32C.buf(bytes, 0);
      const buff = new ArrayBuffer(4);
      new DataView(buff).setInt32(0, crc, false);
      const crcHash = uint8ArrayToBase64(new Uint8Array(buff));
      await this.#authedFetch("PUT", `${this.#rawHost}/sync/v3/files/${hash}`, {
        body: bytes,
        headers: {
          "rm-filename": fileName,
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
   * @param fileName - the file name to upload (e.g. `<id>.pdf`)
   * @param bytes - the bytes to upload
   * @returns the new entry and a promise to finish the upload
   */
  async putFile(
    fileName: string,
    bytes: Uint8Array,
  ): Promise<[RawEntry, Promise<void>]> {
    const hash = await digest(bytes);
    const res: RawEntry = {
      id: fileName,
      hash,
      type: 0,
      subfiles: 0,
      size: bytes.length,
    };
    return [res, this.#putFile(fileName, hash, bytes)];
  }

  /** the same as {@link putFile | `putFile`} but with caching for text */
  async putText(
    fileName: string,
    text: string,
  ): Promise<[RawEntry, Promise<void>]> {
    const enc = new TextEncoder();
    const bytes = enc.encode(text);
    const [ent, upload] = await this.putFile(fileName, bytes);
    return [
      ent,
      upload.then(() => {
        // on success, write to cache
        this.#cache.set(ent.hash, text);
      }),
    ];
  }

  /** the same as {@link putText | `putText`} but with extra validation for Content */
  async putContent(
    fileName: string,
    content: Content,
  ): Promise<[RawEntry, Promise<void>]> {
    if (!fileName.endsWith(".content")) {
      throw new Error(`fileName ${fileName} did not end with '.content'`);
    } else {
      return await this.putText(fileName, JSON.stringify(content));
    }
  }

  /** the same as {@link putText | `putText`} but with extra validation for Metadata */
  async putMetadata(
    fileName: string,
    metadata: Metadata,
  ): Promise<[RawEntry, Promise<void>]> {
    if (!fileName.endsWith(".metadata")) {
      throw new Error(`fileName ${fileName} did not end with '.metadata'`);
    } else {
      return await this.putText(fileName, JSON.stringify(metadata));
    }
  }

  /**
   * put a set of entries to make an entry list file
   *
   * To fully upload an item:
   * 1. upload all the constituent files and metadata
   * 2. call this with all of the entries
   * 3. append this entry to the root entry and call this again to update this root list
   * 4. put the new root hash
   *
   * NOTE: reMarkable currently rejects newly written schema 3 root indexes
   * with a 400 "Software must be updated" error, even for accounts that still
   * report schema 3, so the root list should always be written as schema 4. A
   * warning is logged if a schema 3 root index is written.
   *
   * @param id - the id of the list to upload - this should be the item id if
   *   uploading an item list, or "root" if uploading a new root list. Note the
   *   asymmetry with {@link getEntries | `getEntries`}: `getEntries` takes the
   *   full `"<id>.docSchema"` file name, whereas `putEntries` takes the bare id
   *   and appends `.docSchema` (and special-cases `"root"`) itself.
   * @param entries - the entries to upload
   *
   * @returns the new list entry and a promise to finish the upload
   */
  async putEntries(
    id: string,
    entries: readonly RawEntry[],
    schemaVersion: SchemaVersion,
  ): Promise<[RawEntry, Promise<void>]> {
    if (id === "root" && schemaVersion === 3) {
      console.warn(
        'writing a schema 3 root index, which reMarkable rejects with a 400 "Software must be updated" error; write the root index with schema version 4 instead',
      );
    }
    // NOTE v3 collections have a special hash function, the hash of their
    // contents, so this needs to be different
    const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
    const size = sorted.reduce((acc, ent) => acc + ent.size, 0);

    const records = [`${schemaVersion}\n`];
    if (schemaVersion === 4) {
      const name = id === "root" ? "." : id;
      records.push(`0:${name}:${sorted.length}:${size}\n`);
    }
    for (const { hash, type, id, subfiles, size } of sorted) {
      const lineType = schemaVersion === 4 ? 0 : type;
      records.push(`${hash}:${lineType}:${id}:${subfiles}:${size}\n`);
    }
    const enc = new TextEncoder();
    const entryBuff = enc.encode(records.join(""));

    let hash: string;
    if (schemaVersion === 3) {
      // in schema version 3 an entry's hash is the hash of the concatenated hashes
      const hashBuffs: Uint8Array[] = [];
      for (const { hash } of sorted) {
        hashBuffs.push(hexToUint8Array(hash));
      }
      hash = await digest(concatArrays(hashBuffs));
    } else if (schemaVersion === 4) {
      // in schema version 4 an entry's hash is the hash of the full entry file, same as everything else
      hash = await digest(entryBuff);
    } else {
      throw new Error(`unsupported schema version ${schemaVersion as number}`);
    }

    const res: RawEntry = {
      id,
      hash,
      type: schemaVersion > 3 ? 0 : 80000000,
      subfiles: sorted.length,
      size,
    };
    return [res, this.#putFile(`${id}.docSchema`, hash, entryBuff)];
  }

  /**
   * upload a file to the reMarkable cloud using the simple api
   *
   * This api is the same as used by the native reMarkable extension and works
   * even if the backend schema version is version 4. Setting mime to "folder"
   * allows folder creation.
   *
   * @param visibleName - the name of the file as it should appear on the reMarkable
   * @param bytes - the bytes of the file to upload
   * @param mime - the mime type of the file to upload

   * @returns a simple entry with the id and hash of the uploaded file
   */
  async uploadFile(
    visibleName: string,
    bytes: Uint8Array,
    mime: UploadMimeType,
  ): Promise<ItemRef> {
    const enc = new TextEncoder();
    const meta = uint8ArrayToBase64(
      enc.encode(JSON.stringify({ file_name: visibleName })),
    );
    const resp = await this.#authedFetch(
      "POST",
      `${this.#uploadHost}/doc/v2/files`,
      {
        body: bytes,
        headers: {
          "Content-Type": mime,
          "rm-meta": meta,
          "rm-source": "RoR-Browser",
        },
      },
    );
    const loaded = (await resp.json()) as unknown;
    const { docID, hash } = nativeItemRef.parse(loaded);
    return { id: docID, hash };
  }

  /**
   * dump the current cache to a string to preserve between session
   *
   * @returns a serialized version of the cache to pass to a new api instance
   */
  dumpCache(): string {
    return JSON.stringify(Object.fromEntries(this.#cache));
  }

  /** completely clear the cache */
  clearCache(): void {
    this.#cache.clear();
  }
}

export type { RawRemarkable as RawRemarkableApi };
