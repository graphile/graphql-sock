// @ts-check

import * as assert from "node:assert";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const TEST_DIR = import.meta.dirname;
const files = await readdir(TEST_DIR);
const skip = test.skip.bind(test);

/** @param graphqlModuleName {string} */
export const runTest = async (graphqlModuleName) => {
  test(graphqlModuleName, async (t) => {
    const mod = await import(graphqlModuleName);
    const { default: defaultExport, ...namedExports } = mod;
    const mockGraphql = t.mock.module("graphql", {
      cache: true,
      defaultExport,
      namedExports,
    });
    const graphql = await import("graphql");
    const { buildSchema, printSchema } = graphql;
    const isSemanticNonNullType = /** @type {any} */ (graphql)
      .isSemanticNonNullType;

    const { semanticToNullable, semanticToStrict } = await import(
      `../dist/index.js?graphql=${graphqlModuleName}`
    );

    for (const file of files) {
      if (file.endsWith(".test.graphql") && !file.startsWith(".")) {
        const pureDirective =
          file === "schema-with-directive-only.test.graphql";
        const maybeTest =
          pureDirective || isSemanticNonNullType != null ? test : skip;
        await maybeTest(file.replace(/\.test\.graphql$/, ""), async () => {
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
    mockGraphql.restore();
  });
};
