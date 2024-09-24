// @ts-check

import { test } from "node:test";
import * as assert from "node:assert";
import { semanticToStrict, semanticToNullable } from "../dist/index.js";
import { buildSchema, printSchema } from "graphql";
import { readdir, readFile } from "node:fs/promises";

const TEST_DIR = import.meta.dirname;
const files = await readdir(TEST_DIR);

for (const file of files) {
  if (file.endsWith(".test.graphql") && !file.startsWith(".")) {
    test(file.replace(/\.test\.graphql$/, ""), async () => {
      const sdl = await readFile(TEST_DIR + "/" + file, "utf8");
      const schema = buildSchema(sdl);
      await test("semantic-to-strict", async () => {
        const expectedSdl = await readFile(
          TEST_DIR + "/snapshots/" + file.replace(".test.", ".strict."),
          "utf8",
        );
        const converted = semanticToStrict(schema);
        assert.equal(
          printSchema(converted).trim(),
          expectedSdl.trim(),
          "Expected semantic-to-strict to match",
        );
      });
      await test("semantic-to-nullable", async () => {
        const expectedSdl = await readFile(
          TEST_DIR + "/snapshots/" + file.replace(".test.", ".nullable."),
          "utf8",
        );
        const converted = semanticToNullable(schema);
        assert.equal(
          printSchema(converted).trim(),
          expectedSdl.trim(),
          "Expected semantic-to-nullable to match",
        );
      });
    });
  }
}
