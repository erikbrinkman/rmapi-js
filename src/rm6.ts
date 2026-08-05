/**
 * Parse (and re-serialize) reMarkable `.rm` version 6 "scene tree" files.
 *
 * Version 6 is a CRDT scene tree, not a flat struct: a header then a sequence
 * of length-prefixed, tagged blocks. This module reads every block faithfully
 * — preserving `CrdtId`s, `LwwValue` wrappers, and each block's unread tail —
 * into an {@link RmScene | `RmScene`}, whose methods resolve the CRDT into
 * ordered layers, strokes, and text. Because nothing is dropped, the blocks
 * round-trip back to bytes.
 *
 * @packageDocumentation
 */

/**
 * a CRDT identifier: an `(authorId, counter)` pair, unique across replicas
 *
 * The wire encodes it positionally — a single author byte then a varuint
 * counter — with no field names; the `rmscene` reference calls these `part1`
 * and `part2`.
 */
export interface CrdtId {
  /** the author (device/replica) that minted this id, the leading wire byte */
  authorId: number;
  /** the author's monotonic counter (a varuint, may exceed 32 bits) */
  counter: number;
}

/** the scene-tree root node id */
export const ROOT_ID: CrdtId = { authorId: 0, counter: 1 };
/** the CRDT sequence end marker / unset id */
export const END_MARKER: CrdtId = { authorId: 0, counter: 0 };

/** a stable string key for a {@link CrdtId | `CrdtId`} */
export function crdtKey(id: CrdtId): string {
  return `${id.authorId}:${id.counter}`;
}

/** a last-writer-wins value, a `value` stamped with a `timestamp` id */
export interface LwwValue<T> {
  /** the id of the writer that last set this value */
  timestamp: CrdtId;
  /** the stored value */
  value: T;
}

/** a single sampled point of a version 6 stroke, in native (v2) units */
export interface RmV6Point {
  /** horizontal position in device pixels (centered origin, may be negative) */
  x: number;
  /** vertical position in device pixels (centered origin) */
  y: number;
  /** pen speed */
  speed: number;
  /** stroke width */
  width: number;
  /** pen direction, 0–255 mapping onto 0–2π */
  direction: number;
  /** pen pressure, 0–255 */
  pressure: number;
}

/** a version 6 stroke */
export interface RmV6Line {
  /** the raw pen/tool code */
  tool: number;
  /** the raw color code */
  color: number;
  /** the stroke thickness scale */
  thicknessScale: number;
  /** the length at which the stroke starts */
  startingLength: number;
  /** the sampled points */
  points: RmV6Point[];
  /**
   * a packed little-endian uint32 color, only present for highlighter strokes
   *
   * Logical channels are RGBA, stored in BGRA byte order (the integer is
   * `0xAARRGGBB`): `r = (v >> 16) & 0xff`, `g = (v >> 8) & 0xff`, `b = v &
   * 0xff`, `a = (v >> 24) & 0xff`. Kept as the raw packed value.
   */
  colorRgba?: number;
}

/** an axis-aligned rectangle */
export interface Rectangle {
  /** the left edge */
  x: number;
  /** the top edge */
  y: number;
  /** the width */
  w: number;
  /** the height */
  h: number;
}

/** a highlighted run of underlying text */
export interface GlyphRange {
  /** the start offset into the underlying text, if present */
  start?: number;
  /** the length of the range */
  length: number;
  /** the raw color code */
  color: number;
  /** the highlighted text */
  text: string;
  /** the bounding rectangles of the highlight */
  rectangles: Rectangle[];
  /** a packed little-endian uint32 color (RGBA channels, BGRA byte order), if present */
  colorRgba?: number;
}

/** the CRDT-sequence envelope shared by every scene item */
export interface SceneItem<V> {
  /** this item's own id */
  itemId: CrdtId;
  /** the id of the left sibling in the CRDT sequence */
  leftId: CrdtId;
  /** the id of the right sibling */
  rightId: CrdtId;
  /** how many following items this deletes */
  deletedLength: number;
  /** the item's value, or `undefined` if it carries none (e.g. a tombstone) */
  value: V | undefined;
}

/** a text run or an inline format code within {@link RmV6Text | `RmV6Text`} */
export type RmV6TextValue = string | number;

/** the parsed document text of a page (from the root text block) */
export interface RmV6Text {
  /** the text runs / inline formats as a CRDT sequence of items */
  items: SceneItem<RmV6TextValue>[];
  /** paragraph styles keyed by the char id they attach to */
  styles: Map<string, LwwValue<number>>;
  /** the text block's horizontal position */
  posX: number;
  /** the text block's vertical position */
  posY: number;
  /** the text block's width */
  width: number;
}

/** fields carried by every block */
interface BlockCommon {
  /** the block's minimum reader version */
  minVersion: number;
  /** the block's current version (selects the point encoding for lines) */
  currentVersion: number;
  /** the unread tail of the block, preserved for round-tripping */
  extraData: Uint8Array;
}

/** the `0x00` migration info block */
export interface MigrationInfoBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "migrationInfo";
  /** the migration's crdt id */
  migrationId: CrdtId;
  /** whether the migration ran on the device */
  isDevice: boolean;
}

/** the `0x01` scene tree block — a node/parent edge */
export interface SceneTreeBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "sceneTree";
  /** the tree entry's crdt id */
  treeId: CrdtId;
  /** the node this entry describes */
  nodeId: CrdtId;
  /** whether this is an update to an existing entry */
  isUpdate: boolean;
  /** the parent node's crdt id */
  parentId: CrdtId;
}

/** the `0x02` tree node block — a group's metadata (layer name/visibility) */
export interface TreeNodeBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "treeNode";
  /** the node's crdt id */
  nodeId: CrdtId;
  /** the layer name */
  label: LwwValue<string>;
  /** whether the layer is visible */
  visible: LwwValue<boolean>;
  /** the anchor node's crdt id, if anchored */
  anchorId?: LwwValue<CrdtId>;
  /** the anchor type, if anchored */
  anchorType?: LwwValue<number>;
  /** the anchor threshold, if anchored */
  anchorThreshold?: LwwValue<number>;
  /** the anchor's horizontal origin, if anchored */
  anchorOriginX?: LwwValue<number>;
}

/** the `0x05` scene line item block — a stroke */
export interface SceneLineItemBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "sceneLineItem";
  /** the parent group's crdt id */
  parentId: CrdtId;
  /** the stroke, in its crdt-sequence envelope */
  item: SceneItem<RmV6Line>;
}

/** the `0x03` scene glyph item block — a text highlight */
export interface SceneGlyphItemBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "sceneGlyphItem";
  /** the parent group's crdt id */
  parentId: CrdtId;
  /** the highlight, in its crdt-sequence envelope */
  item: SceneItem<GlyphRange>;
}

/** the `0x04` scene group item block — attaches a child node to a parent */
export interface SceneGroupItemBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "sceneGroupItem";
  /** the parent group's crdt id */
  parentId: CrdtId;
  /** the child node's crdt id, in its crdt-sequence envelope */
  item: SceneItem<CrdtId>;
}

/** the `0x06` scene text item block — carries no parsed value */
export interface SceneTextItemBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "sceneTextItem";
  /** the parent group's crdt id */
  parentId: CrdtId;
  /** the (unparsed) item, in its crdt-sequence envelope */
  item: SceneItem<undefined>;
}

/** the `0x08` scene tombstone item block — a deleted-item marker */
export interface SceneTombstoneItemBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "sceneTombstone";
  /** the parent group's crdt id */
  parentId: CrdtId;
  /** the deleted item's envelope (no value) */
  item: SceneItem<undefined>;
}

/** the `0x07` root text block — the page's document text */
export interface RootTextBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "rootText";
  /** the text block's crdt id */
  blockId: CrdtId;
  /** the parsed document text */
  text: RmV6Text;
}

/** the `0x0a` page info block */
export interface PageInfoBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "pageInfo";
  /** how many times the page has been loaded */
  loadsCount: number;
  /** how many times the page has been merged */
  mergesCount: number;
  /** the number of text characters on the page */
  textCharsCount: number;
  /** the number of text lines on the page */
  textLinesCount: number;
  /** the type-folio use count */
  typeFolioUseCount: number;
}

/** the `0x09` author ids block — the author-id to uuid table */
export interface AuthorIdsBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "authorIds";
  /** the author-id to uuid table */
  authors: Map<number, string>;
}

/** the `0x0d` scene info block */
export interface SceneInfoBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "sceneInfo";
  /** the currently-selected layer's crdt id */
  currentLayer: LwwValue<CrdtId>;
  /** whether the background is visible */
  backgroundVisible?: LwwValue<boolean>;
  /** whether the underlying document is visible */
  rootDocumentVisible?: LwwValue<boolean>;
  /** the page size in device pixels, if present */
  paperSize?: [number, number];
}

/** a block whose type we don't parse, kept verbatim for round-tripping */
export interface UnknownBlock extends BlockCommon {
  /** the block-type discriminant */
  type: "unknown";
  /** the raw numeric block type */
  blockType: number;
  /** the raw block body bytes */
  data: Uint8Array;
}

/** any parsed version 6 block */
export type RmBlock =
  | MigrationInfoBlock
  | SceneTreeBlock
  | TreeNodeBlock
  | SceneLineItemBlock
  | SceneGlyphItemBlock
  | SceneGroupItemBlock
  | SceneTextItemBlock
  | SceneTombstoneItemBlock
  | RootTextBlock
  | PageInfoBlock
  | AuthorIdsBlock
  | SceneInfoBlock
  | UnknownBlock;

const HEADER_LENGTH = 43;
const V6_HEADER = "reMarkable .lines file, version=6";

const TAG_BYTE1 = 0x1;
const TAG_BYTE4 = 0x4;
const TAG_BYTE8 = 0x8;
const TAG_LENGTH4 = 0xc;
const TAG_ID = 0xf;

/** a cursor over the tagged block stream, tracking block/subblock boundaries */
class Reader {
  #view: DataView;
  #offset: number;
  #dataEnd: number;
  /** stack of subblock/block end offsets; the innermost bound is the last */
  #bounds: number[] = [];

  constructor(data: Uint8Array, offset: number) {
    this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.#offset = offset;
    this.#dataEnd = data.byteLength;
  }

  get offset(): number {
    return this.#offset;
  }

  get atFileEnd(): boolean {
    return this.#offset >= this.#dataEnd;
  }

  #boundary(): number {
    return this.#bounds.length > 0
      ? this.#bounds[this.#bounds.length - 1]!
      : this.#dataEnd;
  }

  bytesRemaining(): number {
    return this.#boundary() - this.#offset;
  }

  u8(): number {
    const value = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }

  u16(): number {
    const value = this.#view.getUint16(this.#offset, true);
    this.#offset += 2;
    return value;
  }

  u32(): number {
    const value = this.#view.getUint32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  f32(): number {
    const value = this.#view.getFloat32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  f64(): number {
    const value = this.#view.getFloat64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  varuint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.u8();
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  }

  crdtId(): CrdtId {
    return { authorId: this.u8(), counter: this.varuint() };
  }

  bytes(length: number): Uint8Array {
    const start = this.#view.byteOffset + this.#offset;
    const slice = new Uint8Array(this.#view.buffer, start, length);
    this.#offset += length;
    return slice.slice();
  }

  /** peek the next tag as `[index, type]` without consuming it */
  peekTag(): [number, number] | undefined {
    if (this.#offset >= this.#boundary()) return undefined;
    const save = this.#offset;
    const raw = this.varuint();
    this.#offset = save;
    return [Math.floor(raw / 16), raw % 16];
  }

  hasTag(index: number, type: number): boolean {
    const tag = this.peekTag();
    return tag !== undefined && tag[0] === index && tag[1] === type;
  }

  #expectTag(index: number, type: number): void {
    const raw = this.varuint();
    if (Math.floor(raw / 16) !== index || raw % 16 !== type) {
      throw new Error(`unexpected v6 tag ${raw} (wanted ${index}/${type})`);
    }
  }

  readInt(index: number): number {
    this.#expectTag(index, TAG_BYTE4);
    return this.u32();
  }

  readFloat(index: number): number {
    this.#expectTag(index, TAG_BYTE4);
    return this.f32();
  }

  readDouble(index: number): number {
    this.#expectTag(index, TAG_BYTE8);
    return this.f64();
  }

  readId(index: number): CrdtId {
    this.#expectTag(index, TAG_ID);
    return this.crdtId();
  }

  readBool(index: number): boolean {
    this.#expectTag(index, TAG_BYTE1);
    return this.u8() !== 0;
  }

  readByte(index: number): number {
    this.#expectTag(index, TAG_BYTE1);
    return this.u8();
  }

  /** enter a Length4 subblock, run `fn`, then seek to the subblock end */
  subblock<T>(index: number, fn: () => T): T {
    this.#expectTag(index, TAG_LENGTH4);
    const length = this.u32();
    const subEnd = this.#offset + length;
    this.#bounds.push(subEnd);
    try {
      return fn();
    } finally {
      this.#bounds.pop();
      this.#offset = subEnd;
    }
  }

  seek(offset: number): void {
    this.#offset = offset;
  }

  /** run `fn` bounded by `end`, returning the unread tail as extra data */
  bounded<T>(end: number, fn: () => T): [T, Uint8Array] {
    this.#bounds.push(end);
    try {
      const value = fn();
      if (this.#offset > end) {
        throw new Error("block body overran its declared length");
      }
      return [value, this.bytes(end - this.#offset)];
    } finally {
      this.#bounds.pop();
      this.#offset = end;
    }
  }

  readLww<T>(index: number, readValue: () => T): LwwValue<T> {
    return this.subblock(index, () => {
      const timestamp = this.readId(1);
      const value = readValue();
      return { timestamp, value };
    });
  }

  /** a Length4 string subblock: varuint length, ascii flag, utf-8 bytes */
  readString(index: number): string {
    return this.subblock(index, () => {
      const length = this.varuint();
      this.u8(); // is-ascii flag
      return new TextDecoder().decode(this.bytes(length));
    });
  }

  /** a Length4 string-with-format: a string, or an int format code */
  readStringWithFormat(index: number): string | number {
    return this.subblock(index, () => {
      const length = this.varuint();
      this.u8(); // is-ascii flag
      const text = new TextDecoder().decode(this.bytes(length));
      if (this.hasTag(2, TAG_BYTE4)) {
        return this.readInt(2);
      } else {
        return text;
      }
    });
  }
}

/** read the `SceneItem` envelope shared by item blocks */
function readItemEnvelope<V>(
  reader: Reader,
  readValue: (itemType: number) => V | undefined,
): { parentId: CrdtId; item: SceneItem<V> } {
  const parentId = reader.readId(1);
  const itemId = reader.readId(2);
  const leftId = reader.readId(3);
  const rightId = reader.readId(4);
  const deletedLength = reader.readInt(5);
  let value: V | undefined;
  if (reader.hasTag(6, TAG_LENGTH4)) {
    value = reader.subblock(6, () => {
      const itemType = reader.u8();
      return readValue(itemType);
    });
  }
  return { parentId, item: { itemId, leftId, rightId, deletedLength, value } };
}

function readLineValue(reader: Reader, version: number): RmV6Line {
  const tool = reader.readInt(1);
  const color = reader.readInt(2);
  const thicknessScale = reader.readDouble(3);
  const startingLength = reader.readFloat(4);
  const points = reader.subblock(5, () => {
    const pointSize = version === 1 ? 24 : 14;
    const total = reader.bytesRemaining();
    const count = Math.floor(total / pointSize);
    const list: RmV6Point[] = new Array(count);
    for (let index = 0; index < count; index++) {
      const x = reader.f32();
      const y = reader.f32();
      if (version === 1) {
        list[index] = {
          x,
          y,
          speed: reader.f32() * 4,
          direction: (reader.f32() * 255) / (2 * Math.PI),
          width: Math.round(reader.f32() * 4),
          pressure: reader.f32() * 255,
        };
      } else {
        const speed = reader.u16();
        const width = reader.u16();
        const direction = reader.u8();
        const pressure = reader.u8();
        list[index] = { x, y, speed, width, direction, pressure };
      }
    }
    return list;
  });
  const line: RmV6Line = {
    tool,
    color,
    thicknessScale,
    startingLength,
    points,
  };
  // optional trailing timestamp / move id / color are skipped by seeking to the
  // subblock end; only the highlighter rgba color is captured
  if (reader.hasTag(6, TAG_ID)) reader.readId(6);
  if (reader.hasTag(7, TAG_ID)) reader.readId(7);
  if (reader.hasTag(8, TAG_BYTE4)) line.colorRgba = reader.readInt(8);
  return line;
}

function readGlyphValue(reader: Reader): GlyphRange {
  const start = reader.hasTag(2, TAG_BYTE4) ? reader.readInt(2) : undefined;
  const explicitLength = reader.hasTag(3, TAG_BYTE4)
    ? reader.readInt(3)
    : undefined;
  const color = reader.readInt(4);
  const text = reader.readString(5);
  const rectangles = reader.subblock(6, () => {
    const count = reader.varuint();
    const rects: Rectangle[] = new Array(count);
    for (let index = 0; index < count; index++) {
      rects[index] = {
        x: reader.f64(),
        y: reader.f64(),
        w: reader.f64(),
        h: reader.f64(),
      };
    }
    return rects;
  });
  const glyph: GlyphRange = {
    length: explicitLength ?? text.length,
    color,
    text,
    rectangles,
  };
  if (start !== undefined) glyph.start = start;
  if (reader.hasTag(10, TAG_BYTE4)) glyph.colorRgba = reader.readInt(10);
  return glyph;
}

function readText(reader: Reader): RmV6Text {
  const items: SceneItem<RmV6TextValue>[] = [];
  const styles = new Map<string, LwwValue<number>>();
  reader.subblock(2, () => {
    reader.subblock(1, () => {
      reader.subblock(1, () => {
        const count = reader.varuint();
        for (let index = 0; index < count; index++) {
          items.push(
            reader.subblock(0, () => {
              const itemId = reader.readId(2);
              const leftId = reader.readId(3);
              const rightId = reader.readId(4);
              const deletedLength = reader.readInt(5);
              const value = reader.hasTag(6, TAG_LENGTH4)
                ? reader.readStringWithFormat(6)
                : "";
              return { itemId, leftId, rightId, deletedLength, value };
            }),
          );
        }
      });
    });
    reader.subblock(2, () => {
      reader.subblock(1, () => {
        const count = reader.varuint();
        for (let index = 0; index < count; index++) {
          const charId = reader.crdtId();
          const timestamp = reader.readId(1);
          const style = reader.subblock(2, () => {
            reader.u8(); // constant 17
            return reader.u8();
          });
          styles.set(crdtKey(charId), { timestamp, value: style });
        }
      });
    });
  });
  const [posX, posY] = reader.subblock(3, () => [reader.f64(), reader.f64()]);
  const width = reader.readFloat(4);
  return { items, styles, posX, posY, width };
}

/** `Omit` that distributes across a union instead of collapsing to shared keys */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** read the body of a block of a given type (bounds already set to block end) */
function readBlockBody(
  reader: Reader,
  blockType: number,
  version: number,
): DistributiveOmit<RmBlock, keyof BlockCommon> {
  switch (blockType) {
    case 0x00:
      return {
        type: "migrationInfo",
        migrationId: reader.readId(1),
        isDevice: reader.readBool(2),
      };
    case 0x01:
      return {
        type: "sceneTree",
        treeId: reader.readId(1),
        nodeId: reader.readId(2),
        isUpdate: reader.readBool(3),
        parentId: reader.subblock(4, () => reader.readId(1)),
      };
    case 0x02: {
      const nodeId = reader.readId(1);
      const label = reader.readLww(2, () => reader.readString(2));
      const visible = reader.readLww(3, () => reader.readBool(2));
      const node: Omit<TreeNodeBlock, keyof BlockCommon> = {
        type: "treeNode",
        nodeId,
        label,
        visible,
      };
      if (reader.bytesRemaining() > 0 && reader.hasTag(7, TAG_LENGTH4)) {
        node.anchorId = reader.readLww(7, () => reader.readId(2));
        node.anchorType = reader.readLww(8, () => reader.readByte(2));
        node.anchorThreshold = reader.readLww(9, () => reader.readFloat(2));
        node.anchorOriginX = reader.readLww(10, () => reader.readFloat(2));
      }
      return node;
    }
    case 0x03:
      return {
        type: "sceneGlyphItem",
        ...readItemEnvelope(reader, (itemType) =>
          itemType === 0x01 ? readGlyphValue(reader) : undefined,
        ),
      };
    case 0x04:
      return {
        type: "sceneGroupItem",
        ...readItemEnvelope(reader, (itemType) =>
          itemType === 0x02 ? reader.readId(2) : undefined,
        ),
      };
    case 0x05:
      return {
        type: "sceneLineItem",
        ...readItemEnvelope(reader, (itemType) =>
          itemType === 0x03 ? readLineValue(reader, version) : undefined,
        ),
      };
    case 0x06:
      return {
        type: "sceneTextItem",
        ...readItemEnvelope<undefined>(reader, () => undefined),
      };
    case 0x07: {
      const blockId = reader.readId(1);
      return { type: "rootText", blockId, text: readText(reader) };
    }
    case 0x08:
      return {
        type: "sceneTombstone",
        ...readItemEnvelope<undefined>(reader, () => undefined),
      };
    case 0x09: {
      const authors = new Map<number, string>();
      const count = reader.varuint();
      for (let index = 0; index < count; index++) {
        reader.subblock(0, () => {
          const uuidLength = reader.varuint();
          const uuid = reader.bytes(uuidLength);
          const authorId = reader.u16();
          authors.set(authorId, uuidToString(uuid));
        });
      }
      return { type: "authorIds", authors };
    }
    case 0x0a:
      return {
        type: "pageInfo",
        loadsCount: reader.readInt(1),
        mergesCount: reader.readInt(2),
        textCharsCount: reader.readInt(3),
        textLinesCount: reader.readInt(4),
        typeFolioUseCount: reader.hasTag(5, TAG_BYTE4) ? reader.readInt(5) : 0,
      };
    case 0x0d: {
      const info: Omit<SceneInfoBlock, keyof BlockCommon> = {
        type: "sceneInfo",
        currentLayer: reader.readLww(1, () => reader.readId(2)),
      };
      if (reader.hasTag(2, TAG_LENGTH4)) {
        info.backgroundVisible = reader.readLww(2, () => reader.readBool(2));
      }
      if (reader.hasTag(3, TAG_LENGTH4)) {
        info.rootDocumentVisible = reader.readLww(3, () => reader.readBool(2));
      }
      if (reader.hasTag(5, TAG_LENGTH4)) {
        info.paperSize = reader.subblock(5, () => [reader.u32(), reader.u32()]);
      }
      return info;
    }
    default:
      throw new Error(`unknown v6 block type 0x${blockType.toString(16)}`);
  }
}

function uuidToString(bytes: Uint8Array): string {
  // the uuid is stored little-endian (bytes_le); reverse the standard fields
  const b = [...bytes];
  const le = [
    b[3],
    b[2],
    b[1],
    b[0],
    b[5],
    b[4],
    b[7],
    b[6],
    b[8],
    b[9],
    b[10],
    b[11],
    b[12],
    b[13],
    b[14],
    b[15],
  ];
  const hex = le.map((byte) => (byte ?? 0).toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/** parse the raw block list of a version 6 `.rm` file */
function parseV6Blocks(data: Uint8Array): RmBlock[] {
  const header = new TextDecoder().decode(data.subarray(0, HEADER_LENGTH));
  if (!header.startsWith(V6_HEADER)) {
    throw new Error(`not a version 6 .lines file: ${JSON.stringify(header)}`);
  }
  const reader = new Reader(data, HEADER_LENGTH);
  const blocks: RmBlock[] = [];
  while (!reader.atFileEnd) {
    if (reader.bytesRemaining() < 8) break;
    const length = reader.u32();
    reader.u8(); // unknown, always 0
    const minVersion = reader.u8();
    const currentVersion = reader.u8();
    const blockType = reader.u8();
    const blockStart = reader.offset;
    const blockEnd = blockStart + length;
    let block: RmBlock;
    try {
      const [body, extraData] = reader.bounded(blockEnd, () =>
        readBlockBody(reader, blockType, currentVersion),
      );
      block = { ...body, minVersion, currentVersion, extraData } as RmBlock;
    } catch {
      // couldn't parse this block; keep its raw bytes so the file still
      // round-trips and later blocks still parse
      reader.seek(blockStart);
      block = {
        type: "unknown",
        blockType,
        data: reader.bytes(length),
        minVersion,
        currentVersion,
        extraData: new Uint8Array(),
      };
    }
    reader.seek(blockEnd);
    blocks.push(block);
  }
  return blocks;
}

/** a resolved item within a layer, in CRDT order */
export type RmSceneItem =
  | {
      /** the item discriminant */
      kind: "layer";
      /** a nested layer (scene-tree group) */
      layer: RmSceneLayer;
    }
  | {
      /** the item discriminant */
      kind: "line";
      /** a stroke */
      line: RmV6Line;
    }
  | {
      /** the item discriminant */
      kind: "glyph";
      /** a text highlight */
      glyph: GlyphRange;
    };

/** a resolved drawing layer (a scene-tree group) */
export interface RmSceneLayer {
  /** the group's crdt id */
  id: CrdtId;
  /** the layer name, if set */
  label?: string;
  /** whether the layer is visible, if set */
  visible?: boolean;
  /** the layer's items (nested layers, strokes, glyphs) in CRDT order */
  items: RmSceneItem[];
}

type ChildValue =
  | { kind: "group"; id: CrdtId }
  | { kind: "line"; line: RmV6Line }
  | { kind: "glyph"; glyph: GlyphRange };

/** a group child: the CRDT envelope with a resolved (always-present) value */
interface Child {
  itemId: CrdtId;
  leftId: CrdtId;
  rightId: CrdtId;
  deletedLength: number;
  value: ChildValue;
}

/** a group node while assembling the scene tree */
interface GroupNode {
  id: CrdtId;
  parentId: CrdtId;
  label?: string;
  visible?: boolean;
  children: Child[];
}

function compareRank(a: [number, number], b: [number, number]): number {
  const [a0, a1] = a;
  const [b0, b1] = b;
  return a0 - b0 || a1 - b1;
}

/**
 * order a group's children by the CRDT left/right sequence
 *
 * Topological sort over `left -> item -> right` edges (unset/unknown links map
 * to synthetic start/end bounds), breaking ties between concurrent inserts by
 * higher author id then lower counter, matching reMarkable's ordering.
 */
function toposort(items: readonly Child[]): Child[] {
  if (items.length <= 1) return [...items];
  const START = "\x00start";
  const END = "\x00end";
  const present = new Set(items.map((item) => crdtKey(item.itemId)));
  const succ = new Map<string, string[]>([
    [START, []],
    [END, []],
  ]);
  const indeg = new Map<string, number>([
    [START, 0],
    [END, 0],
  ]);
  for (const item of items) {
    succ.set(crdtKey(item.itemId), []);
    indeg.set(crdtKey(item.itemId), 0);
  }
  const resolve = (id: CrdtId, fallback: string): string => {
    const key = crdtKey(id);
    return key === crdtKey(END_MARKER) || !present.has(key) ? fallback : key;
  };
  const edge = (from: string, to: string): void => {
    succ.get(from)!.push(to);
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
  };
  for (const item of items) {
    edge(resolve(item.leftId, START), crdtKey(item.itemId));
    edge(crdtKey(item.itemId), resolve(item.rightId, END));
  }
  const byKey = new Map(items.map((item) => [crdtKey(item.itemId), item]));
  const rank = (key: string): [number, number] => {
    if (key === START) return [-Infinity, -Infinity];
    if (key === END) return [Infinity, Infinity];
    const item = byKey.get(key)!;
    return [-item.itemId.authorId, item.itemId.counter];
  };
  const ready = new Set<string>();
  for (const [node, degree] of indeg) {
    if (degree === 0) ready.add(node);
  }
  const order: Child[] = [];
  const placed = new Set<string>();
  while (ready.size > 0) {
    let best: string | undefined;
    for (const key of ready) {
      if (best === undefined || compareRank(rank(key), rank(best)) < 0) {
        best = key;
      }
    }
    ready.delete(best!);
    placed.add(best!);
    const item = byKey.get(best!);
    if (item) order.push(item);
    for (const next of succ.get(best!) ?? []) {
      indeg.set(next, indeg.get(next)! - 1);
      if (indeg.get(next) === 0) ready.add(next);
    }
  }
  // if a cycle prevented full placement, append the rest in file order
  if (order.length < items.length) {
    for (const item of items) {
      if (!placed.has(crdtKey(item.itemId))) order.push(item);
    }
  }
  return order;
}

/**
 * a parsed version 6 scene
 *
 * The raw {@link RmBlock | `blocks`} are the faithful source of truth (they
 * preserve the CRDT ids and re-serialize); the methods resolve them into
 * ordered layers, strokes, and text.
 */
export class RmScene {
  /** the discriminant for the {@link RmPage} union */
  readonly version = 6 as const;
  /** every parsed block, in file order */
  readonly blocks: readonly RmBlock[];
  /** the author-id to uuid table */
  readonly authors: Map<number, string>;
  /** the page size, if the scene info block carried one */
  readonly paperSize?: [number, number];
  readonly #nodes = new Map<string, GroupNode>();
  readonly #text?: RmV6Text;

  constructor(blocks: readonly RmBlock[]) {
    this.blocks = blocks;
    this.authors = new Map();
    const node = (id: CrdtId): GroupNode => {
      let group = this.#nodes.get(crdtKey(id));
      if (group === undefined) {
        group = { id, parentId: END_MARKER, children: [] };
        this.#nodes.set(crdtKey(id), group);
      }
      return group;
    };
    node(ROOT_ID);
    for (const block of blocks) {
      if (block.type === "sceneTree") {
        node(block.treeId).parentId = block.parentId;
      } else if (block.type === "treeNode") {
        const group = node(block.nodeId);
        group.label = block.label.value;
        group.visible = block.visible.value;
      } else if (block.type === "sceneGroupItem" && block.item.value) {
        node(block.parentId).children.push({
          ...block.item,
          value: { kind: "group", id: block.item.value },
        });
      } else if (block.type === "sceneLineItem" && block.item.value) {
        node(block.parentId).children.push({
          ...block.item,
          value: { kind: "line", line: block.item.value },
        });
      } else if (block.type === "sceneGlyphItem" && block.item.value) {
        node(block.parentId).children.push({
          ...block.item,
          value: { kind: "glyph", glyph: block.item.value },
        });
      } else if (block.type === "rootText") {
        this.#text = block.text;
      } else if (block.type === "authorIds") {
        for (const [authorId, uuid] of block.authors) {
          this.authors.set(authorId, uuid);
        }
      } else if (block.type === "sceneInfo" && block.paperSize) {
        this.paperSize = block.paperSize;
      }
    }
  }

  #resolveGroup(group: GroupNode): RmSceneLayer {
    const items: RmSceneItem[] = [];
    for (const child of toposort(group.children)) {
      if (child.value.kind === "group") {
        const nested = this.#nodes.get(crdtKey(child.value.id));
        if (nested)
          items.push({ kind: "layer", layer: this.#resolveGroup(nested) });
      } else if (child.value.kind === "line") {
        items.push({ kind: "line", line: child.value.line });
      } else {
        items.push({ kind: "glyph", glyph: child.value.glyph });
      }
    }
    const layer: RmSceneLayer = { id: group.id, items };
    if (group.label !== undefined) layer.label = group.label;
    if (group.visible !== undefined) layer.visible = group.visible;
    return layer;
  }

  /** the drawing layers, in order, each with its items */
  layers(): RmSceneLayer[] {
    const root = this.#nodes.get(crdtKey(ROOT_ID));
    if (root === undefined) return [];
    const out: RmSceneLayer[] = [];
    for (const child of toposort(root.children)) {
      if (child.value.kind === "group") {
        const group = this.#nodes.get(crdtKey(child.value.id));
        if (group) out.push(this.#resolveGroup(group));
      }
    }
    return out;
  }

  /** every stroke on the page, in draw order, flattened across layers */
  strokes(): RmV6Line[] {
    const out: RmV6Line[] = [];
    const walk = (layer: RmSceneLayer): void => {
      for (const item of layer.items) {
        if (item.kind === "line") out.push(item.line);
        else if (item.kind === "layer") walk(item.layer);
      }
    };
    for (const layer of this.layers()) walk(layer);
    return out;
  }

  /** the page's document text, if any */
  text(): RmV6Text | undefined {
    return this.#text;
  }
}

/** parse a version 6 `.rm` file into a resolvable scene */
export function parseRmScene(data: Uint8Array): RmScene {
  return new RmScene(parseV6Blocks(data));
}
