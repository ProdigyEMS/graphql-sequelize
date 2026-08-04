# @prodigyems/graphql-sequelize

[![npm](https://img.shields.io/npm/v/%40prodigyems%2Fgraphql-sequelize)](https://www.npmjs.com/package/@prodigyems/graphql-sequelize)
[![CI](https://github.com/ProdigyEMS/graphql-sequelize/actions/workflows/ci.yml/badge.svg)](https://github.com/ProdigyEMS/graphql-sequelize/actions/workflows/ci.yml)

GraphQL and Relay helpers for Sequelize 6. The package maps GraphQL arguments
to Sequelize queries, exposes Sequelize model attributes as GraphQL fields, and
provides Relay connection helpers.

This is the maintained ProdigyEMS fork. Version 2.0 is a strict TypeScript,
native-ESM-only package. It keeps the smaller, safer resolver contract
introduced by version 1.0.

## Installation

Install the package and its peer dependencies:

```sh
npm install @prodigyems/graphql-sequelize graphql@^16 graphql-relay@^0.10 sequelize@^6
```

The normal dependency graph is verified with GraphQL 16, graphql-relay 0.10,
and Sequelize 6. See [GraphQL compatibility](#graphql-compatibility) for the
separate GraphQL 17 lane.

Version 2.0 requires Node 22 or newer and must be loaded as native ESM. Import
public APIs from the package root:

```js
import {
  attributeFields,
  resolver,
  sequelizeConnection
} from '@prodigyems/graphql-sequelize';
```

CommonJS `require()` and deep imports such as
`@prodigyems/graphql-sequelize/lib/resolver.js` are unsupported. The package
exports map intentionally exposes only the root module.

## Resolver

`resolver` accepts exactly two arguments: a Sequelize model, association, or
target thunk, followed by one options object.

```js
const resolveUsers = resolver(User, {
  models: { User, Organization },
  requiredFilters: ['organizationId'],
  list: true,
  before: async (findOptions, args, context, info) => findOptions,
  after: async (result, args, context, info) => result
});
```

The returned function is a standard GraphQL field resolver. It maps filterable
GraphQL arguments to `where`, supports Relay connections, and chooses
`findOne` or `findAll` from the field type unless `list` is explicit.

### Options

- `models`: model registry used to validate qualified filters.
- `requiredFilters`: attribute names that every accepted filter expression
  must constrain structurally.
- `list`: explicitly select list or single-result behavior.
- `handleConnection`: enable Relay connection conversion; defaults to `true`.
- `operation`: use `'update'` for update resolvers.
- `contextToOptions`: map context properties to Sequelize find options.
- `before(findOptions, args, context, info)`: transform query options.
- `after(result, args, context, info)`: transform the resolved value.

`include` is intentionally unsupported. Use
[dataloader-sequelize](https://github.com/mickhansen/dataloader-sequelize) or
association resolvers for batching.

### Required-filter security

`requiredFilters` is an authorization boundary, not a hint. Each named filter
must be a positive structural constraint in the submitted expression:

- every `OR` branch must retain the constraint;
- an `AND` expression may inherit a constraint from a sibling term;
- `NOT`, negative operators, ranges, unrelated nested fields, and empty
  branches do not satisfy the requirement;
- missing or malformed `where` input fails closed; and
- unknown fields are rejected, including unknown fields inside arrays.

This prevents a caller from weakening an organization or tenant scope by
placing it in only one logical branch. Continue to apply server-owned
authorization in `before`; never accept an authorization value solely because
the client supplied it.

## Migrating from 1.0 to 2.0

Version 2.0 preserves the version 1.0 resolver API: continue to call
`resolver(target, options)` with the same `models`, `requiredFilters`, `list`,
`handleConnection`, `operation`, `contextToOptions`, `before`, and `after`
options. No resolver compatibility adapter or resolver-call API rewrite is
needed.

The package boundary has changed:

- convert consumers to native ESM before upgrading;
- replace `require('@prodigyems/graphql-sequelize')` with a root ESM import;
- replace every deep import with the equivalent named root export; and
- remove consumer ambient declarations or references to `types/index.d.ts`.

Version 2.0 is authored in strict TypeScript and ships declarations generated
from the implementation in `lib/`. Internal `lib/` paths remain private even
though the generated files are present in the package.

## Migrating from 0.5 to 1.0

The old positional extension arguments are unsupported. Move `models` and
required filters into the single options object.

```js
// 0.5 positional form — rejected by 1.0
resolver(User, models, ['organizationId'], {
  before,
  after
});

// 1.0 canonical form
resolver(User, {
  models,
  requiredFilters: ['organizationId'],
  before,
  after
});
```

There is no compatibility adapter. Passing more than two arguments throws with
a migration message so an authorization filter cannot be silently dropped.

Other 1.0 migration notes:

- Sequelize versions before 6 are no longer supported.
- Package-owned TypeScript declarations replace consumer ambient declarations.
- The version 1.0 CommonJS root exported callable APIs without `.default`
  unwrapping. Version 2.0 removes the CommonJS artifact entirely.
- `limit: 0` returns an empty association result consistently.
- Relay null ordering translates unsupported `NULLS FIRST`/`NULLS LAST`
  syntax for SQL Server and MySQL while preserving native PostgreSQL and SQLite
  syntax.

## TypeScript

Compiler-generated declarations ship with the JavaScript under `lib/` and are
resolved from the package root. They cover resolver targets and options, hooks,
field helpers, scalars, and Relay helpers. Do not import declaration or runtime
files from `lib/` directly.

```ts
import {
  resolver,
  type ResolverOptions
} from '@prodigyems/graphql-sequelize';

const options: ResolverOptions<unknown, RequestContext> = {
  requiredFilters: ['organizationId'],
  before: async (findOptions, _args, context) => {
    findOptions.transaction = context.transaction;

    return findOptions;
  }
};

const resolveUsers = resolver(User, options);
```

The declaration intentionally rejects the legacy positional resolver form and
the removed `include` option.

## GraphQL compatibility

The published peer range supports GraphQL through 16. GraphQL 17 is exercised
in an isolated compatibility lane with npm's permissive peer resolver because
`graphql-relay@0.10.2` still declares a GraphQL peer capped at `^16.2.0`.

That lane demonstrates runtime compatibility; it does not make a normal strict
GraphQL 17 install satisfiable. Consumers choosing GraphQL 17 must opt into
their package manager's peer override or permissive mode until graphql-relay
publishes a compatible peer range. The compatibility script restores the
strict locked GraphQL 16 dependency graph when it exits.

## Field and argument helpers

### `attributeFields(model, options)`

Builds a GraphQL field map from Sequelize attributes. Options include `only`,
`exclude`, `map`, `globalId`, `allowNull`, and `commentToDescription`.

```js
const userType = new GraphQLObjectType({
  name: 'User',
  fields: attributeFields(User, {
    exclude: ['passwordHash'],
    commentToDescription: true
  })
});
```

### `defaultArgs(model)` and `defaultListArgs()`

`defaultArgs` builds arguments for a model's primary key.
`defaultListArgs` supplies common list arguments such as `limit`, `order`, and
`where`.

### `typeMapper`

`typeMapper.toGraphQL` converts supported Sequelize data types to GraphQL
types. Add a focused mapper with `typeMapper.mapType` when an application uses
a custom Sequelize type.

### Scalars

`JSONType` and `DateType` are ready-to-use GraphQL scalar types.

## Relay

The root package exports `relay`, `sequelizeConnection`, `createConnection`,
`createConnectionResolver`, and `createNodeInterface`. See the
[Relay guide](https://github.com/ProdigyEMS/graphql-sequelize/blob/master/docs/relay.md)
for connection configuration and pagination examples.

## Development

```sh
npm ci
npm run check
npm run test:integration
npm run test:package
```

`npm run test:package` deletes local build output, runs the real npm pack
lifecycle, verifies each generated JavaScript module, source map, declaration,
and declaration map, rejects the obsolete `types/` directory, installs the
tarball in a clean temporary ESM consumer, and loads its root public APIs.

Release operators should follow
[RELEASING.md](https://github.com/ProdigyEMS/graphql-sequelize/blob/master/RELEASING.md).
Changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

MIT
