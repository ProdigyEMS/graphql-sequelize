# TypeScript and Native ESM Migration Design

**Status:** Approved for implementation planning

**Date:** 2026-07-31

**Repositories:**

- `ProdigyEMS/graphql-sequelize`
- `ProdigyEMS/prodigy` (`node/` Unicorn workspace)

## Context

`@prodigyems/graphql-sequelize` is a private fork consumed only by Prodigy's
Unicorn service. Version 1.0.0 hardened its filtering boundary, established a
canonical resolver options API, added package-owned handwritten declarations,
and restored a supported release pipeline. The implementation still uses
Babel-generated CommonJS and maintains its TypeScript contract separately from
its JavaScript source.

Unicorn is already written in TypeScript, but it currently compiles to
CommonJS. It consumes the library from the package root and now has focused
real-package tests for the certification and training-hours reporting paths.

The untouched library baseline on 2026-07-31 is:

- 128 unit tests passing;
- 82 SQLite integration tests passing across four spec files;
- package type-contract, lint, and packed-artifact checks passing;
- PostgreSQL, MySQL, and MSSQL integration lanes defined in CI; and
- Node 22, Node 24, and an isolated GraphQL 17 compatibility lane defined in
  CI.

## Goals

1. Rewrite every production library module in strict TypeScript.
2. Publish one native ESM artifact with compiler-generated declarations.
3. Remove Babel, the CommonJS package entrypoint, and handwritten declarations.
4. Preserve the version 1 resolver behavior and public export names.
5. Migrate Unicorn to native ESM without a compatibility adapter.
6. Preserve every existing library and Unicorn test scenario.
7. Prove the unreleased library commit in Unicorn before publishing the
   breaking package version.

## Non-goals

- Redesigning resolver, Relay, filtering, ordering, pagination, or authorization
  behavior.
- Supporting CommonJS consumers or producing a dual package.
- Adding an ESM-to-CommonJS compatibility adapter.
- Replacing Sequelize, GraphQL, GraphQL Relay, Mocha, Chai, or Vitest.
- Converting all library tests to TypeScript solely for stylistic consistency.
- Removing legacy public exports that remain part of the version 1 package
  contract.

## Selected Approach

Use one complete library conversion followed by one coordinated Unicorn
conversion. The library remains independently versioned and tested rather than
being vendored into the Prodigy monorepo. The two repositories coordinate
through an immutable Git commit during prepublication validation and an exact
registry version after publication.

A mixed JavaScript/TypeScript release series was rejected because it would
extend the lifetime of Babel, dual source semantics, and handwritten type
drift. Vendoring was rejected because it would blur ownership and weaken the
library's dialect and package-artifact test boundary.

## Library Architecture

### Module and build configuration

- Set `package.json` to `"type": "module"`.
- Compile with TypeScript `module` and `moduleResolution` set to `NodeNext`.
- Target the supported Node runtime baseline, currently ES2022 on Node 22 and
  Node 24.
- Compile `src/**/*.ts` to ESM JavaScript in `lib/`.
- Emit declarations and declaration maps from the same source into `lib/`.
- Use `.js` relative import specifiers in TypeScript source so emitted ESM is
  directly executable by Node.
- Replace `main`/`types` ambiguity with an explicit package `exports` entry for
  the root API. The root export provides `import` and `types` targets only.
- Keep maintained operational scripts as `.cjs` where they are build/release
  tooling rather than shipped library code.
- Remove Babel dependencies and configuration once TypeScript owns both normal
  and test builds.

### Source conversion

Convert all 15 production source modules to strict TypeScript. Define types at
the implementation boundary for:

- resolver targets, options, hooks, contexts, and operations;
- model maps and Sequelize find/count options;
- GraphQL AST simplification results and variable values;
- Relay connection configuration and connection results;
- filterable attributes, field mappings, and required filters; and
- custom scalar and type-mapper inputs.

Dynamic GraphQL and Sequelize structures may use narrowly scoped generic
constraints or `unknown` with runtime narrowing. Broad `any` types must not be
used merely to silence the compiler. The conversion must not change queries,
operator validation, hook order, pagination, model mutations, or error
messages unless a failing preservation test proves the old behavior was
unintentional and the change is separately approved.

### Public contract

The native ESM root must export the same names as version 1.0.0:

- `argsToFindOptions`
- `resolver`
- `defaultListArgs`
- `defaultArgs`
- `typeMapper`
- `attributeFields`
- `simplifyAST`
- `relay`
- `sequelizeConnection`
- `createConnection`
- `createConnectionResolver`
- `createNodeInterface`
- `JSONType`
- `DateType`

Generated declarations replace `types/index.d.ts`. The existing type-contract
test remains the semantic baseline and is updated only for native ESM module
resolution and compiler-generated types.

## Library Test Design

Before conversion, capture the names and locations of all existing unit and
integration cases. After conversion:

- no existing test scenario may be deleted;
- test files may be renamed or mechanically updated for ESM imports;
- JavaScript tests may remain JavaScript and be copied/compiled by a dedicated
  test TypeScript configuration;
- assertions may change only when required to import the ESM build, not to
  weaken expected behavior; and
- an automated inventory comparison must flag accidental case removal.

The package must retain these gates:

1. strict TypeScript build and declaration generation;
2. lint;
3. public type-contract test;
4. 128 existing unit cases;
5. 82 existing SQLite integration cases;
6. PostgreSQL, MySQL, and MSSQL integration suites;
7. GraphQL 17 compatibility suite;
8. coverage; and
9. packed-artifact verification.

The packed-artifact check is rewritten to install the generated tarball into a
temporary ESM consumer and dynamically import every public export. It must
prove the archive contains the ESM JavaScript and generated declarations while
excluding source, tests, and build configuration. A public-export inventory
check compares the version 1 export list with the new root module.

## Unicorn Architecture

The consumer migration is based on the head of Prodigy PR #13867 so the
version 1 migration and its real-package regression tests cannot be lost. If
that PR has not merged when work begins, the ESM consumer branch remains
stacked on it and is rebased onto `origin/develop` after the prerequisite merge.

Unicorn changes include:

- set the Node workspace to `"type": "module"`;
- use TypeScript `NodeNext` module and resolution settings;
- add `.js` specifiers to relative TypeScript imports;
- replace the single `__dirname` use with an `import.meta.url`-derived path;
- update the development runner to execute TypeScript in native ESM mode;
- preserve the `tsc` production build and `node build/src/server.js` entrypoint;
- update Vitest and supporting configuration only where native ESM requires it;
  and
- import `@prodigyems/graphql-sequelize` only through its public ESM root.

No dynamic-import bridge, `createRequire`, CommonJS wrapper, or dual package
condition is introduced.

## Unicorn Test Design

Capture the Node test inventory from the prerequisite branch before editing.
The ESM PR must have zero deleted pre-existing test files and zero deleted
pre-existing test cases. It retains:

- required-filter tests;
- global resolver contract tests;
- real-package certification integration coverage; and
- real-package training-hours integration coverage.

Required consumer checks are:

1. exact dependency installation;
2. `pnpm --dir node test`;
3. `pnpm --dir node lint`;
4. `pnpm --dir node typecheck`;
5. `pnpm --dir node build`;
6. a built-artifact startup smoke test using `node build/src/server.js` with a
   controlled test environment;
7. mandatory `pnpm --dir frontend validate`; and
8. `cypress/e2e/reporting_spec.ts` and
   `cypress/e2e/organization_reporting_spec.ts` against the real Docker stack.

The startup smoke test must distinguish successful module loading from the
expected absence of external services. A syntax error, missing ESM export,
unsupported directory import, or `ERR_REQUIRE_ESM` is always a failure.

## Coordinated Validation and Release

1. Complete the library conversion and finalize the `2.0.0` package and
   changelog metadata on an isolated branch without publishing.
2. Record the immutable, release-ready library commit under test.
3. Point Unicorn at that Git commit. Temporarily allow the package's Git
   `prepare` build in pnpm configuration, as required for source dependencies.
4. Complete the Unicorn ESM conversion and run all consumer checks.
5. Run the complete library checks, including all database dialects, against
   the same library commit.
6. Open both PRs with the consumer PR explicitly dependent on the library PR
   and, if necessary, Prodigy PR #13867.
7. Merge the library only after both repositories pass against the immutable
   commit. The merge must preserve that commit as an ancestor of
   `origin/master`. Publish and tag from the validated commit, not merely the
   post-merge branch tip. If squash or rebase merging rewrites the commit,
   record the resulting release commit and repeat the complete library and
   Git-backed consumer validation before publishing.
8. Publish npm version `2.0.0` under the `next` dist-tag from that exact
   validated release commit. Use the fork-specific `prodigy-v2.0.0` signed Git
   tag; never replace the inherited upstream `v2.0.0` tag.
9. Replace Unicorn's Git dependency and temporary build allowance with exact
   registry version `2.0.0`, replace the exact 1.0.0 pnpm
   `minimumReleaseAgeExclude` entry with an exact 2.0.0 entry, and regenerate
   the lockfile. This project-owned exact-version exception permits immediate
   local registry verification; it does not bypass CircleCI Safe Chain's
   independent package-age policy.
10. Verify registry integrity, frozen local installation, all consumer checks,
    and both targeted E2E specs again.
11. Let Safe Chain's package-age quarantine expire and rerun the blocked jobs;
    do not disable or bypass that policy.
12. Promote `2.0.0` from `next` to `latest` and merge the consumer only after
    registry-backed CI passes.

## Failure Handling and Rollback

Prepublication consumer failures are fixed in the library or consumer branch;
they are not hidden behind adapters. Publishing is blocked by any lost test,
export mismatch, type-contract regression, dialect failure, package smoke
failure, consumer build failure, or reporting E2E failure.

Version 1.0.0 remains published and immutable. If a problem is found after
2.0.0 publication, restore the `latest` tag to 1.0.0, deprecate 2.0.0 with a
clear message, and keep or restore Unicorn's exact 1.0.0 pin. Publish a new
patch rather than overwriting or unpublishing 2.0.0 unless npm policy and
incident response explicitly require unpublication.

## Acceptance Criteria

- All 15 production library modules are TypeScript.
- The published artifact is native ESM only.
- Babel and handwritten declarations are removed.
- The version 1 public export names and runtime resolver behavior are retained.
- All pre-existing library and Unicorn test scenarios remain.
- Compiler-generated declarations satisfy the public type-contract test.
- Library unit, SQLite, PostgreSQL, MySQL, MSSQL, GraphQL 17, coverage, and
  packed-artifact checks pass.
- Unicorn installs and imports the ESM package without an adapter.
- Unicorn tests, lint, typecheck, production build, startup smoke test,
  frontend validation, and targeted reporting E2E pass.
- The library is proven through an immutable Git commit before publication and
  through exact registry version 2.0.0 before the consumer merges.
- Safe Chain is neither disabled nor bypassed.
