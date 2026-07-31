# Unicorn Native ESM Consumer Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Prodigy's Unicorn TypeScript service to native ESM and prove it consumes the behavior-preserving ESM-only `@prodigyems/graphql-sequelize` 2.0 package without an adapter or lost tests.

**Architecture:** Build a stacked consumer branch from Prodigy PR #13867 so its version 1 regression coverage is preserved. First prove the CommonJS consumer fails against the immutable ESM library commit, then migrate the whole Unicorn workspace to NodeNext, validate the built service module graph and Docker runtime, and finally replace the Git source with exact registry version 2.0.0 after publication.

**Tech Stack:** Node.js 24/26, TypeScript 6, native ESM/NodeNext, pnpm 11, Vitest, Express 5, Sequelize 6, Docker Compose, Cypress, CircleCI Safe Chain.

**Repository:** `/Users/ethan/work/prodigy_ems/prodigy`

**Prerequisite:** The immutable, release-ready library commit produced by Task 12 of `2026-07-31-typescript-esm-library.md`.

**Design:** `/Users/ethan/work/prodigy_ems/graphql-sequelize/.worktrees/codex-typescript-esm/docs/superpowers/specs/2026-07-31-typescript-esm-migration-design.md`

**Mandatory repository rule:** Before every consumer commit, run
`pnpm --dir frontend validate`. Also run Node tests, lint, typecheck, and build
for every task that changes `node/`. Never use `--no-verify`.

---

### Task 1: Create the stacked Unicorn worktree and freeze test preservation

**Files:**
- No source modifications.
- Reference: `node/src/**/*.test.ts`

- [ ] **Step 1: Resolve the prerequisite consumer base**

Fetch `origin/develop` and `origin/fix/graphql-sequelize-v1-api`. If PR #13867
is merged, use current `origin/develop`; otherwise use the exact remote head of
`fix/graphql-sequelize-v1-api` and keep the new PR stacked until #13867 merges.
Assign the chosen ref to the task-specific shell variable
`UNICORN_ESM_BASE_REF` and record `git rev-parse "$UNICORN_ESM_BASE_REF"` in the
task notes.

- [ ] **Step 2: Create the required isolated worktree**

From `/Users/ethan/work/prodigy_ems/prodigy`:

```bash
git worktree add .worktrees/build-unicorn-native-esm \
  -b build/unicorn-native-esm "$UNICORN_ESM_BASE_REF"
cp config/.env.local .worktrees/build-unicorn-native-esm/config/.env.local
pnpm install --dir .worktrees/build-unicorn-native-esm/frontend
pnpm install --dir .worktrees/build-unicorn-native-esm/node
```

Do not switch or modify the main checkout or the #13867 worktree.

- [ ] **Step 3: Record and verify the inherited Node test inventory**

Run from the new worktree:

```bash
git ls-tree -r --name-only HEAD node | rg '\.(test|spec)\.[jt]sx?$'
git grep -n -E '^[[:space:]]*(it|test)\(' HEAD -- node/src
pnpm --dir node test
```

Expected baseline: four test files and 17 passing tests, including both
real-package integration files from #13867. If the prerequisite branch has
legitimately added tests, use the larger current inventory; never reduce it.

### Task 2: Prove the existing CommonJS consumer rejects the ESM commit

**Files:**
- Modify: `node/package.json`
- Modify: `node/pnpm-lock.yaml`
- Modify: `node/pnpm-workspace.yaml`

- [ ] **Step 1: Record the immutable library SHA**

Run:

```bash
GRAPHQL_SEQUELIZE_SHA=$(git -C /Users/ethan/work/prodigy_ems/graphql-sequelize/.worktrees/codex-typescript-esm rev-parse HEAD)
git -C /Users/ethan/work/prodigy_ems/graphql-sequelize/.worktrees/codex-typescript-esm status --short
```

Expected: the SHA is the release-ready `2.0.0` commit and the library worktree
is clean.

- [ ] **Step 2: Pin the Git source and allow only its prepare build**

Use the recorded SHA to set the dependency without a placeholder:

```bash
pnpm --dir node add --save-exact \
  "@prodigyems/graphql-sequelize@github:ProdigyEMS/graphql-sequelize#$GRAPHQL_SEQUELIZE_SHA"
```

Add this temporary pnpm setting:

```yaml
allowBuilds:
  '@prodigyems/graphql-sequelize': true
```

Keep `blockExoticSubdeps`, trust policy, and every other supply-chain setting
unchanged. Run `pnpm --dir node install` and confirm the lockfile records the
same commit.

- [ ] **Step 3: Run the compiled CommonJS artifact and confirm RED**

Run:

```bash
pnpm --dir node build
cd node && node -e "require('./build/src/helpers/globalResolver.js')"
```

Expected: FAIL because the emitted CommonJS helper attempts to load the
ESM-only package through `require`, with `ERR_REQUIRE_ESM` or
`ERR_PACKAGE_PATH_NOT_EXPORTED`. This compiled-output check is required because
Vitest's Vite transform can load ESM successfully even while the production
CommonJS artifact is broken. If the command fails earlier for a package build
or missing ESM export, fix the library artifact rather than adding an adapter.

Do not commit this deliberately red state separately; continue directly to
Task 3.

### Task 3: Convert Unicorn configuration and imports to NodeNext

**Files:**
- Modify: `node/package.json`
- Modify: `node/pnpm-lock.yaml`
- Modify: `node/tsconfig.json`
- Modify: `node/src/**/*.ts`

- [ ] **Step 1: Switch the workspace module contract**

Set `"type": "module"` in `node/package.json`. Change TypeScript to:

```json
"module": "NodeNext",
"moduleResolution": "NodeNext"
```

Keep `target: es2022`, strictness, output/root directories, JSON resolution,
and declaration augmentations unchanged. Point `main` at
`build/src/server.js` rather than the TypeScript source.

Replace `nodemon` and `ts-node` with `tsx`, and set:

```json
"start": "tsx watch ./src/server.ts"
```

Production remains `tsc` followed by Node executing emitted JavaScript.

- [ ] **Step 2: Make every relative import Node ESM-compatible**

Update all relative imports in the 65 TypeScript source/declaration/test files:

- append `.js` to file imports;
- replace directory imports such as `../constants` and `../models` with
  `../constants/index.js` and `../models/index.js`;
- update side-effect imports such as `./instrument.js`;
- update `vi.mock(...)` paths to exactly match the corresponding runtime import;
- update type-only relative imports too; and
- leave bare package imports unchanged.

Do not add `createRequire`, dynamic-import wrappers, or extensionless paths.

- [ ] **Step 3: Run typecheck and use its errors as the migration checklist**

Run: `pnpm --dir node typecheck`

Expected initially: only concrete ESM migration errors such as the existing
`__dirname`. Resolve every missing-extension/directory-import error before Task
4; do not weaken compiler options.

### Task 4: Make assets and server startup ESM-native and testable

**Files:**
- Create: `node/src/helpers/isDirectExecution.ts`
- Create: `node/src/helpers/isDirectExecution.test.ts`
- Create: `node/scripts/copyBuildAssets.mjs`
- Create: `node/scripts/verifyEsmBuild.mjs`
- Create: `node/scripts/verifyEsmStartup.mjs`
- Modify: `node/src/server.ts`
- Modify: `node/src/startup/translation.ts`
- Modify: `node/package.json`
- Modify: `node/eslint.config.mjs`

- [ ] **Step 1: Write failing direct-execution tests**

Test a helper with this contract:

```ts
export function isDirectExecution(
  moduleUrl: string,
  entryPath: string | undefined
): boolean;
```

Cover an exact `pathToFileURL(resolve(entryPath)).href` match, a different
entry, and an undefined entry. Run the focused test and confirm RED because the
helper does not exist.

- [ ] **Step 2: Implement the ESM direct-execution guard**

Use `pathToFileURL` and `resolve`; return false for no entry. In `server.ts`,
export a documented `startServer(): Promise<void>` containing the existing DB
authentication/listen chain. Invoke it only when:

```ts
if (isDirectExecution(import.meta.url, process.argv[1])) {
  void startServer();
}
```

Preserve current logging and rejected-connection handling.

- [ ] **Step 3: Replace `__dirname` and copy runtime locale assets**

In `translation.ts`, derive the runtime locale directory with:

```ts
const localesDirectory = fileURLToPath(new URL('../locales/', import.meta.url));
```

Implement `copyBuildAssets.mjs` with `fs.cp` to copy `node/src/locales` into
`node/build/src/locales` after compilation. Update `build` to run this script
after `tsc`. Assert the source directory exists and fail loudly on copy errors.

- [ ] **Step 4: Add the built ESM module-graph smoke check**

Implement `verifyEsmBuild.mjs` to:

1. set controlled `ENV`, `PORT`, and placeholder `SQL_*` values;
2. dynamically import `build/src/server.js` by file URL;
3. assert `startServer` is exported without invoking it;
4. dynamically import `build/src/helpers/globalResolver.js`;
5. recursively scan emitted `.js` files and reject `require(`,
   `module.exports`, or `exports.`; and
6. assert `build/src/locales/en.json` exists.

Add `"test:esm-build": "pnpm build && node scripts/verifyEsmBuild.mjs"`.

- [ ] **Step 5: Add the real built-server startup verifier**

Implement `verifyEsmStartup.mjs` to load `config/.env.local` with
`dotenv.parse` without printing it, override `SQL_HOST` to `127.0.0.1`, choose
an unused local `PORT`, and spawn the exact command:

```text
node build/src/server.js
```

Poll `/status` on that port until it succeeds, fail immediately on child exit
or an ESM/module-loading error, include captured non-secret diagnostics on
timeout, and always terminate the child in `finally`. Add
`"test:esm-startup": "pnpm build && node scripts/verifyEsmStartup.mjs"`.

This command requires the local Docker SQL Server and seed to be healthy; run
it in Task 5 rather than silently replacing it with an import-only check.

- [ ] **Step 6: Configure lint for operational ESM JavaScript**

Add a `scripts/**/*.mjs` flat-config block using
`typescript-eslint`'s `disableTypeChecked` config, Node globals, ES2022, and
`sourceType: 'module'`. Keep the type-aware rules unchanged for TypeScript.
This prevents `.mjs` tooling from being parsed with project-service type rules
that require the files to belong to `tsconfig.json`.

- [ ] **Step 7: Run focused and full Node checks**

Run:

```bash
pnpm --dir node exec vitest run src/helpers/isDirectExecution.test.ts
pnpm --dir node test
pnpm --dir node lint
pnpm --dir node typecheck
pnpm --dir node test:esm-build
```

Expected: all inherited tests plus new helper tests pass, TypeScript emits
native ESM, the server module graph imports, and locale assets exist.

- [ ] **Step 8: Run mandatory frontend validation and commit the migration**

```bash
pnpm --dir frontend validate
git add node
git commit -m "build(node): migrate unicorn to native esm"
```

The pre-commit hook must run; never use `--no-verify`.

### Task 5: Verify the Git-backed library integration

**Files:**
- Modify only if a real integration defect is found.

- [ ] **Step 1: Run both package integration tests explicitly**

```bash
pnpm --dir node exec vitest run \
  src/helpers/globalResolver.integration.test.ts \
  src/graphqlTypes/userTrainingHoursResolver.test.ts
```

Expected: both pass using the real Git-built ESM package.

- [ ] **Step 2: Run the complete local consumer validation**

```bash
pnpm --dir node test
pnpm --dir node lint
pnpm --dir node typecheck
pnpm --dir node test:esm-build
pnpm --dir frontend validate
```

- [ ] **Step 3: Run the exact built-server startup path**

Start `pnpm --dir frontend run:backend` in a dedicated long-running terminal.
This exact local-development path uses `docker-compose-local.yml`, publishes
SQL Server port 1433 to `127.0.0.1`, and seeds the database. Wait for
`db_seeder` to report healthy and the ordinary containerized Unicorn service
to become reachable. With that stack still running, run:

```bash
pnpm --dir node test:esm-startup
```

Expected: the spawned `node build/src/server.js` authenticates to the real
database, serves `/status`, and shuts down cleanly through the verifier. A
missing external service must produce a truthful timeout/failure diagnostic,
not a false pass. Stop the long-running backend command and run the matching
cleanup before starting the isolated Cypress lifecycle in Step 4:

```bash
docker compose --env-file config/.env.local \
  -f docker-compose.yml -f docker-compose-local.yml \
  down -v --remove-orphans
```

- [ ] **Step 4: Run the actual reporting E2E paths**

From `frontend/`:

```bash
CYPRESS_SPEC='cypress/e2e/reporting_spec.ts,cypress/e2e/organization_reporting_spec.ts' pnpm e2e
```

Expected: all tests in both specs pass against the real Docker backend, whose
Unicorn image executes the emitted ESM server.

- [ ] **Step 5: Verify no inherited test was removed**

Compare the current branch with the recorded prerequisite base SHA
(`UNICORN_ESM_BASE_SHA=$(git rev-parse "$UNICORN_ESM_BASE_REF")` when the
worktree is created):

```bash
git diff --diff-filter=D --name-only "$UNICORN_ESM_BASE_SHA"...HEAD -- 'node/**/*.test.ts' 'node/**/*.spec.ts'
git diff -U0 "$UNICORN_ESM_BASE_SHA"...HEAD -- node | rg '^-[^-].*(it|test|describe)\(' || true
pnpm --dir node test
```

Expected: no deleted test file/block and at least the inherited 17 tests plus
the new direct-execution tests.

- [ ] **Step 6: Push and open the dependent draft consumer PR**

Push `build/unicorn-native-esm` and open a Conventional Commit draft PR before
the library merges. Link the library draft PR, the immutable Git SHA, Prodigy
PR #13867 when still applicable, the test-preservation audit, the built-server
startup result, and both E2E results. The PR intentionally remains Git-pinned
and draft until the registry cutover.

### Task 6: Rebase after the prerequisite consumer PR merges

**Files:**
- Resolve only genuine rebase conflicts.

- [ ] **Step 1: Use the project `/rebase-pr` workflow**

After PR #13867 merges, invoke the repository's `.agent/skills/rebase-pr`
workflow and rebase `build/unicorn-native-esm` onto current `origin/develop`.
Use `--force-with-lease` only with the user's existing authorization.

- [ ] **Step 2: Re-run preservation and validation gates**

Run Node tests/lint/typecheck/build smoke, mandatory frontend validation, and
the exact Task 5 Step 3 local-backend `test:esm-startup` procedure. Run the two
targeted Cypress specs again if the rebase changes any runtime or dependency
input.

Expected: no inherited test disappears and the Git-backed package remains
green.

### Task 7: Merge and publish the exact validated library commit

**Files:**
- Library release metadata is already final; do not edit it here.

- [ ] **Step 1: Merge without losing commit identity**

Merge the library PR in a way that preserves the immutable release-ready
commit as an ancestor of `origin/master`. Verify:

```bash
GRAPHQL_SEQUELIZE_SHA=$(git -C /Users/ethan/work/prodigy_ems/graphql-sequelize/.worktrees/codex-typescript-esm rev-parse HEAD)
git -C /Users/ethan/work/prodigy_ems/graphql-sequelize/.worktrees/codex-typescript-esm fetch origin master
git -C /Users/ethan/work/prodigy_ems/graphql-sequelize/.worktrees/codex-typescript-esm \
  merge-base --is-ancestor "$GRAPHQL_SEQUELIZE_SHA" origin/master
```

If the SHA was rewritten by squash/rebase merge, do not rerun the deliberate
CommonJS RED step. Instead:

1. rerun the complete quality, coverage, artifact, GraphQL, and three-dialect
   command sequence from Library Task 12 Step 4 on the rewritten release
   commit;
2. replace Unicorn's Git dependency with that exact rewritten SHA and
   regenerate the lockfile;
3. rerun Consumer Task 5 Steps 1-5, including built-server startup and both
   E2E specs; and
4. run mandatory frontend validation, commit the manifest and lockfile with
   `build(node): validate rewritten graphql sequelize commit`, push the updated
   consumer draft, and verify its remote SHA before publishing.

Publish only when the release commit and consumer dependency name the same SHA.

- [ ] **Step 2: Follow `RELEASING.md` from the validated commit**

Check out the exact commit, prove the tree is clean, rerun release checks, sign
`prodigy-v2.0.0`, publish `2.0.0` under `next`, push the fork tag, and verify
registry integrity. Never move inherited `v2.0.0`.

Expected: npm reports exact version `2.0.0`, its integrity matches the packed
artifact, and `next` points at 2.0.0 while `latest` remains 1.0.0.

### Task 8: Replace the Git source with exact registry version 2.0.0

**Files:**
- Modify: `node/package.json`
- Modify: `node/pnpm-lock.yaml`
- Modify: `node/pnpm-workspace.yaml`

- [ ] **Step 1: Apply the registry cutover**

Set:

```json
"@prodigyems/graphql-sequelize": "2.0.0"
```

Remove the temporary `allowBuilds` entry. Replace
`@prodigyems/graphql-sequelize@1.0.0` in `minimumReleaseAgeExclude` with the
exact `@prodigyems/graphql-sequelize@2.0.0`. Do not relax the global age or
trust policy.

- [ ] **Step 2: Regenerate and verify the registry lockfile**

```bash
pnpm --dir node install
pnpm --dir node install --frozen-lockfile
npm view @prodigyems/graphql-sequelize@2.0.0 dist.integrity
```

Confirm the lockfile integrity equals the registry value and contains no Git
resolution or build allowance.

- [ ] **Step 3: Repeat complete registry-backed validation**

Run Node tests/lint/typecheck/ESM build smoke, then repeat Task 5 Step 3 with
the local backend stack and run `pnpm --dir node test:esm-startup`. Run frontend
validation and both targeted E2E specs afterward. These are the real release
gates; Git-backed success is not a substitute.

- [ ] **Step 4: Commit the exact release pin**

```bash
git add node/package.json node/pnpm-lock.yaml node/pnpm-workspace.yaml
git commit -m "build(node): consume graphql sequelize 2"
```

### Task 9: Complete CI quarantine and PR handoff

**Files:**
- No source changes unless CI reveals a reproducible defect.

- [ ] **Step 1: Push the registry cutover and update the consumer PR**

Push `build/unicorn-native-esm`, update the existing Conventional Commit draft
PR with the registry integrity, exact checks, ESM-only break, and test
preservation. Keep it draft until registry-backed CI is eligible.

- [ ] **Step 2: Inspect CircleCI through its MCP integration**

Confirm failures during the first 24 hours are only Safe Chain package-age
blocks. Do not bypass the policy. Diagnose any other failure from its actual
logs and fix it with the full local validation required by `AGENTS.md`.

- [ ] **Step 3: Rerun after quarantine and promote the package**

After Safe Chain accepts 2.0.0, rerun the blocked workflows. When all required
checks pass, move npm `latest` from 1.0.0 to 2.0.0 and remove `next` according
to `RELEASING.md`.

- [ ] **Step 4: Final preservation audit**

Compare every Node test file/case against current `origin/develop`, run the
complete Node suite one final time, verify the PR has no unresolved review
threads, and only then mark it ready for human review/merge.
