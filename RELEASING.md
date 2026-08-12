# Releasing

This package is published as `@prodigyems/graphql-sequelize`.

Upstream already owns tags such as `v1.0.0` and `v2.0.0`, so fork releases
use `prodigy-v<version>` tags. Never move or replace an inherited upstream tag.

## Prepare the release commit

1. Use Node 22 or 24 and npm 11, then install exactly from the lockfile:

   ```sh
   npm ci
   ```

2. Update the version in `package.json` and `package-lock.json`, replace the
   changelog's `Unreleased` heading with the ISO release date, and point its
   comparison link at the immutable `prodigy-v<version>` tag.
3. Commit the release metadata with a conventional commit and have that exact
   commit reviewed. Record its SHA; any amendment, rebase, squash, or fix
   creates a new release candidate that must be validated again.

## Validate

Run every maintained local gate from the release commit:

```sh
npm test
npm run test:graphql17
npm run test:docker -- postgres
npm run test:docker -- mysql
npm run test:docker -- mssql
npm audit --omit=dev
npm audit
npm pack --dry-run
```

Do not publish when a runtime, database dialect, package smoke, production
audit, or required CI check is failing. Review and document any development-only
audit findings rather than hiding them.

Push the reviewed commit and confirm it is an ancestor of the protected branch:

```sh
release_commit="<validated-release-sha>"
git fetch origin master
git merge-base --is-ancestor "$release_commit" origin/master
test "$(git rev-parse HEAD)" = "$release_commit"
git diff --exit-code
test -z "$(git status --porcelain)"
```

If the ancestry or clean-tree check fails, stop and validate the correct commit
instead of publishing from a pull request branch or a modified checkout.

## Publish to `next`

Run the publish sequence as one Bash block so any failed verification stops
before the irreversible publish:

```bash
set -euo pipefail

release_commit="<validated-release-sha>"
version="2.0.0"
tag="prodigy-v$version"

test "$(git rev-parse HEAD)" = "$release_commit"
git diff --exit-code
test -z "$(git status --porcelain)"
git fetch origin master
git merge-base --is-ancestor "$release_commit" origin/master
npm whoami
npm pack --dry-run
git diff --exit-code
test -z "$(git status --porcelain)"

if git show-ref --verify --quiet "refs/tags/$tag"; then
  echo "Local tag already exists: $tag" >&2
  exit 1
fi

remote_tag_refs="$(
  git ls-remote --tags origin "refs/tags/$tag" "refs/tags/$tag^{}"
)"
if [ -n "$remote_tag_refs" ]; then
  echo "Remote tag already exists: $tag" >&2
  exit 1
fi

git tag -s "$tag" "$release_commit" \
  -m "build(release): publish $version"
test "$(git cat-file -t "refs/tags/$tag")" = "tag"
test "$(git rev-parse "refs/tags/$tag^{}")" = "$release_commit"
git push origin "refs/tags/$tag:refs/tags/$tag"
git fetch origin "refs/tags/$tag"

remote_tag_ref="$(git ls-remote --tags origin "refs/tags/$tag^{}")"
remote_target="${remote_tag_ref%%[[:space:]]*}"
test "$remote_target" = "$release_commit"

read -r -s -p "npm OTP: " otp
printf '\n'
trap 'unset otp' EXIT
npm publish --access public --tag next --otp="$otp"
npm view "@prodigyems/graphql-sequelize@$version" dist.integrity
unset otp
trap - EXIT
```

Never install `next` in this package checkout; doing so would add the package as
its own dependency. Validate the registry artifact in the real downstream
consumer, including its required unit, integration, build, startup, end-to-end,
and CI checks, before promotion.

## Promote

After the registry-backed consumer checks pass, promote the exact version and
verify the resulting tags:

```sh
npm dist-tag add @prodigyems/graphql-sequelize@2.0.0 latest \
  --otp="<one-time-password>"
npm dist-tag rm @prodigyems/graphql-sequelize next \
  --otp="<one-time-password>"
npm view @prodigyems/graphql-sequelize dist-tags
```

Create the GitHub release from the signed `prodigy-v2.0.0` tag and use the
matching changelog entry for its notes.

## Roll back

Do not overwrite an existing package version. Restore `latest` to the last
known-good version, deprecate the faulty release, remove its `next` tag if
present, and verify the final tags:

```sh
known_good="<known-good-version>"
bad_version="<bad-version>"
otp="<one-time-password>"
npm dist-tag add "@prodigyems/graphql-sequelize@$known_good" latest \
  --otp="$otp"
npm deprecate "@prodigyems/graphql-sequelize@$bad_version" \
  "Use $known_good; release withdrawn" --otp="$otp"
npm dist-tag rm @prodigyems/graphql-sequelize next --otp="$otp"
unset otp
npm view @prodigyems/graphql-sequelize dist-tags
```

Publish a corrected patch version through the same validation and promotion
process.
