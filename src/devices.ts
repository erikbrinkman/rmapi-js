/** a reMarkable device display */
export interface DeviceScreen {
  /** the marketing name */
  name: string;
  /** native portrait width in pixels */
  width: number;
  /** native portrait height in pixels */
  height: number;
  /** display density in dots per inch */
  dpi: number;
}

/** the model number of a known reMarkable device */
export type DeviceModel = "RM100" | "RM110" | "RM02A" | "RM03A" | "RM102";

/**
 * display specs for known reMarkable devices, keyed by model number
 *
 * These feed the `customFit` zoom math: `customZoomPageWidth`/`customZoomPageHeight`
 * are the source page in device pixels (`pagePt * dpi / 72`), and `width`/`height`
 * give the screen aspect. Every model is 3:4 (0.75) except the Paper Pro Move,
 * which is 9:16.
 */
export const deviceScreens: Record<DeviceModel, DeviceScreen> = {
  RM100: { name: "reMarkable 1", width: 1404, height: 1872, dpi: 226 },
  RM110: { name: "reMarkable 2", width: 1404, height: 1872, dpi: 226 },
  RM02A: { name: "reMarkable Paper Pro", width: 1620, height: 2160, dpi: 229 },
  RM03A: {
    name: "reMarkable Paper Pro Move",
    width: 954,
    height: 1696,
    dpi: 264,
  },
  RM102: { name: "reMarkable Paper Pure", width: 1404, height: 1872, dpi: 226 },
};
