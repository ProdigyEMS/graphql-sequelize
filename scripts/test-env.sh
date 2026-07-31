# shellcheck shell=bash

# Connection settings for the non-sqlite integration dialects.
#
# The test helper reads Docker-link-style variable names (POSTGRES_ENV_*,
# MYSQL_ENV_*, MSSQL_ENV_*) inherited from the original upstream CI. This
# script discovers the dynamically published ports from the isolated Compose
# project that scripts/db-up.sh starts:
#
#   . scripts/test-env.sh && DIALECT=mssql node scripts/run-integration.cjs
#
# Cleanup is equally isolated:
#
#   bash scripts/db-up.sh down
#
# sqlite needs nothing and is the default.

_graphql_sequelize_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "scripts/test-env.sh must be sourced from the repository." >&2
  return 1
}
_graphql_sequelize_root="$(cd "$_graphql_sequelize_root" && pwd -P)"
_graphql_sequelize_hash="$(
  printf '%s' "$_graphql_sequelize_root" |
    git -C "$_graphql_sequelize_root" hash-object --stdin |
    cut -c1-12
)"
export COMPOSE_PROJECT_NAME="graphql-sequelize-$_graphql_sequelize_hash"

_graphql_sequelize_published_port() {
  _graphql_sequelize_service="$1"
  _graphql_sequelize_container_port="$2"
  _graphql_sequelize_address="$(
    docker compose \
      --project-name "$COMPOSE_PROJECT_NAME" \
      --project-directory "$_graphql_sequelize_root" \
      --file "$_graphql_sequelize_root/docker-compose.yml" \
      port "$_graphql_sequelize_service" "$_graphql_sequelize_container_port" \
      2>/dev/null
  )" || _graphql_sequelize_address=""

  if [ -z "$_graphql_sequelize_address" ]; then
    return
  fi

  _graphql_sequelize_port="${_graphql_sequelize_address##*:}"
  case "$_graphql_sequelize_port" in
    ''|*[!0-9]*)
      echo "Invalid published port for $_graphql_sequelize_service: $_graphql_sequelize_address" >&2
      return 1
      ;;
  esac

  printf '%s' "$_graphql_sequelize_port"
}

export POSTGRES_PORT_5432_TCP_ADDR=127.0.0.1
POSTGRES_PORT_5432_TCP_PORT="$(
  _graphql_sequelize_published_port postgres 5432
)"
export POSTGRES_PORT_5432_TCP_PORT
export POSTGRES_ENV_POSTGRES_USER=graphql_sequelize_test
export POSTGRES_ENV_POSTGRES_PASSWORD=graphql_sequelize_test
export POSTGRES_ENV_POSTGRES_DATABASE=graphql_sequelize_test

export MYSQL_PORT_3306_TCP_ADDR=127.0.0.1
MYSQL_PORT_3306_TCP_PORT="$(
  _graphql_sequelize_published_port mysql 3306
)"
export MYSQL_PORT_3306_TCP_PORT
export MYSQL_ENV_MYSQL_USER=test
export MYSQL_ENV_MYSQL_PASSWORD=test
export MYSQL_ENV_MYSQL_DATABASE=test

# Tedious uses this value as the TLS server name; current Node rejects an IP
# address there even when the socket itself is local.
export MSSQL_PORT_1433_TCP_ADDR=localhost
MSSQL_PORT_1433_TCP_PORT="$(
  _graphql_sequelize_published_port mssql 1433
)"
export MSSQL_PORT_1433_TCP_PORT
export MSSQL_ENV_MSSQL_USER=sa
export MSSQL_ENV_MSSQL_PASSWORD='GqlSeq!Test123'
export MSSQL_ENV_MSSQL_DATABASE=graphql_sequelize_test

case "${DIALECT:-}" in
  postgres)
    _graphql_sequelize_selected_port="$POSTGRES_PORT_5432_TCP_PORT"
    ;;
  mysql)
    _graphql_sequelize_selected_port="$MYSQL_PORT_3306_TCP_PORT"
    ;;
  mssql)
    _graphql_sequelize_selected_port="$MSSQL_PORT_1433_TCP_PORT"
    ;;
  *)
    _graphql_sequelize_selected_port=not-required
    ;;
esac

if [ -z "$_graphql_sequelize_selected_port" ]; then
  echo "No published port was discovered for $DIALECT." >&2
  return 1
fi

unset _graphql_sequelize_service
unset _graphql_sequelize_container_port
unset _graphql_sequelize_address
unset _graphql_sequelize_port
unset _graphql_sequelize_selected_port
unset _graphql_sequelize_hash
unset _graphql_sequelize_root
unset -f _graphql_sequelize_published_port
