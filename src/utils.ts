/** convert a buffer to hex */
export function toHex(buffer: Uint8Array): string {
  return [...buffer].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** convert a hex string to a buffer */
export function fromHex(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
}

/** concat buffers */
export function concatBuffers(buffers: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const buff of buffers) {
    length += buff.length;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const buff of buffers) {
    result.set(buff, offset);
    offset += buff.length;
  }
  return result;
}
