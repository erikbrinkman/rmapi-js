import { JTDSchemaType as JtdSchema } from "ajv/dist/jtd";
import { validate as jtdValidate } from "jtd";

export type { JtdSchema };

export function validate<T>(
  schema: JtdSchema<T>,
  obj: unknown,
  verify: boolean = true,
): asserts obj is T {
  const errors = verify ? jtdValidate(schema, obj) : [];
  if (errors.length) {
    // TODO better errors
    throw new Error(
      `couldn't validate schema: ${JSON.stringify(
        obj,
      )} didn't match schema ${JSON.stringify(schema)}`,
    );
  }
}
