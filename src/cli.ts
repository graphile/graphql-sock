import {
  buildSchema,
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLSchema,
  printSchema,
  validateSchema,
} from "graphql";
import type { Maybe } from "graphql/jsutils/Maybe";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

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

  const config = schema.toConfig();
  const convertType = makeConvertType(toStrict);
  const derivedSchema = new GraphQLSchema({
    ...config,
    query: convertType(config.query),
    mutation: convertType(config.mutation),
    subscription: convertType(config.subscription),
  });

  const newSdl = printSchema(derivedSchema);

  await writeFile(output, newSdl + "\n");
}

function makeConvertType(toStrict: boolean) {
  const cache = new Map<string, GraphQLNamedType>();

  function convertType(type: null | undefined): null | undefined;
  function convertType(type: GraphQLObjectType): GraphQLObjectType;
  function convertType(
    type: Maybe<GraphQLObjectType>,
  ): Maybe<GraphQLObjectType>;
  function convertType(type: GraphQLNamedType): GraphQLNamedType;
  function convertType(type: GraphQLNamedType | null | undefined) {
    if (!type) return type;
    if (cache.has(type.name)) {
      return cache.get(type.name);
    }
    const newType = (() => {
      if (type instanceof GraphQLObjectType) {
        const config = type.toConfig();
        return new GraphQLObjectType({
          ...config,
        });
      } else if (type instanceof GraphQLInterfaceType) {
        const config = type.toConfig();
        return new GraphQLInterfaceType({
          ...config,
        });
      } else {
        return type;
      }
    })();
    cache.set(type.name, newType);
    return newType;
  }

  return convertType;
}
