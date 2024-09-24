# GraphQL SOCK

SOCK: **Semantic Output Conversion Kit**

## What is it?

**Takes as input a GraphQL SDL and outputs a derived SDL wherein all
semantic-non-null type modifiers have either been removed
(`semantic-to-nullable`) or have been replaced with strict (traditional)
non-null modifiers (`semantic-to-strict`).**

In the latest proposals around semantic nullability, we introduce a new
"Semantic Non Null" type modifier that means that the value is "null only on
error". However, not all tools support this yet, so this library contains tools
to convert a modern SDL into a more traditional one, to be used for code
generation and other such functionality.

Which command you use will depend on your setup; if you're using `graphql-toe`
then you'll want `semantic-to-strict` to really capitalize on the benefits of
semantic nullability. If you just want to use a semantic nullability SDL with
traditional tools that don't yet understand it, then `semantic-to-nullable` will
just strip out the semantic-non-null types for you.

## Installation

Pick the line that relates to your package manager:

```bash
npm install --save graphql-sock
yarn add graphql-sock
pnpm install --save graphql-sock
```

## Usage

### `semantic-to-nullable`

If a value is "null only on error" then it can be null. This conversion strips
all semantic-non-null type wrappers from the SDL, making a schema that appears
as it traditionally would. This means that you won't reap any of the benefits of
semantic nullability, but you can support existing tools.

```
semantic-to-nullable -i input.graphql -o output.graphql
```

### `semantic-to-strict`

If you're using [graphql-toe](https://github.com/graphile/graphql-toe) or a
similar technique that means that when you read from an errored field the error
will be thrown, then it will not be possible for you to read a `null` from a
"null only on error" position. As such, this position becomes equivalent to a
traditional non-null for you, so this conversion converts all semantic-non-null
type wrappers into traditional non-null wrappers. Your type generators can
therefore generate fewer nullables, and your frontend engineers have to do fewer
null checks and are therefore happier.

```
semantic-to-strict -i input.graphql -o output.graphql
```
