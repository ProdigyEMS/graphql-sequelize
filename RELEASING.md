# Releasing

This package is published as `@prodigyems/graphql-sequelize`.

Upstream already owns tags such as `v1.0.0`. Fork releases therefore use
`prodigy-v<version>` Git tags, for example `prodigy-v1.0.0`. Never move or
replace an upstream tag.

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
   git commit -m "build(release): prepare 1.0.0"
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
   npm audit
   npm audit --omit=dev
   ```

7. Run the database-dialect matrix documented by CI. Do not publish when a
   required dialect or package smoke check is failing.

`prepublishOnly` reruns the package checks. `prepare` and `prepack` build
`lib/`; the package smoke check first removes that directory so stale local
output cannot make a release pass.

## Publish to `next`

Record and tag the reviewed release commit using the fork namespace. The clean
tree checks include untracked files and must pass immediately before tagging:

```sh
git diff --exit-code
test -z "$(git status --porcelain)"
release_commit="$(git rev-parse HEAD)"
git tag -s prodigy-v1.0.0 "$release_commit" \
  -m "build(release): publish 1.0.0"
```

Inspect the exact artifact one final time, then publish it without assigning
`latest`. Re-run the clean-tree checks immediately before publishing and prove
the signed tag still names the checked-out commit:

```sh
npm pack --dry-run
git diff --exit-code
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$release_commit"
test "$(git rev-list -n 1 prodigy-v1.0.0)" = "$release_commit"
npm publish --tag next
git push origin prodigy-v1.0.0
npm view @prodigyems/graphql-sequelize@1.0.0 dist.integrity
```

These gates ensure the tag and the published tarball are produced from the same
reviewed commit. Never publish from a dirty working tree.

Never install `next` in this library checkout: doing so would add the package as
its own dependency and modify the release lockfile. Exercise a separate
consuming application worktree instead. For the Prodigy monorepo, use its Node
workspace pattern:

```sh
cd /path/to/prodigy
git worktree add .worktrees/test-graphql-sequelize-next \
  -b chore/test-graphql-sequelize-next origin/develop
cd .worktrees/test-graphql-sequelize-next
pnpm --dir node add --save-exact @prodigyems/graphql-sequelize@next
pnpm --dir node lint
pnpm --dir node typecheck
```

Run the consuming application's focused resolver tests there as well. Version
1.0 does not provide a legacy resolver compatibility adapter, so the consuming
application must already use the two-argument API.

## Promote

After consumer verification, move `latest` to the exact version:

```sh
npm dist-tag add @prodigyems/graphql-sequelize@1.0.0 latest
npm dist-tag rm @prodigyems/graphql-sequelize next
npm view @prodigyems/graphql-sequelize dist-tags
```

Create the GitHub release from the signed `prodigy-v1.0.0` tag and copy the
matching changelog entry into its notes.

## Roll back

Do not overwrite a published version. Restore `latest` to the last known-good
version and deprecate the faulty release:

```sh
npm dist-tag add @prodigyems/graphql-sequelize@<previous> latest
npm deprecate @prodigyems/graphql-sequelize@1.0.0 "Use <previous>; release withdrawn"
npm dist-tag rm @prodigyems/graphql-sequelize next
```

Publish a corrected patch version, verify it through `next`, and promote it by
the same process. Unpublish only when npm's policy and incident response
explicitly require it.

No npm publish is performed by the package checks or by this release-hardening
change.
