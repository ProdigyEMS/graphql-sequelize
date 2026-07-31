#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <postgres|mysql|mssql|down>" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 64
fi

dialect="$1"
case "$dialect" in
  postgres|mysql|mssql|down)
    ;;
  *)
    echo "Unsupported database dialect: $dialect" >&2
    usage
    exit 64
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/.." && pwd -P)"
repository_hash="$(
  printf '%s' "$repository_root" |
    git -C "$repository_root" hash-object --stdin |
    cut -c1-12
)"
project_name="graphql-sequelize-$repository_hash"
compose=(
  docker compose
  --project-name "$project_name"
  --project-directory "$repository_root"
  --file "$repository_root/docker-compose.yml"
)

if [[ "$dialect" == "down" ]]; then
  "${compose[@]}" down --volumes --remove-orphans
  echo "Removed disposable database resources for $project_name."

  exit 0
fi

# --no-deps makes the one-service contract explicit if dependencies are added
# to the Compose file later.
"${compose[@]}" up --detach --wait --no-deps "$dialect"

if [[ "$dialect" == "mssql" ]]; then
  # SQL Server does not create application databases from environment
  # variables. Keep this repeatable so callers can safely run db-up.sh twice.
  "${compose[@]}" exec -T mssql \
    /opt/mssql-tools18/bin/sqlcmd \
    -S localhost \
    -U sa \
    -P 'GqlSeq!Test123' \
    -C \
    -b \
    -Q "IF DB_ID(N'graphql_sequelize_test') IS NULL CREATE DATABASE [graphql_sequelize_test];"
fi

container_port=5432
if [[ "$dialect" == "mysql" ]]; then
  container_port=3306
elif [[ "$dialect" == "mssql" ]]; then
  container_port=1433
fi
published_address="$("${compose[@]}" port "$dialect" "$container_port")"

echo "$dialect is healthy at $published_address in $project_name."
