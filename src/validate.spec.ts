import { expect, test } from "bun:test";
import { UploadEntry } from ".";
import { JtdSchema, validate } from "./validate";

const uploadEntrySchema: JtdSchema<UploadEntry> = {
  properties: {
    docID: { type: "string" },
    hash: { type: "string" },
  },
};

test("validate()", () => {
  const accurate = { docID: "", hash: "" };
  expect(() => validate(uploadEntrySchema, accurate)).not.toThrow();

  const innaccurate = { docID: "" };
  expect(() => validate(uploadEntrySchema, innaccurate)).toThrow();
  expect(() => validate(uploadEntrySchema, innaccurate, false)).not.toThrow();
});
