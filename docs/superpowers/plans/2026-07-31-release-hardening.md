# GraphQL Sequelize 1.0 Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@prodigyems/graphql-sequelize@1.0.0` safe to publish and adopt by closing authorization gaps, preserving the existing Prodigy consumer, validating production dialects, and adding a reproducible release pipeline.

**Architecture:** Keep filtering authorization in `replaceWhereOperators`, but validate required predicates structurally before translating GraphQL-safe operators into Sequelize symbols. Make the 1.0 resolver signature an explicit break that rejects legacy positional calls, publish package-owned declarations, and migrate the Prodigy consumer in a separate coordinated PR. Verify the exact npm artifact and use one Docker Compose database definition locally and in GitHub Actions so SQLite, PostgreSQL, MySQL, and MSSQL execute the same isolated integration runner.

**Tech Stack:** Node.js 22+, CommonJS/Babel, Mocha/Chai, Sequelize 6, GraphQL 17, Docker Compose, GitHub Actions, npm.

---

### Task 1: Enforce the filtering boundary

**Files:**
- Modify: `test/unit/authorization.test.js`
- Modify: `test/unit/argsToFindOptions.test.js`
- Modify: `src/replaceWhereOperators.js`
- Modify: `src/argsToFindOptions.js`

- [x] **Step 1: Add failing authorization tests**

  Add focused tests proving:

  - array-valued unknown attributes throw `Unknown attribute`;
  - a required filter beneath `not` or a negative operator does not satisfy the requirement;
  - every `or` branch must carry each required filter;
  - a positive top-level predicate, an `and` conjunct, and every branch of an `or` satisfy the requirement;
  - omitting `where` while `requiredFilters` is non-empty throws.

- [x] **Step 2: Run the focused unit tests and confirm RED**

  Run:

  ```bash
  npm run build:test
  npx mocha .build/test/unit/authorization.test.js .build/test/unit/argsToFindOptions.test.js
  ```

  Expected: the new bypass cases fail because the current implementation accepts them.

- [x] **Step 3: Implement structural required-filter validation**

  Add a focused helper in `src/replaceWhereOperators.js` that treats ordinary object keys as conjunctions, requires every `or` branch to guarantee the predicate, rejects predicates under `not`, and only accepts positive equality/membership forms for the required field. Validate array container keys before recursing. In `argsToFindOptions`, validate `args.where ?? {}` whenever required filters exist.

- [x] **Step 4: Run focused and full unit tests and confirm GREEN**

  Run the focused command above, followed by:

  ```bash
  npm run test:unit
  ```

- [x] **Step 5: Commit**

  ```bash
  git add src/replaceWhereOperators.js src/argsToFindOptions.js test/unit/authorization.test.js test/unit/argsToFindOptions.test.js
  git commit -m "fix(security): enforce required filter scope"
  ```

### Task 2: Preserve consumer compatibility and public API contracts

**Files:**
- Modify: `test/integration/resolver.test.js`
- Modify: `test/integration/regression.test.js`
- Create: `test/unit/packageExports.test.js`
- Modify: `src/resolver.js`
- Modify: `src/index.js`
- Create: `types/index.d.ts`
- Create: `test/types/public-api.test.ts`
- Create: `test/types/tsconfig.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Add failing API-contract tests**

  Add tests proving a legacy positional resolver call fails immediately with a
  clear migration error instead of silently ignoring arguments, `limit: 0`
  returns zero preloaded children, root default exports are callable/scalar
  values rather than `{ default }` wrappers, and only the preferred
  two-argument API typechecks while positional/invalid shapes fail with
  `@ts-expect-error`.

- [x] **Step 2: Run focused tests and confirm RED**

  Run:

  ```bash
  npm run build:test
  npx mocha .build/test/unit/packageExports.test.js
  npx mocha .build/test/integration/resolver.test.js
  npx mocha .build/test/integration/regression.test.js
  npm run test:types
  ```

- [x] **Step 3: Enforce the breaking API and add declarations**

  Reject calls with more than two arguments using a clear
  `resolver(target, { models, requiredFilters, ...options })` migration
  message. Do not retain a compatibility adapter. Test constraint presence
  instead of truthiness for `limit`/`offset`. Unwrap Babel default exports in
  `src/index.js`. Add package-owned declarations for every root export with
  only the canonical two-argument resolver signature.

- [x] **Step 4: Align declared compatibility**

  Keep GraphQL 16 in the default development graph because the latest
  `graphql-relay@0.10.2` still declares `graphql: ^16.2.0`, allowing `npm ci`
  to remain strict and reproducible. Add an explicit GraphQL 17 compatibility
  lane that installs GraphQL 17 with `--legacy-peer-deps`, matching the
  Prodigy consumer's already-working permissive graph, and runs the complete
  unit/integration suite. Keep the published peer range at GraphQL 16 until
  Relay itself exposes a normally installable GraphQL 17 peer graph; document
  the tested compatibility lane and its upstream caveat without advertising
  standard GraphQL 17 support. Restore the missing Relay `^0.6.0` peer, narrow
  Sequelize to `^6.0.0`, add TypeScript as a development dependency, and
  include `types/` in the package.

- [x] **Step 5: Run unit, type, and SQLite integration tests**

  ```bash
  npm run lint
  npm run test:types
  npm run test:unit
  DIALECT=sqlite npm run test:integration
  npm run test:graphql17
  ```

- [x] **Step 6: Commit**

  ```bash
  git add src/resolver.js src/index.js types test package.json package-lock.json
  git commit -m "feat(api): enforce resolver options object"
  ```

### Task 3: Make dialect behavior and regression tests truthful

**Files:**
- Modify: `src/relay.js`
- Modify: `test/integration/relay/connection.test.js`
- Modify: `test/integration/regression.test.js`
- Modify: `docker-compose.yml`
- Modify: `scripts/test-env.sh`
- Create: `scripts/db-up.sh`

- [x] **Step 1: Provision the production dialect**

  Add current PostgreSQL, MySQL, and MSSQL services with health checks to
  `docker-compose.yml`. Implement `scripts/db-up.sh <dialect>` so it starts
  only the selected disposable database, waits for health, and creates
  `graphql_sequelize_test` on MSSQL. This infrastructure is used immediately
  for the red/green MSSQL cycle and later reused by CI.

- [x] **Step 2: Make the MSSQL test fail on execution errors**

  Capture the GraphQL result, assert `result.errors` is absent, and assert the returned order. Add focused coverage for MSSQL null-order normalization. Replace the fan-out test’s tautological expected value with an exact per-user result map.

- [x] **Step 3: Run the MSSQL integration spec and confirm RED**

  Start the disposable MSSQL test database and run:

  ```bash
  bash scripts/db-up.sh mssql
  . scripts/test-env.sh
  DIALECT=mssql npm run test:integration
  ```

  Expected: the null-order query fails with SQL Server rejecting `NULLS FIRST/LAST`.

- [x] **Step 4: Implement dialect-aware null ordering**

  For MSSQL, remove a null-order suffix when SQL Server’s native null order already matches. Otherwise prepend a safe, dialect-quoted `CASE WHEN <column> IS NULL` rank expression before the ordinary order term. Keep other dialects unchanged.

- [x] **Step 5: Run all four dialect suites**

  Run the isolated integration runner against SQLite, PostgreSQL, MySQL, and
  MSSQL, using `scripts/db-up.sh` for every server dialect.

- [x] **Step 6: Commit**

  ```bash
  git add src/relay.js test/integration/relay/connection.test.js test/integration/regression.test.js docker-compose.yml scripts/db-up.sh scripts/test-env.sh
  git commit -m "fix(mssql): normalize null ordering"
  ```

### Task 4: Produce a verifiable npm artifact

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.npmignore`
- Create: `scripts/verify-package.cjs`
- Create: `test/package-smoke.cjs`
- Modify: `README.md`
- Create: `CHANGELOG.md`
- Create: `RELEASING.md`

- [x] **Step 1: Add a failing clean-package smoke check**

  Verify a clean npm pack contains `lib/index.js`, `lib/argsToFindOptions.js`, and `types/index.d.ts`; excludes source, tests, examples, and tool configuration; and can be installed and required from a temporary consumer.

- [x] **Step 2: Run the package check and confirm RED**

  ```bash
  npm run test:package
  ```

  Expected: a clean archive lacks `lib/` because `prepublish` is not a pack lifecycle in npm 11.

- [x] **Step 3: Fix lifecycle and artifact metadata**

  Build in `prepare`/`prepack`, validate in `prepublishOnly`, add a strict `files` allowlist and public `publishConfig`, point repository/bugs/homepage at ProdigyEMS, and make the package smoke check use the exact generated tarball.

- [x] **Step 4: Document the release**

  Update installation/import examples, badges, required-filter semantics, both resolver signatures, the 0.5-to-1.0 migration, verified peer versions, remaining audit caveat, fork-specific Git tag convention, `next` promotion, and rollback.

- [x] **Step 5: Run the artifact test twice from clean state**

  ```bash
  npm run test:package
  npm run test:package
  ```

- [x] **Step 6: Commit**

  ```bash
  git add package.json package-lock.json .npmignore scripts/verify-package.cjs test/package-smoke.cjs README.md CHANGELOG.md RELEASING.md
  git commit -m "build(release): verify published artifact"
  ```

### Task 5: Replace stale test and CI infrastructure

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `scripts/test-env.sh`
- Modify: `scripts/db-up.sh`
- Create: `scripts/test-docker.sh`
- Create: `.github/workflows/ci.yml`
- Delete: `.travis.yml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `eslint.config.js`

- [x] **Step 1: Define reproducible local commands**

  Make `npm test` run lint, types, unit tests, isolated SQLite integration tests, and the package smoke test without Docker. Update the Docker image to Node 22, define current PostgreSQL/MySQL/MSSQL services with health checks, and make `scripts/db-up.sh <dialect>` provision the selected disposable database.

- [x] **Step 2: Repair coverage and lint scope**

  Keep unit coverage in one process, run integration tests through `run-integration.cjs`, lint source/tests/scripts, and resolve all newly surfaced lint findings without weakening rules.

- [x] **Step 3: Add required CI jobs**

  Add Node 22 and 24 quality jobs, an isolated GraphQL 17 compatibility job
  using `--legacy-peer-deps`, plus PostgreSQL, MySQL, and MSSQL integration
  jobs. Use the same Compose services and isolated runner, retain logs on
  failures, enforce `npm audit --audit-level=high`, and smoke-test the packed
  artifact. The compatibility job must explain that the permissive install is
  required by `graphql-relay@0.10.2`'s stale GraphQL 16 peer declaration, not
  by this package.

- [x] **Step 4: Remove the unusable Travis definition**

  Delete the Node 6/8/10 Travis matrix after the GitHub Actions replacement is present.

- [x] **Step 5: Run local CI-equivalent checks**

  ```bash
  npm ci
  npm test
  npm run test:graphql17
  npm run cover
  npm audit --audit-level=high
  bash scripts/test-docker.sh postgres
  bash scripts/test-docker.sh mysql
  bash scripts/test-docker.sh mssql
  ```

- [x] **Step 6: Commit**

  ```bash
  git add Dockerfile docker-compose.yml scripts .github/workflows/ci.yml .travis.yml package.json package-lock.json eslint.config.js test
  git commit -m "ci: add supported runtime and dialect matrix"
  ```

### Task 6: Prepare the Prodigy consumer migration PR

**Files (in a separate Prodigy worktree):**
- Modify: `node/src/helpers/globalResolver.ts`
- Modify or delete: `node/src/@types/prodigyems/index.d.ts`
- Modify: `node/package.json`
- Modify: `node/pnpm-lock.yaml`
- Modify/Create: focused Node resolver tests discovered in the consumer worktree

- [x] **Step 1: Create the required Prodigy worktree**

  From `/Users/ethan/work/prodigy_ems/prodigy`, create conventional branch
  `fix/graphql-sequelize-v1-api` from `origin/develop` under `.worktrees/`,
  copy `config/.env.local`, and install the required frontend dependencies as
  mandated by the repository instructions.

- [x] **Step 2: Add failing consumer migration coverage**

  Point a temporary test install at the exact packed library candidate and add
  focused tests proving report rows, required-filter rejection,
  `extensions.model`, and `extensions.count` continue to work after the API
  migration.

- [x] **Step 3: Migrate the call site**

  Change the consumer to:

  ```ts
  resolver(model, {
    models,
    requiredFilters,
    ...resolverOptions,
  })
  ```

  Remove the stale ambient declaration once package-owned types are consumed.
  Use the exact library commit for draft-PR CI while publication is pending,
  explicitly allow the tested GraphQL 17 peer mismatch caused by Relay's stale
  metadata, and document that the dependency must be changed to registry
  version `1.0.0` before the consumer PR merges.

- [x] **Step 4: Validate the consumer**

  Run the focused tests, `pnpm --dir node lint`,
  `pnpm --dir node typecheck`, and the mandatory
  `pnpm --dir frontend validate`.

- [x] **Step 5: Commit, push, and open a separate draft PR**

  Commit with a Conventional Commit message, push the branch, and open a draft
  PR targeting `develop` that links to graphql-sequelize PR #2 and clearly
  states the publish/version promotion dependency.

### Task 7: Final verification and library PR update

**Files:**
- Modify: `docs/superpowers/plans/2026-07-31-release-hardening.md`

- [x] **Step 1: Review the complete branch diff**

  Confirm only the approved hardening, compatibility, documentation, test, and CI changes are present.

- [x] **Step 2: Run fresh end-to-end verification**

  Run:

  ```bash
  npm ci
  npm test
  npm run test:graphql17
  npm run cover
  npm audit --audit-level=high
  bash scripts/test-docker.sh postgres
  bash scripts/test-docker.sh mysql
  bash scripts/test-docker.sh mssql
  npm run test:package
  git diff --check origin/master...HEAD
  ```

- [x] **Step 3: Mark this plan complete and commit**

  Check every completed plan item and commit the plan status if it changed.

- [x] **Step 4: Push and update PR #2**

  Push to `fix/refresh-lockfile-vulnerable-transitive-deps`, update the PR description with security/API/release changes and exact verification evidence, and leave it ready for the requested human review. Do not publish to npm or merge.
