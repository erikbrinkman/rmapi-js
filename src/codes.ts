/**
 * The pen and color codes a stroke carries, shared by every `.rm` version.
 *
 * A stroke stores its pen and its color as small integers. Both sets grew with
 * the firmware, so a code from a newer device can name the same pen or color
 * as an older one. Reading a page keeps any pen or color code, since new
 * firmware keeps adding both.
 *
 * @packageDocumentation
 */

/** a pen/tool name for a stroke */
export type RmBrush =
  | "brush"
  | "pencil"
  | "ballpoint"
  | "marker"
  | "fineliner"
  | "highlighter"
  | "eraser"
  | "mechanicalPencil"
  | "eraseArea"
  | "calligraphy"
  | "shader";

/** a pen code that appears in a file */
export type RmBrushCode = number;

/**
 * the reMarkable pens, by code
 *
 * The codes come in two firmware families, so two codes can name the same pen.
 * Codes from newer firmware have no name.
 */
export const rmBrushes: Readonly<Partial<Record<RmBrushCode, RmBrush>>> = {
  0: "brush",
  12: "brush",
  1: "pencil",
  14: "pencil",
  2: "ballpoint",
  15: "ballpoint",
  3: "marker",
  16: "marker",
  4: "fineliner",
  17: "fineliner",
  5: "highlighter",
  18: "highlighter",
  6: "eraser",
  7: "mechanicalPencil",
  13: "mechanicalPencil",
  8: "eraseArea",
  21: "calligraphy",
  23: "shader",
};

/** a color name for a stroke */
export type RmColor =
  | "black"
  | "gray"
  | "white"
  | "yellow"
  | "green"
  | "pink"
  | "blue"
  | "red"
  | "grayOverlap"
  | "highlight"
  | "cyan"
  | "magenta";

/** a color code that appears in a file */
export type RmColorCode = number;

/**
 * the reMarkable palette, by code
 *
 * The palette grew when colored annotations arrived and again for the Paper
 * Pro, so two codes can name the same color. `"highlight"` is a marker rather
 * than a color — the stroke's real color is its `colorRgba`. The shade a name
 * renders as depends on the device. Codes from newer firmware have no name.
 */
export const rmColors: Readonly<Partial<Record<RmColorCode, RmColor>>> = {
  0: "black",
  1: "gray",
  2: "white",
  3: "yellow",
  4: "green",
  5: "pink",
  6: "blue",
  7: "red",
  8: "grayOverlap",
  9: "highlight",
  10: "green",
  11: "cyan",
  12: "magenta",
  13: "yellow",
};
