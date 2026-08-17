/**
 * The pen and color codes a stroke carries, shared by every `.rm` version.
 *
 * A stroke stores its pen and its color as small integers. Both sets grew with
 * the firmware, so a code from a newer device can name the same pen or color
 * as an older one. Reading a page checks the codes against these lists.
 *
 * @packageDocumentation
 */

import { z } from "zod";

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
export type RmBrushCode =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 21
  | 23;

export const rmBrushCode: z.ZodType<RmBrushCode> = z.literal(
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 16, 17, 18, 21, 23],
  { error: "unknown pen code" },
);

/**
 * the reMarkable pens, by code
 *
 * The codes come in two firmware families, so two codes can name the same pen.
 */
export const rmBrushes: Readonly<Record<RmBrushCode, RmBrush>> = {
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
export type RmColorCode =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13;

export const rmColorCode: z.ZodType<RmColorCode> = z.literal(
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  { error: "unknown color code" },
);

/**
 * the reMarkable palette, by code
 *
 * The palette grew when colored annotations arrived and again for the Paper
 * Pro, so two codes can name the same color. `"highlight"` is a marker rather
 * than a color — the stroke's real color is its `colorRgba`. The shade a name
 * renders as depends on the device.
 */
export const rmColors: Readonly<Record<RmColorCode, RmColor>> = {
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
