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
  Kind,
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
    directives: config.directives.filter((d) => d.name !== "semanticNonNull"),
  });

  const newSdl = printSchema(derivedSchema);

  await writeFile(output, newSdl + "\n");
}

function makeConvertType(toStrict: boolean) {
  const cache = new Map<string, GraphQLNamedType>();

  function convertFields(fields: GraphQLFieldConfigMap<any, any>) {
    return () => {
      return Object.fromEntries(
        Object.entries(fields).map(([fieldName, spec]) => {
          const directive = spec.astNode?.directives?.find(
            (d) => d.name.value === "semanticNonNull",
          );
          const levelsArg = directive?.arguments?.find(
            (a) => a.name.value === "levels",
          );
          const levels =
            levelsArg?.value?.kind === Kind.LIST
              ? levelsArg.value.values
                  .filter((v) => v.kind === Kind.INT)
                  .map((v) => Number(v.value))
              : [0];
          return [
            fieldName,
            {
              ...spec,
              type: convertType(spec.type, directive ? levels : undefined),
              astNode: spec.astNode && {
                ...spec.astNode,
                directives: spec.astNode?.directives?.filter(
                  (d) => d.name.value !== "semanticNonNull",
                ),
              },
            },
          ];
        }),
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

  function convertType(
    type: null | undefined,
    semanticNonNullLevels?: number[],
  ): null | undefined;
  function convertType(
    type: GraphQLObjectType,
    semanticNonNullLevels?: number[],
  ): GraphQLObjectType;
  function convertType(
    type: Maybe<GraphQLObjectType>,
    semanticNonNullLevels?: number[],
  ): Maybe<GraphQLObjectType>;
  function convertType(
    type: GraphQLNamedType,
    semanticNonNullLevels?: number[],
  ): GraphQLNamedType;
  function convertType(
    type: GraphQLType,
    semanticNonNullLevels?: number[],
  ): GraphQLType;
  function convertType(
    type: GraphQLType | null | undefined,
    semanticNonNullLevels?: number[],
  ) {
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
      const innerLevels = semanticNonNullLevels?.includes(1) ? [0] : undefined;
      if (semanticNonNullLevels?.includes(0) && toStrict) {
        return new GraphQLNonNull(
          new GraphQLList(convertType(type.ofType, innerLevels)),
        );
      } else {
        return new GraphQLList(convertType(type.ofType, innerLevels));
      }
    } else if (semanticNonNullLevels?.includes(0) && toStrict) {
      return new GraphQLNonNull(convertType(type));
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
