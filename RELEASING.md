# Releasing

This package is published as `@prodigyems/graphql-sequelize`.

Upstream already owns tags such as `v1.0.0` and `v2.0.0`. Fork releases
therefore use `prodigy-v<version>` Git tags. The 2.0 release must use
`prodigy-v2.0.0`; never move or replace the inherited upstream `v2.0.0` tag.

## Prepare

1. Use Node 22 or 24 and npm 11.
2. Start from a clean release branch based on the approved code commit.
3. Finalize the release metadata before review:

   - set the intended version in `package.json` and `package-lock.json`;
   - replace `Unreleased` in the changelog heading with the ISO release date
     (`YYYY-MM-DD`); and
   - point the changelog comparison link at the immutable
     `prodigy-v<version>` tag, never `HEAD`.

4. Commit that metadata with a conventional commit, for example:

   ```sh
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "build(release): prepare 2.0.0"
   ```

   Have this exact release commit reviewed and approved. Do not edit release
   metadata after approval.
5. Install exactly from the lockfile:

   ```sh
   npm ci
   ```

6. Run the supported checks:

   ```sh
   npm run check
   DIALECT=sqlite npm run test:integration
   npm run test:graphql17
   npm run test:package
   npm audit --audit-level=high
   npm audit --omit=dev
   ```

7. Run the database-dialect matrix documented by CI. Do not publish when a
   required dialect or package smoke check is failing.
8. Record this immutable release commit and push it so the Git source is
   reachable by consumers. Point the Prodigy Unicorn migration at that exact
   SHA and complete its native ESM validation before publishing. Follow the
   maintained
   [Unicorn native ESM consumer checklist](docs/superpowers/plans/2026-07-31-unicorn-native-esm-consumer.md),
   including the full Node suite, built-server startup, frontend validation,
   both reporting E2E specs, and the inherited-test preservation audit.
9. Merge the library PR while preserving the validated release SHA as an
   ancestor of `origin/master`, then prove that relationship:

   ```sh
   release_commit="<validated release SHA>"
   git fetch origin master
   git merge-base --is-ancestor "$release_commit" origin/master
   ```

   Never publish a release commit that exists only on a pull request branch.
   If a squash, rebase, amendment, merge strategy, or fix changes the release
   SHA, prepare a replacement release commit and repeat the complete library
   and Git-backed consumer validation against it. Update and push the consumer
   Git pin, then repeat the ancestry check before publishing.

`prepublishOnly` reruns the package checks. `prepare` and `prepack` build
`lib/`; the package smoke check first removes that directory so stale local
output cannot make a release pass.

## Publish to `next`

Check out the exact validated release commit after its ancestry check. Record
and tag that commit using the fork namespace; do not substitute the merge tip.
The clean-tree checks include untracked files and must pass immediately before
tagging:

```sh
git diff --exit-code
test -z "$(git status --porcelain)"
release_commit="<validated release SHA>"
test "$(git rev-parse HEAD)" = "$release_commit"
git fetch origin master
git merge-base --is-ancestor "$release_commit" origin/master
git tag -s prodigy-v2.0.0 "$release_commit" \
  -m "build(release): publish 2.0.0"
```

Inspect the exact artifact one final time, then invoke the maintained release
helper from the exact validated commit. The helper rechecks the tracked and
untracked working tree, proves `HEAD` is the validated SHA and that the SHA is
an ancestor of the freshly fetched `origin/master`, verifies the local tag is a
signed annotated tag targeting that SHA, and pushes only the explicit full tag
refspec. Before it pushes anything, it runs `npm pack --dry-run` and rechecks
the clean working tree afterward. It then verifies the remote annotated tag's
dereferenced target. The helper exits immediately on the first failed command
or mismatched invariant; only after every gate passes does it run
`npm publish --tag next` and look up the published integrity:

```sh
release_commit="<validated release SHA>"
node scripts/publish-next-release.cjs "$release_commit"
```

These gates ensure the tag and the published tarball are produced from the same
reviewed commit. Never publish from a dirty working tree or from a PR-only
commit. Never split the helper's gates into independent shell commands: a failed
verification must stop before the irreversible publish.

## Cut the consumer over to the registry

Keep `latest` on version 1.0.0 while validating the registry artifact under
`next`. Never install `next` in this library checkout: doing so would add the
package as its own dependency and modify the release lockfile.

In the existing Unicorn consumer worktree, replace the Git source with the
exact registry dependency and remove the temporary Git build allowance:

```json
"@prodigyems/graphql-sequelize": "2.0.0"
```

Remove the temporary Git dependency and `allowBuilds` entry, and replace the
version 1.0.0 `minimumReleaseAgeExclude` entry with the exact version 2.0.0
entry. Do not weaken the global package-age or trust policy. Regenerate the
lockfile, perform a frozen install, and verify the registry artifact:

```sh
pnpm --dir node install
pnpm --dir node install --frozen-lockfile
npm view @prodigyems/graphql-sequelize@2.0.0 dist.integrity
```

Confirm the lockfile integrity matches the registry value, contains no Git
resolution for this package, and retains no package build allowance. Then run
the complete registry-backed consumer gates; the earlier Git-backed result is
not a substitute:

```sh
pnpm --dir node exec vitest run \
  src/helpers/globalResolver.integration.test.ts \
  src/graphqlTypes/userTrainingHoursResolver.test.ts
pnpm --dir node test
pnpm --dir node lint
pnpm --dir node typecheck
pnpm --dir node build
pnpm --dir node test:esm-build
pnpm --dir frontend validate
```

Start the real local backend with `pnpm --dir frontend run:backend`, wait for
the database seed and Unicorn service, and run the built-server startup check:

```sh
pnpm --dir node test:esm-startup
```

Stop and clean up that stack as documented in the consumer checklist. Then,
from `frontend/`, run both reporting E2E specs against the real Docker backend:

```sh
CYPRESS_SPEC='cypress/e2e/reporting_spec.ts,cypress/e2e/organization_reporting_spec.ts' pnpm e2e
```

Commit and push the exact registry cutover, including the manifest, lockfile,
and removal of the temporary build allowance:

```sh
git add node/package.json node/pnpm-lock.yaml node/pnpm-workspace.yaml
git commit -m "build(node): consume graphql sequelize 2"
git push
```

Wait for CircleCI Safe Chain package-age quarantine to expire; never bypass
it. Rerun all registry-backed required CI checks and confirm every required
check passes before promotion.

Version 2.0 preserves the version 1.0 two-argument resolver API, but the
consumer must use native ESM and package-root imports. There is no CommonJS
adapter.

## Promote

Only after the pushed registry cutover passes the registry-backed required CI
checks following Safe Chain quarantine may `latest` move to the exact version:

```sh
npm dist-tag add @prodigyems/graphql-sequelize@2.0.0 latest
npm dist-tag rm @prodigyems/graphql-sequelize next
npm view @prodigyems/graphql-sequelize dist-tags
```

Create the GitHub release from the signed `prodigy-v2.0.0` tag and copy the
matching changelog entry into its notes.

## Roll back

Do not overwrite a published version. Restore `latest` to the last known-good
version and deprecate the faulty release:

```sh
npm dist-tag add @prodigyems/graphql-sequelize@<previous> latest
npm deprecate @prodigyems/graphql-sequelize@2.0.0 "Use <previous>; release withdrawn"
npm dist-tag rm @prodigyems/graphql-sequelize next
```

Publish a corrected patch version, verify it through `next`, and promote it by
the same process. Unpublish only when npm's policy and incident response
explicitly require it.

No npm publish is performed by the package checks or by this release-hardening
change.
