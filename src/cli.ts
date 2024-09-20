import {
  buildSchema,
  GraphQLFieldConfigMap,
  GraphQLFieldMap,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLSemanticNonNull,
  GraphQLType,
  GraphQLUnionType,
  printSchema,
  validateSchema,
} from "graphql";
import type { Maybe } from "graphql/jsutils/Maybe";
import { ObjMap } from "graphql/jsutils/ObjMap";
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
    types: config.types
      .filter((t) => !t.name.startsWith("__"))
      .map((t) => convertType(t)),
  });

  const newSdl = printSchema(derivedSchema);

  await writeFile(output, newSdl + "\n");
}

function makeConvertType(toStrict: boolean) {
  const cache = new Map<string, GraphQLNamedType>();

  function convertFields(fields: GraphQLFieldConfigMap<any, any>) {
    return () => {
      return Object.fromEntries(
        Object.entries(fields).map(([fieldName, spec]) => [
          fieldName,
          {
            ...spec,
            type: convertType(spec.type),
          },
        ]),
      ) as any;
    };
  }

  function convertTypes(
    types: readonly GraphQLInterfaceType[] | null | undefined,
  ): undefined | (() => readonly GraphQLInterfaceType[]);
  function convertTypes(
    types: readonly GraphQLObjectType[],
  ): () => readonly GraphQLObjectType[];
  function convertTypes(
    types: readonly GraphQLNamedType[],
  ): undefined | (() => readonly GraphQLNamedType[]);
  function convertTypes(
    types: readonly GraphQLNamedType[] | undefined,
  ): undefined | (() => readonly GraphQLNamedType[]);
  function convertTypes(
    types: readonly GraphQLNamedType[] | null | undefined,
  ): undefined | (() => readonly GraphQLNamedType[]) {
    if (!types) return undefined;
    return () => types.map((t) => convertType(t));
  }

  function convertType(type: null | undefined): null | undefined;
  function convertType(type: GraphQLObjectType): GraphQLObjectType;
  function convertType(
    type: Maybe<GraphQLObjectType>,
  ): Maybe<GraphQLObjectType>;
  function convertType(type: GraphQLNamedType): GraphQLNamedType;
  function convertType(type: GraphQLType): GraphQLType;
  function convertType(type: GraphQLType | null | undefined) {
    if (!type) return type;
    if (type instanceof GraphQLSemanticNonNull) {
      const unwrapped = convertType(type.ofType);
      // Here's where we do our thing!
      if (toStrict) {
        return new GraphQLNonNull(unwrapped);
      } else {
        return unwrapped;
      }
    } else if (type instanceof GraphQLNonNull) {
      return new GraphQLNonNull(convertType(type.ofType));
    } else if (type instanceof GraphQLList) {
      return new GraphQLList(convertType(type.ofType));
    }
    if (type.name.startsWith("__")) {
      return null;
    }
    if (cache.has(type.name)) {
      return cache.get(type.name);
    }
    const newType = (() => {
      if (type instanceof GraphQLObjectType) {
        const config = type.toConfig();
        return new GraphQLObjectType({
          ...config,
          fields: convertFields(config.fields),
          interfaces: convertTypes(config.interfaces),
        });
      } else if (type instanceof GraphQLInterfaceType) {
        const config = type.toConfig();
        return new GraphQLInterfaceType({
          ...config,
          fields: convertFields(config.fields),
          interfaces: convertTypes(config.interfaces),
        });
      } else if (type instanceof GraphQLUnionType) {
        const config = type.toConfig();
        return new GraphQLUnionType({
          ...config,
          types: convertTypes(config.types),
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
