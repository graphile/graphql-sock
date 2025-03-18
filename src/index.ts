import {
  GraphQLFieldConfig,
  GraphQLFieldConfigMap,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
  GraphQLNullableType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLSchema,
  GraphQLType,
  GraphQLUnionType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
  Kind,
} from "graphql";
import * as graphql from "graphql";

type Maybe<T> = null | undefined | T;

// If GraphQL doesn't have this helper function, then it doesn't natively support GraphQLSemanticNonNull
const isSemanticNonNullType = graphql.isSemanticNonNullType ?? (() => false);

function convertSchema(schema: GraphQLSchema, toStrict: boolean) {
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
  return derivedSchema;
}

export function semanticToNullable(schema: GraphQLSchema) {
  return convertSchema(schema, false);
}

export function semanticToStrict(schema: GraphQLSchema) {
  return convertSchema(schema, true);
}

function makeConvertType(toStrict: boolean) {
  const cache = new Map<string, GraphQLNamedType>();

  function convertFields(fields: GraphQLFieldConfigMap<unknown, unknown>) {
    return () => {
      return Object.fromEntries(
        Object.entries(fields).map(([fieldName, inSpec]) => {
          const spec = convertFieldConfig(inSpec, toStrict);
          return [
            fieldName,
            {
              ...spec,
              type: convertType(spec.type),
            },
          ];
        }),
      ) as GraphQLFieldConfigMap<unknown, unknown>;
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
    if (!types) {
      return undefined;
    }
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
    if (!type) {
      return type;
    }
    if (isSemanticNonNullType(type)) {
      const unwrapped = convertType(type.ofType as GraphQLNullableType);
      // Here's where we do our thing!
      if (toStrict) {
        return new GraphQLNonNull(unwrapped);
      } else {
        return unwrapped;
      }
    } else if (type instanceof GraphQLNonNull) {
      return new GraphQLNonNull(
        convertType(type.ofType as GraphQLNullableType),
      );
    } else if (type instanceof GraphQLList) {
      return new GraphQLList(convertType(type.ofType as GraphQLType));
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

/**
 * Takes a GraphQL field config and checks to see if the `@semanticNonNull`
 * directive was applied; if so, converts to a field config that adds
 * GraphQLNonNull wrapper types in the relevant places if `toStrict` is true.
 *
 * @see {@url https://www.apollographql.com/docs/kotlin/advanced/nullability/#semanticnonnull}
 */
export function convertFieldConfig(
  spec: GraphQLFieldConfig<unknown, unknown, unknown>,
  toStrict: boolean,
): GraphQLFieldConfig<unknown, unknown, unknown> {
  const directive = spec.astNode?.directives?.find(
    (d) => d.name.value === "semanticNonNull",
  );
  if (!directive) {
    return spec;
  }

  /** The AST node with the semanticNonNull directive removed */
  const filteredAstNode = {
    ...spec.astNode!,
    directives: spec.astNode!.directives!.filter(
      (d) => d.name.value !== "semanticNonNull",
    ),
  };

  if (!toStrict) {
    // If we're not converting to strict, we can simply strip this directive
    return {
      ...spec,
      astNode: filteredAstNode,
    };
  }

  // Otherwise, convert semantic non-null positions to strict non-null

  const levelsArg = directive.arguments?.find((a) => a.name.value === "levels");
  const levels =
    levelsArg?.value?.kind === Kind.LIST
      ? levelsArg.value.values
          .filter((v) => v.kind === Kind.INT)
          .map((v) => Number(v.value))
      : [0];
  function recurse(type: GraphQLOutputType, level: number): GraphQLOutputType {
    if (isSemanticNonNullType(type)) {
      // Strip semantic-non-null types; this should never happen but if someone
      // uses both semantic-non-null and the `@semanticNonNull` directive, we
      // want the directive to win (I guess?)
      return recurse(type.ofType, level);
    } else if (type instanceof GraphQLNonNull) {
      const inner = recurse(type.ofType, level);
      if (levels.includes(level)) {
        // Semantic non-null from `inner` replaces our GraphQLNonNull wrapper
        return inner;
      } else {
        // Keep non-null wrapper; no semantic-non-null was added to `inner`
        return new GraphQLNonNull(inner);
      }
    } else if (type instanceof GraphQLList) {
      const inner = new GraphQLList(recurse(type.ofType, level + 1));
      if (levels.includes(level)) {
        return new GraphQLNonNull(inner);
      } else {
        return inner;
      }
    } else {
      if (levels.includes(level)) {
        return new GraphQLNonNull(type);
      } else {
        return type;
      }
    }
  }

  return {
    ...spec,
    type: recurse(spec.type, 0),
    astNode: filteredAstNode,
  };
}
