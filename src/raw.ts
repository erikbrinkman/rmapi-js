import CRC32C from "crc-32/crc32c";
import {
  boolean,
  type CompiledSchema,
  elements,
  empty,
  enumeration,
  float64,
  int32,
  nullable,
  properties,
  string,
  timestamp,
  uint8,
  uint32,
  values,
} from "jtd-ts";
import { ValidationError } from "./error.js";
import { concatArrays } from "./utils.js";
import "core-js/proposals/array-buffer-base64";

const hashReg = /^[0-9a-f]{64}$/;

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

/** an simple entry without any extra information */
export interface SimpleEntry {
  /** the document id */
  id: string;
  /** the document hash */
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
export interface RawEntry {
  /** 80000000 for schema 3 collection type or 0 for schema 4 or schema 3 files or */
  type: 80000000 | 0;
  /** the hash of the collection this points to */
  hash: string;
  /** the unique id of the collection */
  id: string;
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
// eslint-disable-next-line spellcheck/spell-checker
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
  /**
   * the center of the zoom for customFit zoom
   *
   * This is an absolute offset from the center of the page. Negative numbers
   * indicate shifted left and positive numbers indicate shifted right. The
   * units are relative to the document pixels, but it's not sure how the
   * document size is calculated.
   */
  customZoomCenterX?: number;
  /**
   * the center of the zoom for customFit documents
   *
   * This is an absolute number relative to the top of the page. Negative
   * numbers indicate shifted up, while positive numbers indicate shifted down.
   * The units are relative to the document pixels, but it's not sure how the
   * document size is calculated.
   */
  customZoomCenterY?: number;
  /** this seems unused */
  customZoomOrientation?: Orientation;
  /** this seems unused */
  customZoomPageHeight?: number;
  /** this seems unused */
  customZoomPageWidth?: number;
  /**
   * the scale for customFit documents
   *
   * 1 indicates no zoom, smaller numbers indicate zoomed out, larger numbers
   * indicate zoomed in. reMarkable generally allows setting this from 0.5 to 5,
   * but values outside that bound are still supported.
   */
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
const documentContent = properties(
  {
    coverPageNumber: int32(),
    documentMetadata,
    extraMetadata: values(string()),
    fileType: enumeration("epub", "notebook", "pdf"),
    fontName: string(),
    lineHeight: int32(),
    orientation: enumeration("portrait", "landscape"),
    pageCount: uint32(),
    sizeInBytes: string(),
    textAlignment: enumeration("", "justify", "left"),
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
    formatVersion: uint8(),
    keyboardMetadata: properties(
      {
        count: uint32(),
        timestamp: float64(),
      },
      undefined,
      true,
    ),
    lastOpenedPage: int32(),
    margins: uint32(),
    originalPageCount: int32(),
    pages: nullable(elements(string())),
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
  formatVersion?: number;
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

const templateContent = properties(
  {
    name: string(),
    author: string(),
    iconData: string(),
    categories: elements(string()),
    labels: elements(string()),
    orientation: enumeration("portrait", "landscape"),
    templateVersion: string(),
    supportedScreens: elements(enumeration("rm2", "rmPP")),
    constants: elements(values(int32())),
    items: elements(empty() as CompiledSchema<object, unknown>),
  },
  {
    formatVersion: uint8(),
  },
) satisfies CompiledSchema<TemplateContent, unknown>;

/** content metadata for any item */
export type Content = CollectionContent | DocumentContent | TemplateContent;

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
    lastOpenedPage: int32(),
    createdTime: string(),
    deleted: boolean(),
    metadatamodified: boolean(),
    modified: boolean(),
    synced: boolean(),
    version: uint8(),
  },
  true,
) satisfies CompiledSchema<Metadata, unknown>;

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

interface NativeSimpleEntry {
  docID: string;
  hash: string;
}

const NativeSimpleEntry = properties(
  {
    docID: string(),
    hash: string(),
  },
  undefined,
  true,
) satisfies CompiledSchema<NativeSimpleEntry, unknown>;

async function digest(buff: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    // NOTE this is type hinted wrong, but it does work correctly on a uint8 view
    buff as unknown as ArrayBuffer,
  );
  return new Uint8Array(digest).toHex();
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
  getRootHash(): Promise<[string, number, SchemaVersion]>;

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
  getEntries(hash: string): Promise<Entries>;

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
  putFile(id: string, bytes: Uint8Array): Promise<[RawEntry, Promise<void>]>;

  /** the same as {@link putFile | `putFile`} but with caching for text */
  putText(id: string, content: string): Promise<[RawEntry, Promise<void>]>;

  /** the same as {@link putText | `putText`} but with extra validation for Content */
  putContent(id: string, content: Content): Promise<[RawEntry, Promise<void>]>;

  /** the same as {@link putText | `putText`} but with extra validation for Metadata */
  putMetadata(
    id: string,
    metadata: Metadata,
  ): Promise<[RawEntry, Promise<void>]>;

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
   *
   * @returns the new list entry and a promise to finish the upload
   */
  putEntries(
    id: string,
    entries: RawEntry[],
    schemaVersion: SchemaVersion,
  ): Promise<[RawEntry, Promise<void>]>;

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
  uploadFile(
    visibleName: string,
    bytes: Uint8Array,
    mime: UploadMimeType,
  ): Promise<SimpleEntry>;

  /**
   * dump the current cache to a string to preserve between session
   *
   * @returns a serialized version of the cache to pass to a new api instance
   */
  dumpCache(): string;

  /** completely clear the cache */
  clearCache(): void;
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

export class RawRemarkable implements RawRemarkableApi {
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

  async getRootHash(): Promise<[string, number, SchemaVersion]> {
    const res = await this.#authedFetch("GET", `${this.#rawHost}/sync/v4/root`);
    const raw = await res.text();
    const loaded = JSON.parse(raw) as unknown;
    if (!rootHash.guardAssert(loaded)) throw Error("invalid root hash");
    const { hash, generation, schemaVersion } = loaded;
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

  async getEntries(hash: string): Promise<Entries> {
    const rawFile = await this.getText(hash);
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
      const crcHash = new Uint8Array(buff).toBase64();
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
  ): Promise<[RawEntry, Promise<void>]> {
    const hash = await digest(bytes);
    const res: RawEntry = {
      id,
      hash,
      type: 0,
      subfiles: 0,
      size: bytes.length,
    };
    return [res, this.#putFile(hash, id, bytes)];
  }

  async putText(id: string, text: string): Promise<[RawEntry, Promise<void>]> {
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
  ): Promise<[RawEntry, Promise<void>]> {
    if (!id.endsWith(".content")) {
      throw new Error(`id ${id} did not end with '.content'`);
    } else {
      return await this.putText(id, JSON.stringify(content));
    }
  }

  async putMetadata(
    id: string,
    metadata: Metadata,
  ): Promise<[RawEntry, Promise<void>]> {
    if (!id.endsWith(".metadata")) {
      throw new Error(`id ${id} did not end with '.metadata'`);
    } else {
      return await this.putText(id, JSON.stringify(metadata));
    }
  }

  async putEntries(
    id: string,
    entries: RawEntry[],
    schemaVersion: SchemaVersion,
  ): Promise<[RawEntry, Promise<void>]> {
    // NOTE v3 collections have a special hash function, the hash of their
    // contents, so this needs to be different
    entries.sort((a, b) => a.id.localeCompare(b.id));
    const size = entries.reduce((acc, ent) => acc + ent.size, 0);

    const records = [`${schemaVersion}\n`];
    if (schemaVersion === 4) {
      const name = id === "root" ? "." : id;
      records.push(`0:${name}:${entries.length}:${size}\n`);
    }
    for (const { hash, type, id, subfiles, size } of entries) {
      records.push(`${hash}:${type}:${id}:${subfiles}:${size}\n`);
    }
    const enc = new TextEncoder();
    const entryBuff = enc.encode(records.join(""));

    let hash: string;
    if (schemaVersion === 3) {
      // in schema version 3 an entry's hash is the hash of the concatenated hashes
      const hashBuffs: Uint8Array[] = [];
      for (const { hash } of entries) {
        hashBuffs.push(Uint8Array.fromHex(hash));
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
      subfiles: entries.length,
      size,
    };
    return [
      res,
      // NOTE when monitoring requests, this had the extension .docSchema appended, but I'm not entirely sure why
      this.#putFile(hash, `${id}.docSchema`, entryBuff),
    ];
  }

  async uploadFile(
    visibleName: string,
    bytes: Uint8Array,
    mime: UploadMimeType,
  ): Promise<SimpleEntry> {
    const enc = new TextEncoder();
    const meta = enc
      .encode(JSON.stringify({ file_name: visibleName }))
      .toBase64();
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
    if (!NativeSimpleEntry.guardAssert(loaded))
      throw Error("invalid upload response");
    const { docID, hash } = loaded;
    return { id: docID, hash };
  }

  dumpCache(): string {
    return JSON.stringify(Object.fromEntries(this.#cache));
  }

  clearCache(): void {
    this.#cache.clear();
  }
}
