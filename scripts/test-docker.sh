#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <postgres|mysql|mssql>" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 64
fi

dialect="$1"
case "$dialect" in
  postgres|mysql|mssql)
    ;;
  *)
    echo "Unsupported database dialect: $dialect" >&2
    usage
    exit 64
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/.." && pwd -P)"
requested_artifact_root="${GRAPHQL_SEQUELIZE_TEST_DOCKER_ARTIFACT_ROOT:-$repository_root/.artifacts/test-docker}"

if [[ "$requested_artifact_root" != /* ]]; then
  echo "Artifact root must be an absolute non-root path." >&2
  exit 64
fi

artifact_root="$(
  node -e \
    'process.stdout.write(require("node:path").resolve(process.argv[1]))' \
    "$requested_artifact_root"
)"

if [[ "$artifact_root" == "/" ]]; then
  echo "Artifact root must be an absolute non-root path." >&2
  exit 64
fi

artifact_directory="$artifact_root/$dialect"
temporary_directory="$(mktemp -d)"
test_output="$temporary_directory/test.log"
down_output="$temporary_directory/down.log"

if [[ -d "$artifact_directory" ]]; then
  rm -rf -- "$artifact_directory"
fi

repository_hash="$(
  printf '%s' "$repository_root" |
    git -C "$repository_root" hash-object --stdin |
    cut -c1-12
)"
COMPOSE_PROJECT_NAME="graphql-sequelize-$repository_hash"
export COMPOSE_PROJECT_NAME
compose=(
  docker compose
  --project-name "$COMPOSE_PROJECT_NAME"
  --project-directory "$repository_root"
  --file "$repository_root/docker-compose.yml"
)

# Invoked from the EXIT trap cleanup path.
# shellcheck disable=SC2329
preserve_failure_logs() {
  mkdir -p "$artifact_directory"
  {
    echo "Dialect: $dialect"
    echo "Compose project: $COMPOSE_PROJECT_NAME"
    cat "$test_output"
  } >"$artifact_directory/test.log"
  {
    echo "Dialect: $dialect"
    echo "Compose project: $COMPOSE_PROJECT_NAME"
    echo
    echo "=== docker compose ps ==="
    "${compose[@]}" ps --all
    echo
    echo "=== docker compose logs ==="
    "${compose[@]}" logs --no-color "$dialect"
  } >"$artifact_directory/database.log" 2>&1 || true
}

# Invoked indirectly by the EXIT trap.
# shellcheck disable=SC2329
cleanup() {
  exit_status=$?
  trap - EXIT
  set +e

  if [[ "$exit_status" -ne 0 ]]; then
    preserve_failure_logs
  fi

  bash "$repository_root/scripts/db-up.sh" down >"$down_output" 2>&1
  down_status=$?

  if [[ "$down_status" -ne 0 ]]; then
    cat "$down_output" >>"$test_output"
    if [[ "$exit_status" -eq 0 ]]; then
      exit_status="$down_status"
      preserve_failure_logs
    else
      cat "$down_output" >>"$artifact_directory/test.log"
    fi
  fi

  rm -rf -- "$temporary_directory"

  if [[ "$exit_status" -ne 0 ]]; then
    echo "Failure diagnostics: $artifact_directory" >&2
  fi

  exit "$exit_status"
}

run_integration() (
  set -euo pipefail

  cd "$repository_root"
  echo "Starting disposable $dialect database."
  bash "$repository_root/scripts/db-up.sh" "$dialect"
  export DIALECT="$dialect"
  # shellcheck disable=SC1091
  source "$repository_root/scripts/test-env.sh"
  echo "Running isolated $dialect integration tests."
  npm run test:integration
)

trap cleanup EXIT

set +e
run_integration 2>&1 | tee "$test_output"
pipeline_status=("${PIPESTATUS[@]}")
set -e

producer_status="${pipeline_status[0]}"
tee_status="${pipeline_status[1]}"

# Preserve the test/provisioning failure when both sides fail. If the producer
# succeeded, a tee failure still means CI lost its diagnostic stream.
if [[ "$producer_status" -ne 0 ]]; then
  exit "$producer_status"
fi

exit "$tee_status"
