# Connection settings for the non-sqlite integration dialects.
#
# The test helper reads Docker-link-style variable names (POSTGRES_ENV_*,
# MYSQL_ENV_*, MSSQL_ENV_*) inherited from the original upstream CI. Source
# this file to point them at the local containers that scripts/db-up.sh
# starts:
#
#   . scripts/test-env.sh && DIALECT=mssql node scripts/run-integration.cjs
#
# sqlite needs nothing and is the default.

export POSTGRES_PORT_5432_TCP_ADDR=127.0.0.1
export POSTGRES_ENV_POSTGRES_USER=graphql_sequelize_test
export POSTGRES_ENV_POSTGRES_PASSWORD=graphql_sequelize_test
export POSTGRES_ENV_POSTGRES_DATABASE=graphql_sequelize_test

export MYSQL_PORT_3306_TCP_ADDR=127.0.0.1
export MYSQL_ENV_MYSQL_USER=test
export MYSQL_ENV_MYSQL_PASSWORD=test
export MYSQL_ENV_MYSQL_DATABASE=test

export MSSQL_PORT_1433_TCP_ADDR=127.0.0.1
export MSSQL_ENV_MSSQL_USER=sa
export MSSQL_ENV_MSSQL_PASSWORD='GqlSeq!Test123'
export MSSQL_ENV_MSSQL_DATABASE=graphql_sequelize_test
