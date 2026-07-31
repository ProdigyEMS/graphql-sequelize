# GraphQL Sequelize TypeScript ESM Library Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite all shipped `@prodigyems/graphql-sequelize` modules in strict TypeScript and publish a behavior-preserving, native-ESM-only 2.0 artifact with generated declarations.

**Architecture:** Use a temporary `allowJs` TypeScript build while modules are converted in dependency order, keeping the existing tests green after every conversion. Convert the resolver and Relay core last, then switch the package boundary to native ESM, remove Babel and handwritten declarations, and prove the packed artifact through an external ESM consumer.

**Tech Stack:** Node.js 22/24, TypeScript 5.9, native ESM/NodeNext, Sequelize 6, GraphQL 16/17, GraphQL Relay, Mocha/Chai, ESLint 9, Docker Compose, npm.

**Worktree:** `/Users/ethan/work/prodigy_ems/graphql-sequelize/.worktrees/codex-typescript-esm`

**Design:** `docs/superpowers/specs/2026-07-31-typescript-esm-migration-design.md`

---

### Task 1: Freeze the existing test inventory

**Files:**
- Create: `scripts/verify-test-inventory.cjs`
- Create: `test/test-inventory.json`
- Modify: `package.json`
- Modify: `test/unit/ciConfiguration.test.js`
- Modify: `test/unit/packageMetadata.test.js`

- [ ] **Step 1: Add the inventory verifier with no snapshot**

Implement a CommonJS script that uses the installed `typescript` compiler API
to parse every `.js`/`.ts` file beneath `test/unit` and `test/integration`. Walk
the AST, collect string-literal first arguments to `it(...)` and `test(...)`,
and store sorted entries as `{ file, title, occurrence }`. Support:

```text
node scripts/verify-test-inventory.cjs --write
node scripts/verify-test-inventory.cjs
```

The default mode compares the collected entries with
`test/test-inventory.json`, reports every missing case, and exits nonzero.

- [ ] **Step 2: Run the verifier and confirm RED**

Run: `node scripts/verify-test-inventory.cjs`

Expected: FAIL because `test/test-inventory.json` does not exist.

- [ ] **Step 3: Write and inspect the baseline**

Run:

```bash
node scripts/verify-test-inventory.cjs --write
node -e "const i=require('./test/test-inventory.json'); console.log(i.length)"
```

Expected: `210` cases (128 unit plus 82 integration).

- [ ] **Step 4: Add the permanent check**

Add `"test:inventory": "node scripts/verify-test-inventory.cjs"` and make
`check` run it before the unit suite. Update the existing CI-configuration
test and package-metadata test expected `check` commands without renaming or
removing either test.

- [ ] **Step 5: Verify GREEN**

Run: `npm run test:inventory && npm run test:unit && DIALECT=sqlite npm run test:integration`

Expected: inventory passes, 128 unit tests pass, and 82 integration tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/verify-test-inventory.cjs test/test-inventory.json test/unit/ciConfiguration.test.js test/unit/packageMetadata.test.js
git commit -m "test: preserve existing test inventory"
```

### Task 2: Introduce the transitional TypeScript build

**Files:**
- Create: `tsconfig.build.json`
- Create: `tsconfig.test.json`
- Rename: `eslint.config.js` to `eslint.config.cjs`
- Modify: `eslint.config.cjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/clean-build.cjs`

- [ ] **Step 1: Add the transitional compiler configurations**

Create `tsconfig.build.json` with:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmitOnError": true,
    "outDir": "lib",
    "rootDir": "src",
    "skipLibCheck": false,
    "sourceMap": true,
    "strict": true,
    "target": "ES2022"
  },
  "include": ["src/**/*.js", "src/**/*.ts"]
}
```

Create `tsconfig.test.json` extending the build config, with `rootDir: "."`,
`outDir: ".build"`, `declaration: false`, `declarationMap: false`, and includes
for `src/**/*` plus maintained unit/integration/support JavaScript tests. Set
`allowJs: true` explicitly in this test config so JavaScript test scenarios
continue to compile after the production build disables JavaScript input.

Keep `package.json` as CommonJS during the transitional module conversions so
NodeNext emits behavior-compatible CommonJS until every `module.exports` and
`require` has been removed.

- [ ] **Step 2: Replace Babel build commands**

Change scripts to:

```json
"build": "node scripts/clean-build.cjs && tsc -p tsconfig.build.json",
"build:test": "rm -rf .build && tsc -p tsconfig.test.json"
```

Update `clean-build.cjs` to remove generated TypeScript maps/declarations with
the rest of `lib/`. Do not change package entry metadata yet.

- [ ] **Step 3: Configure ESLint for mixed TypeScript source**

Rename the flat config to `.cjs`, add `typescript-eslint`, apply its parser and
recommended type-safe-independent rules to `src/**/*.ts`, retain the existing
project rules, and disable core `no-undef`/`no-unused-vars` only for TypeScript
where the TypeScript-aware equivalents apply.

Add `typescript-eslint`. Leave the now-unused Babel dependencies and config in
place until Task 10 so their removal and the final ESM artifact change are
reviewed together; no build or test command may invoke Babel after this task.

- [ ] **Step 4: Install and verify the transitional build**

Run:

```bash
npm install
npm run build
npm run lint
npm run test:types
npm run test:unit
DIALECT=sqlite npm run test:integration
```

Expected: the existing CommonJS artifact and all tests remain green under the
TypeScript compiler.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.build.json tsconfig.test.json eslint.config.cjs scripts/clean-build.cjs
git add -u eslint.config.js
git commit -m "build: compile sources with typescript"
```

### Task 3: Convert scalar and leaf utility modules

**Files:**
- Rename/modify: `src/base64.js` to `src/base64.ts`
- Rename/modify: `src/normalizeVariableValues.js` to `src/normalizeVariableValues.ts`
- Rename/modify: `src/sequelizeOps.js` to `src/sequelizeOps.ts`
- Rename/modify: `src/types/dateType.js` to `src/types/dateType.ts`
- Rename/modify: `src/types/jsonType.js` to `src/types/jsonType.ts`
- Rename/modify: `src/typeMapper.js` to `src/typeMapper.ts`
- Test: `test/unit/typeMapper.test.js`

- [ ] **Step 1: Convert base64 and variable normalization**

Type base64 inputs/outputs as strings and replace deprecated `new Buffer` with
`Buffer.from` while preserving ASCII/base64 semantics. Define a GraphQL 16/17
variable-values union and return `Record<string, unknown>` after narrowing the
GraphQL 17 `{ sources, coerced }` shape.

- [ ] **Step 2: Convert Sequelize operators and custom scalars**

Expose the operator map as `Record<string, string | symbol>`. Type scalar
serialization/parsing inputs as `unknown`, narrow AST node kinds before reading
kind-specific fields, and preserve null/error behavior exactly.

- [ ] **Step 3: Convert typeMapper**

Define a `CustomTypeMapper` returning `GraphQLOutputType | null | undefined`, a
narrow interface for Sequelize datatype constructors/instances, and type
`mapType`/`toGraphQL` from those contracts. Preserve enum sanitization and all
existing datatype branches.

Every relative source import must use its emitted `.js` specifier.

- [ ] **Step 4: Run focused and build checks**

Run:

```bash
npm run build
npm run build:test
npx mocha ".build/test/unit/typeMapper.test.js"
npm run test:inventory
npm run lint
```

Expected: typeMapper tests and inventory pass with no compiler/lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/base64.ts src/normalizeVariableValues.ts src/sequelizeOps.ts src/types/dateType.ts src/types/jsonType.ts src/typeMapper.ts
git add -u src
git commit -m "refactor: convert scalar utilities to typescript"
```

### Task 4: Convert filtering and find-option translation

**Files:**
- Rename/modify: `src/replaceWhereOperators.js` to `src/replaceWhereOperators.ts`
- Rename/modify: `src/argsToFindOptions.js` to `src/argsToFindOptions.ts`
- Test: `test/unit/authorization.test.js`
- Test: `test/unit/argsToFindOptions.test.js`
- Test: `test/unit/replaceWhereOperators.test.js`

- [ ] **Step 1: Define the filtering contracts**

Add focused exported types:

```ts
export type WhereKey = string | symbol;
export type WhereExpression = Record<WhereKey, unknown>;

export interface ReplaceWhereOptions {
  filterableAttributes?: readonly string[];
  filterableAttributesFields?: Readonly<Record<string, string>>;
  allowedModels?: readonly string[];
  requiredFilters?: readonly string[];
  validateAttributes?: boolean;
}
```

Use `unknown` and local type guards for arrays/plain objects rather than broad
`any`. Preserve the fail-closed default, required-filter structural proof, and
Sequelize symbol mapping.

- [ ] **Step 2: Convert argsToFindOptions**

Define an argument record supporting `limit`, `offset`, `order`, `where`, and
filterable scalar shorthand. Return Sequelize `FindOptions`. Preserve `0`,
reverse ordering, required-filter validation when `where` is absent, and the
exact errors asserted by tests.

- [ ] **Step 3: Run the security boundary tests**

Run:

```bash
npm run build:test
npx mocha .build/test/unit/authorization.test.js .build/test/unit/argsToFindOptions.test.js .build/test/unit/replaceWhereOperators.test.js
npm run test:inventory
npm run lint
```

Expected: all focused tests pass without modifying assertions.

- [ ] **Step 4: Commit**

```bash
git add src/replaceWhereOperators.ts src/argsToFindOptions.ts
git add -u src
git commit -m "refactor: type filtering option translation"
```

### Task 5: Convert field and argument mapping

**Files:**
- Rename/modify: `src/attributeFields.js` to `src/attributeFields.ts`
- Rename/modify: `src/defaultArgs.js` to `src/defaultArgs.ts`
- Rename/modify: `src/defaultListArgs.js` to `src/defaultListArgs.ts`
- Test: `test/unit/attributeFields.test.js`
- Test: `test/unit/defaultArgs.test.js`
- Test: `test/unit/defaultListArgs.test.js`

- [ ] **Step 1: Type attributeFields options and results**

Define `AttributeFieldsOptions` with typed cache, include/exclude predicates,
mapping callback/record, global ID, nullability, and comment-description flags.
Use Sequelize `ModelStatic<Model>` and GraphQL field config types. Preserve enum
cache mutation and global-ID behavior.

- [ ] **Step 2: Type default arguments**

Return `GraphQLFieldConfigArgumentMap` from both default argument factories.
Keep compound primary keys and the JSON `where` argument unchanged.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm run build:test
npx mocha .build/test/unit/attributeFields.test.js .build/test/unit/defaultArgs.test.js .build/test/unit/defaultListArgs.test.js
npm run test:inventory
npm run lint
```

Expected: all existing mapping tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/attributeFields.ts src/defaultArgs.ts src/defaultListArgs.ts
git add -u src
git commit -m "refactor: type graphql field mapping"
```

### Task 6: Convert GraphQL AST simplification

**Files:**
- Rename/modify: `src/simplifyAST.js` to `src/simplifyAST.ts`
- Test: `test/unit/simplifyAST.test.js`

- [ ] **Step 1: Define AST result types and guards**

Define and export:

```ts
export interface SimplifiedAST {
  fields: Record<string, SimplifiedAST>;
  args: Record<string, unknown>;
  key?: string;
  readonly $parent?: SimplifiedAST;
}
```

Use GraphQL AST node unions and kind checks for fields, fragments, object
values, lists, variables, and aliases. Preserve non-enumerable `$parent`, deep
merge semantics, GraphQL 16/17 variable normalization, and missing-arguments
handling.

- [ ] **Step 2: Run the AST regression suite**

Run:

```bash
npm run build:test
npx mocha .build/test/unit/simplifyAST.test.js
npm run test:inventory
npm run lint
```

Expected: every existing AST test passes unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/simplifyAST.ts
git add -u src/simplifyAST.js
git commit -m "refactor: type graphql ast simplification"
```

### Task 7: Convert the resolver core

**Files:**
- Create: `src/contracts.ts`
- Rename/modify: `src/resolver.js` to `src/resolver.ts`
- Test: `test/integration/resolver.test.js`
- Test: `test/integration/regression.test.js`
- Test: `test/unit/packageExports.test.js`

- [ ] **Step 1: Move shared public contracts into source**

Move the existing resolver contracts from `types/index.d.ts` into
`src/contracts.ts`: `MaybePromise`, `ResolverArguments`, `ResolverTarget`,
`ResolverOptions`, and `ResolverFactory`. Keep the canonical two-argument
signature and `operation: 'update'` restriction. Use type-only imports to avoid
runtime cycles.

- [ ] **Step 2: Convert resolverFactory**

Type target resolution, model/association narrowing, GraphQL info/context,
Sequelize find options, include trees, hooks, and update/findAll results. Keep
the exported callable's `contextToOptions` property through an explicitly typed
`ResolverFactory` assignment.

Replace CommonJS export with `export default resolverFactory`. Preserve:

- immediate rejection of legacy positional options;
- required-filter forwarding;
- query-variable handling;
- before/after hook order;
- count/include behavior;
- association access and connection handling;
- `limit: 0` behavior; and
- existing error text.

- [ ] **Step 3: Run resolver-focused tests**

Run:

```bash
npm run build:test
npx mocha .build/test/unit/packageExports.test.js
DIALECT=sqlite npx mocha .build/test/integration/resolver.test.js
DIALECT=sqlite npx mocha .build/test/integration/regression.test.js
npm run test:inventory
npm run lint
```

Expected: package export, resolver, and regression cases pass.

- [ ] **Step 4: Commit**

```bash
git add src/contracts.ts src/resolver.ts
git add -u src/resolver.js
git commit -m "refactor: rewrite resolver in typescript"
```

### Task 8: Convert Relay and remove the final runtime require

**Files:**
- Rename/modify: `src/relay.js` to `src/relay.ts`
- Modify: `src/contracts.ts`
- Test: `test/unit/relay/connection.test.js`
- Test: `test/unit/relay/mutation.test.js`
- Test: `test/integration/relay.test.js`
- Test: `test/integration/relay/connection.test.js`
- Test: `test/integration/regression.test.js`

- [ ] **Step 1: Add Relay contracts**

Move the connection, edge, page-info, hooks, resolver, definition,
node-interface, and node-type-mapper contracts from `types/index.d.ts` into
`src/contracts.ts`. Keep exported generic defaults compatible with the current
type-contract tests.

- [ ] **Step 2: Convert relay.ts**

Type all public functions and the `NodeTypeMapper` class. Replace the lazy
`require('./resolver')` with the typed ESM import from `./resolver.js`; verify
the resolver/Relay dependency direction does not create an uninitialized
binding by keeping resolver imports limited to Relay helper functions that are
defined before use.

Preserve cursor encoding, null-order normalization, connection slicing,
prefetched associations, custom fields, hooks, and aliases.

- [ ] **Step 3: Run every Relay-related test**

Run:

```bash
npm run build:test
npx mocha .build/test/unit/relay/connection.test.js .build/test/unit/relay/mutation.test.js
DIALECT=sqlite npm run test:integration
npm run test:inventory
npm run lint
```

Expected: 82 integration tests and focused Relay unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/contracts.ts src/relay.ts
git add -u src/relay.js
git commit -m "refactor: rewrite relay helpers in typescript"
```

### Task 9: Establish the native ESM package boundary

**Files:**
- Rename/modify: `src/index.js` to `src/index.ts`
- Modify: `src/contracts.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `test/unit/packageMetadata.test.js`
- Modify: `test/unit/packageExports.test.js`
- Modify: `test/unit/simplifyAST.test.js`
- Modify: `test/types/public-api.test.ts`
- Modify: `test/types/tsconfig.json`
- Modify: all maintained `test/**/*.js` relative import specifiers
- Modify: `test/package-smoke.cjs`

- [ ] **Step 1: Write the ESM package assertions and confirm RED**

Before changing metadata, update tests to require:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "import": "./lib/index.js"
    }
  }
}
```

The package smoke consumer must use `await import('@prodigyems/graphql-sequelize')`,
assert every version 1 public export, read `lib/index.d.ts`, and assert a deep
package import fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

Run: `npm run test:package`

Expected: FAIL because the current artifact is CommonJS and has no exports map.

- [ ] **Step 2: Convert the root index**

Replace unwrapping/`module.exports` with native imports and exports:

```ts
import * as relay from './relay.js';

export { default as argsToFindOptions } from './argsToFindOptions.js';
export { default as resolver } from './resolver.js';
export { default as defaultListArgs } from './defaultListArgs.js';
export { default as defaultArgs } from './defaultArgs.js';
export * as typeMapper from './typeMapper.js';
export { default as attributeFields } from './attributeFields.js';
export { default as simplifyAST } from './simplifyAST.js';
export { relay };
export {
  createConnection,
  createConnectionResolver,
  createNodeInterface,
  createConnection as sequelizeConnection
} from './relay.js';
export { default as JSONType } from './types/jsonType.js';
export { default as DateType } from './types/dateType.js';
export type * from './contracts.js';
```

Confirm the generated runtime export keys exactly match version 1.0.0.

- [ ] **Step 3: Switch the package and tests to ESM**

Set `type: module`, `main: ./lib/index.js`, `types: ./lib/index.d.ts`, and the
root exports map. Remove `types/` from `files`. Update all maintained test
relative imports to explicit `.js` specifiers, including directory imports as
`index.js`. Replace the sole test-side CommonJS load in
`test/unit/simplifyAST.test.js` with `import { parse } from 'graphql'`. Keep
`.cjs` operational scripts unchanged.

Update the type test to `NodeNext`, import from the package self-reference
`@prodigyems/graphql-sequelize`, and resolve that root through the generated
declaration output. Change `test:types` to run `npm run build` before `tsc` so
the contract can never pass against stale generated declarations.

- [ ] **Step 4: Disable transitional JavaScript source**

Set `allowJs: false` in `tsconfig.build.json`, include only `src/**/*.ts`, and
verify all 15 production modules are TypeScript:

```bash
test "$(find src -name '*.js' | wc -l | tr -d ' ')" = "0"
test "$(find src -name '*.ts' | wc -l | tr -d ' ')" = "16"
```

The count is 15 converted modules plus `src/contracts.ts`.
`tsconfig.test.json` remains explicitly `allowJs: true` because the preserved
test suite intentionally remains JavaScript.

- [ ] **Step 5: Run ESM, type, inventory, and package checks**

Run:

```bash
npm run build
npm run lint
npm run test:types
npm run test:inventory
npm run test:unit
DIALECT=sqlite npm run test:integration
npm run test:package
```

Expected: native ESM package smoke passes, 210 existing cases remain, and all
unit/integration tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src test tsconfig.build.json test/types/tsconfig.json
git commit -m "feat!: publish native esm package"
```

Include a commit body:

```text
BREAKING CHANGE: the package now exposes native ESM only and no longer supports require().
```

### Task 10: Remove obsolete build artifacts and update documentation

**Files:**
- Delete: `types/index.d.ts`
- Delete: `babel.config.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `RELEASING.md`
- Modify: `scripts/verify-package.cjs`
- Modify: `test/package-smoke.cjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Remove obsolete declarations and Babel references**

Delete the handwritten declarations and all Babel packages/configuration. Make
the artifact verifier expect generated `.js`, `.js.map`, `.d.ts`, and
`.d.ts.map` files under `lib/`, with no `types/` directory.

- [ ] **Step 2: Document the breaking migration**

Add README and changelog examples using ESM imports. State that 2.0 preserves
the 1.0 resolver options API but removes CommonJS and deep imports. Update
release commands to use `prodigy-v2.0.0` without altering the inherited
`v2.0.0` tag.

- [ ] **Step 3: Run clean artifact checks twice**

Run:

```bash
rm -rf lib .build
npm ci
npm run test:package
npm run test:package
npm audit --audit-level=high
npm audit --omit=dev
```

Expected: both clean package checks pass and audits introduce no high-severity
finding. Existing lower-severity findings must be recorded rather than hidden.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md RELEASING.md package.json package-lock.json scripts/verify-package.cjs test/package-smoke.cjs
git add -u types babel.config.json
git commit -m "docs: document native esm migration"
```

### Task 11: Run the complete library matrix

**Files:**
- Modify only if a truthful test or dialect defect is found; do not mix unrelated cleanup.

- [ ] **Step 1: Run local quality checks**

```bash
npm ci
npm test
npm run test:graphql17
npm run cover
npm audit --audit-level=high
npm audit --omit=dev
```

Expected: inventory, lint, generated type contract, 128 unit tests, 82 SQLite
integration tests, ESM package smoke, GraphQL 17 lane, and coverage pass.

- [ ] **Step 2: Run every production dialect**

```bash
bash scripts/test-docker.sh postgres
bash scripts/test-docker.sh mysql
bash scripts/test-docker.sh mssql
```

Expected: every integration spec passes on all three server dialects and no
failure artifacts remain.

- [ ] **Step 3: Verify the branch diff and inventory**

```bash
git diff --check origin/master...HEAD
npm run test:inventory
git status --short
```

Expected: no whitespace errors, all 210 cases retained, clean tree.

### Task 12: Prepare the immutable 2.0.0 consumer-validation commit

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Finalize release metadata before consumer testing**

Set both package manifests to `2.0.0`, date the changelog entry `2026-07-31`
or the actual implementation completion date, and point its comparison link at
`prodigy-v2.0.0` rather than `HEAD`.

- [ ] **Step 2: Run release-ready checks**

```bash
npm ci
npm test
npm run test:graphql17
npm run test:package
git diff --check
```

Expected: all checks pass from the final metadata.

- [ ] **Step 3: Commit and record the immutable SHA**

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "build(release): prepare 2.0.0"
git rev-parse HEAD
```

Do not amend or rebase this commit after Unicorn begins Git-backed validation.
If its SHA changes, repeat the complete library and consumer validation before
publishing.

- [ ] **Step 4: Run the complete matrix on the immutable release commit**

Without changing any file after Step 3, run:

```bash
npm ci
npm test
npm run test:graphql17
npm run cover
npm audit --audit-level=high
npm audit --omit=dev
bash scripts/test-docker.sh postgres
bash scripts/test-docker.sh mysql
bash scripts/test-docker.sh mssql
test -z "$(git status --porcelain)"
```

Expected: every quality, coverage, artifact, GraphQL, and dialect gate passes
on the exact SHA that Unicorn will consume. If any fix changes the SHA, restart
this step and record the replacement SHA before consumer validation.

- [ ] **Step 5: Push the immutable commit and open the library PR**

Push `codex/typescript-esm`, verify the remote branch resolves to the recorded
SHA, and open a Conventional Commit draft PR that links the design, both plans,
the complete validation matrix, and the dependent Unicorn migration. The Git
SHA must be reachable from GitHub before the consumer attempts its source
installation.
