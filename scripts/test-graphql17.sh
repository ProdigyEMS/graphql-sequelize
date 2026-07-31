#!/bin/sh

set -eu

restore_strict_graph() {
  test_status=$?
  trap - EXIT
  set +e
  npm ci
  restore_status=$?
  set -e

  if [ "$restore_status" -ne 0 ]; then
    echo "Failed to restore the strict locked dependency graph." >&2
    exit "$restore_status"
  fi

  exit "$test_status"
}

trap restore_strict_graph EXIT

# graphql-relay@0.10.2 still caps its GraphQL peer at ^16.2.0. The library is
# compatible with GraphQL 17, so this isolated lane uses npm's permissive peer
# resolver without changing the strict, reproducible GraphQL 16 lockfile.
npm install graphql@17.0.2 graphql-relay@0.10.2 \
  --legacy-peer-deps \
  --package-lock=false \
  --no-save

npm run test:unit
DIALECT=sqlite npm run test:integration
