import Sequelize from 'sequelize';
import Bluebird from 'bluebird';

// Sequelize 6 removed Sequelize.Promise (it uses native promises). The test
// helpers rely on Bluebird-only APIs such as Promise.method, so source it
// from the bluebird dependency directly.
export const Promise = Bluebird;
export const sequelize = createSequelize();

export function createSequelize(options = {}) {
  const env = process.env;
  const dialect = env.DIALECT || 'sqlite';
  const config = Object.assign(
    {
      host: 'localhost',
      user: 'graphql_sequelize_test',
      password: 'graphql_sequelize_test',
      database: 'graphql_sequelize_test'
    },
    dialect === 'postgres' && {
      host: env.POSTGRES_PORT_5432_TCP_ADDR,
      user: env.POSTGRES_ENV_POSTGRES_USER,
      password: env.POSTGRES_ENV_POSTGRES_PASSWORD,
      database: env.POSTGRES_ENV_POSTGRES_DATABASE
    },
    dialect === 'mysql' && {
      host: env.MYSQL_PORT_3306_TCP_ADDR,
      user: env.MYSQL_ENV_MYSQL_USER,
      password: env.MYSQL_ENV_MYSQL_PASSWORD,
      database: env.MYSQL_ENV_MYSQL_DATABASE
    },
    dialect === 'postgres' && env.CI && {
      user: 'postgres',
      password: '',
      database: 'test'
    },
    dialect === 'mysql' && env.CI && {
      user: 'travis',
      password: '',
      database: 'test'
    }
  );

  const sequelize = new Sequelize(config.database, config.user, config.password, {
    host: config.host,
    dialect: dialect,
    // Set SEQUELIZE_LOGGING=1 to see generated SQL when diagnosing failures.
    logging: env.SEQUELIZE_LOGGING ? console.log : false,
    ...options
  });

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
  const originalDefine = sequelize.define.bind(sequelize);
  sequelize.define = function (name, attributes = {}, defineOptions) {
    const model = originalDefine(name, attributes, defineOptions);
    markFilterable(model, ...Object.keys(attributes));

    return model;
  };

  return sequelize;
}

/**
 * Mark specific attributes of a model filterable.
 *
 * Use this in a fixture when a test filters or orders by a column sequelize
 * generates rather than one the fixture declares -- a primary key, a timestamp
 * or an association's foreign key. Naming them individually keeps the blast
 * radius small; see createSequelize above for why blanket-marking is unsafe.
 */
export function markFilterable(model, ...attributeNames) {
  const attributes = model.getAttributes();
  attributeNames.forEach((name) => {
    if (attributes[name]) {
      attributes[name].filterable = true;
    }
  });

  return model;
}

export function beforeRemoveAllTables() {
  before(function () {
    // Postgres is included as well as MySQL. Both keep their schema in a
    // long-lived server, so tables left behind by one spec file (or by a
    // previous run against the same database) leak into the next and change
    // the result -- re-running against a populated database moved the suite
    // from 11 passing to 9. sqlite is excluded: each run gets a fresh
    // database, so there is nothing to clear.
    if (['mysql', 'postgres'].includes(sequelize.dialect.name)) {
      this.timeout(10000);
      return removeAllTables(sequelize);
    }
  });
}

// Not nice too, MySQL does not supports same name for foreign keys
// Solution ? Force remove all tables!
//
// Dialect-aware: `show tables` is MySQL-only syntax, and the previous
// implementation additionally read a `Tables_in_test` column, hardcoding the
// database name. Postgres lists tables from pg_tables and needs CASCADE to
// drop through foreign keys.
export function removeAllTables(sequelize) {
  const dialect = sequelize.dialect.name;

  function getTables() {
    if (dialect === 'postgres') {
      return sequelize
        .query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        .then(([rows]) => rows.map((row) => row.tablename));
    }

    // Read the first column rather than a database-specific alias.
    return sequelize
      .query('show tables')
      .then((tables) => tables[0].map((table) => table[Object.keys(table)[0]]));
  }

  function dropTable(table) {
    const quoted =
      dialect === 'postgres' ? `"${table}"` : '`' + table + '`';
    const cascade = dialect === 'postgres' ? ' CASCADE' : '';

    return sequelize
      .query(`drop table if exists ${quoted}${cascade}`)
      .catch(() => {});
  }

  return getTables()
    .then(tables => {
      // Sequentially, not Promise.all: concurrent `DROP TABLE ... CASCADE`
      // statements take AccessExclusiveLocks on each other's foreign-key
      // constraints and postgres kills one with "deadlock detected".
      return tables.reduce(
        (chain, table) => chain.then(() => dropTable(table)),
        Promise.resolve()
      );
    })
    .then(() => {
      return getTables();
    })
    .then(tables => {
      if (tables.length) {
        return removeAllTables(sequelize);
      }
    });
}
