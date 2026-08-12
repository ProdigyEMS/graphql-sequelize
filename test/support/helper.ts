import type {
  Dialect,
  Model,
  ModelAttributes,
  ModelOptions,
  ModelStatic,
  Options
} from 'sequelize';
import {QueryTypes, Sequelize as SequelizeInstance} from 'sequelize';
import Bluebird from 'bluebird';
import { beforeAll } from 'vitest';

// Sequelize 6 removed Sequelize.Promise (it uses native promises). The test
// helpers rely on Bluebird-only APIs such as Promise.method, so source it
// from the bluebird dependency directly.
export const Promise = Bluebird;
export const sequelize = createSequelize();

interface TestDatabaseConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
}

/** Build the active integration dialect's connection settings. */
function databaseConfig(dialect: Dialect): TestDatabaseConfig {
  const env = process.env;
  const config: TestDatabaseConfig = {
    host: 'localhost',
    user: 'graphql_sequelize_test',
    password: 'graphql_sequelize_test',
    database: 'graphql_sequelize_test'
  };

  if (dialect === 'postgres') {
    return {
      host: env.POSTGRES_PORT_5432_TCP_ADDR ?? config.host,
      port: Number(env.POSTGRES_PORT_5432_TCP_PORT),
      user: env.POSTGRES_ENV_POSTGRES_USER ?? config.user,
      password: env.POSTGRES_ENV_POSTGRES_PASSWORD ?? config.password,
      database: env.POSTGRES_ENV_POSTGRES_DATABASE ?? config.database
    };
  }

  if (dialect === 'mysql') {
    return {
      host: env.MYSQL_PORT_3306_TCP_ADDR ?? config.host,
      port: Number(env.MYSQL_PORT_3306_TCP_PORT),
      user: env.MYSQL_ENV_MYSQL_USER ?? config.user,
      password: env.MYSQL_ENV_MYSQL_PASSWORD ?? config.password,
      database: env.MYSQL_ENV_MYSQL_DATABASE ?? config.database
    };
  }

  // mssql is the dialect the consuming service actually runs
  // (node/src/db.config.ts sets dialect: 'mssql' over tedious), so it is
  // the one the suite most needs to cover.
  if (dialect === 'mssql') {
    return {
      host: env.MSSQL_PORT_1433_TCP_ADDR ?? config.host,
      port: Number(env.MSSQL_PORT_1433_TCP_PORT),
      user: env.MSSQL_ENV_MSSQL_USER ?? config.user,
      password: env.MSSQL_ENV_MSSQL_PASSWORD ?? config.password,
      database: env.MSSQL_ENV_MSSQL_DATABASE ?? config.database
    };
  }

  return config;
}

/** Create a Sequelize instance for the active integration-test dialect. */
export function createSequelize(options: Options = {}): SequelizeInstance {
  const env = process.env;
  const dialect = (env.DIALECT || 'sqlite') as Dialect;
  const config = databaseConfig(dialect);

  const testSequelize = new SequelizeInstance(
    config.database,
    config.user,
    config.password,
    {
      host: config.host,
      port: config.port ? Number(config.port) : undefined,
      dialect,
      // Set SEQUELIZE_LOGGING=1 to see generated SQL when diagnosing failures.
      logging: env.SEQUELIZE_LOGGING ? console.log : false,
      ...options
    }
  );

  // The resolver only accepts attributes carrying `filterable: true` as
  // where/orderBy targets and rejects everything else.
  //
  // This mirrors how the consuming service declares its models: it marks the
  // business attributes it defines explicitly (className, departmentId, ...)
  // and leaves sequelize's auto-generated columns alone. Marking those
  // auto-generated columns filterable is actively wrong -- opting `id` in on
  // every model produces ambiguous column references once models are joined.
  //
  // Only the keys each fixture passes to define() are opted in, for that
  // reason. Tests needing an auto-generated column (id, createdAt) as a
  // filter target mark it themselves via markFilterable.
  const originalDefine = testSequelize.define.bind(testSequelize);
  testSequelize.define = function <M extends Model>(
    name: string,
    attributes: ModelAttributes<M> = {},
    defineOptions?: ModelOptions<M>
  ): ModelStatic<M> {
    const model = originalDefine(name, attributes, defineOptions);
    markFilterable(model, ...Object.keys(attributes));

    return model as ModelStatic<M>;
  };

  return testSequelize;
}

/**
 * Mark specific attributes of a model filterable.
 *
 * Use this in a fixture when a test filters or orders by a column sequelize
 * generates rather than one the fixture declares -- a primary key, a timestamp
 * or an association's foreign key. Naming them individually keeps the blast
 * radius small; see createSequelize above for why blanket-marking is unsafe.
 */
export function markFilterable<M extends Model>(
  model: ModelStatic<M>,
  ...attributeNames: string[]
): ModelStatic<M> {
  const attributes = model.getAttributes() as Record<
    string,
    { filterable?: boolean }
  >;
  attributeNames.forEach((name) => {
    if (attributes[name]) {
      attributes[name].filterable = true;
    }
  });

  return model;
}

export function beforeRemoveAllTables(): void {
  beforeAll(async function () {
    // Postgres is included as well as MySQL. Both keep their schema in a
    // long-lived server, so tables left behind by one spec file (or by a
    // previous run against the same database) leak into the next and change
    // the result -- re-running against a populated database moved the suite
    // from 11 passing to 9. sqlite is excluded: each run gets a fresh
    // database, so there is nothing to clear.
    if (['mysql', 'postgres', 'mssql'].includes(sequelize.getDialect())) {
      await removeAllTables(sequelize);
    }
  }, 10000);
}

export function delay(ms: number): Bluebird<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Not nice too, MySQL does not supports same name for foreign keys
// Solution ? Force remove all tables!
//
// Dialect-aware: `show tables` is MySQL-only syntax, and the previous
// implementation additionally read a `Tables_in_test` column, hardcoding the
// database name. Postgres lists tables from pg_tables and needs CASCADE to
// drop through foreign keys.
export async function removeAllTables(
  database: SequelizeInstance
): globalThis.Promise<void> {
  const dialect = database.getDialect();

  async function getTables(): globalThis.Promise<string[]> {
    if (dialect === 'mssql') {
      const rows = await database.query<{ name: string }>(
        "SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'",
        {type: QueryTypes.SELECT}
      );

      return rows.map((row) => row.name);
    }

    if (dialect === 'postgres') {
      const rows = await database.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
        {type: QueryTypes.SELECT}
      );

      return rows.map((row) => row.tablename);
    }

    // Read the first column rather than a database-specific alias.
    const tables = await database.query<Record<string, string>>(
      'show tables',
      {type: QueryTypes.SELECT}
    );

    return tables.map((table) => table[Object.keys(table)[0]]);
  }

  async function dropTable(table: string): globalThis.Promise<void> {
    // mssql has no CASCADE on DROP TABLE, so foreign keys must be removed
    // first; the repeated getTables() pass below then retries whatever the
    // remaining references blocked.
    if (dialect === 'mssql') {
      try {
        await database.query(
          `DECLARE @sql NVARCHAR(MAX) = N'';
           SELECT @sql += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id))
             + '.' + QUOTENAME(OBJECT_NAME(parent_object_id))
             + ' DROP CONSTRAINT ' + QUOTENAME(name) + ';'
           FROM sys.foreign_keys WHERE OBJECT_NAME(referenced_object_id) = N'${table}';
           EXEC sp_executesql @sql;`
        );
        await database.query(`DROP TABLE IF EXISTS [${table}]`);
      } catch (error) {
        // References from another table are expected here. The outer retry
        // pass removes the table after its remaining dependencies are gone.
        if (process.env.SEQUELIZE_LOGGING) {
          console.warn(`Deferred dropping table ${table}.`, error);
        }
      }

      return;
    }

    const quoted =
      dialect === 'postgres' ? `"${table}"` : '`' + table + '`';
    const cascade = dialect === 'postgres' ? ' CASCADE' : '';

    try {
      await database.query(`drop table if exists ${quoted}${cascade}`);
    } catch (error) {
      // A later pass retries tables whose foreign-key dependencies still
      // existed during this pass.
      if (process.env.SEQUELIZE_LOGGING) {
        console.warn(`Deferred dropping table ${table}.`, error);
      }
    }
  }

  const tables = await getTables();

  // Sequentially, not Promise.all: concurrent `DROP TABLE ... CASCADE`
  // statements take AccessExclusiveLocks on each other's foreign-key
  // constraints and postgres kills one with "deadlock detected".
  for (const table of tables) {
    await dropTable(table);
  }

  if ((await getTables()).length > 0) {
    await removeAllTables(database);
  }
}
