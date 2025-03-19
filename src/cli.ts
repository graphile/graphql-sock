import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { buildSchema, printSchema, validateSchema } from "graphql";

import { semanticToNullable, semanticToStrict } from "./index.js";

export async function main(toStrict = false) {
  const {
    values: { input, output },
  } = parseArgs({
    options: {
      input: {
        type: "string",
        short: "i",
      },
      output: {
        type: "string",
        short: "o",
      },
    },
  });
  if (!input) {
    throw new Error("Please specify an --input schema");
  }
  if (!output) {
    throw new Error("Please specify an --output location");
  }

  const sdl = await readFile(input, "utf8");
  const schema = buildSchema(sdl);
  const errors = validateSchema(schema);
  if (errors.length > 0) {
    console.dir(errors);
    throw new Error("Invalid schema");
  }

  const derivedSchema = toStrict
    ? semanticToStrict(schema)
    : semanticToNullable(schema);

  const newSdl = printSchema(derivedSchema);
  await writeFile(output, newSdl + "\n");
}
