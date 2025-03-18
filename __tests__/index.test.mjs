// @ts-check

import * as assert from "node:assert";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

import * as graphql from "graphql";

import { semanticToNullable, semanticToStrict } from "../dist/index.js";

const { buildSchema, printSchema } = graphql;

const isSemanticNonNullType = /** @type {any} */ (graphql)
  .isSemanticNonNullType;

const TEST_DIR = import.meta.dirname;
const files = await readdir(TEST_DIR);
const skip = test.skip.bind(test);

for (const file of files) {
  if (file.endsWith(".test.graphql") && !file.startsWith(".")) {
    const pureDirective = file === "schema-with-directive-only.test.graphql";
    const maybeTest =
      pureDirective || isSemanticNonNullType != null ? test : skip;
    maybeTest(file.replace(/\.test\.graphql$/, ""), async () => {
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
