'use strict';

import { expect } from 'chai';
import Sequelize from 'sequelize';
import {
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLInt,
  GraphQLString,
  GraphQLList,
  GraphQLEnumType,
  graphql
} from 'graphql';
import { globalIdField, toGlobalId } from 'graphql-relay';

import resolver from '../../src/resolver';
import { sequelizeConnection, sequelizeNodeInterface } from '../../src/relay';
import {
  sequelize,
  markFilterable,
  beforeRemoveAllTables
} from '../support/helper';

/**
 * Regression coverage.
 *
 * Every spec here pins a defect that was live in the published 0.5.0 artifact
 * and reachable in production. They are grouped in one file because they share
 * a fixture, and each names the behaviour it guards rather than the symptom,
 * so a reintroduction reads as a clear failure.
 */
describe('regressions', function () {
  beforeRemoveAllTables();

  before(async function () {
    this.User = sequelize.define('regressionUser', {
      name: Sequelize.STRING,
      // A VIRTUAL attribute has no column. It used to be added to the
      // GROUP BY, which the database rejected as an unknown column.
      nameUpper: {
        type: Sequelize.VIRTUAL,
        get() {
          return (this.get('name') || '').toUpperCase();
        }
      }
    });

    this.Task = sequelize.define('regressionTask', {
      title: Sequelize.STRING
    });

    this.User.Tasks = this.User.hasMany(this.Task, {
      as: 'tasks',
      foreignKey: 'userId'
    });

    // These specs query and order by primary key, which sequelize generates
    // rather than the fixture declaring it.
    markFilterable(this.User, 'id');
    markFilterable(this.Task, 'id', 'title');

    const node = sequelizeNodeInterface(sequelize);
    this.nodeField = node.nodeField;

    this.taskType = new GraphQLObjectType({
      name: 'RegressionTask',
      fields: {
        // globalIdField, not a plain Int: the Node interface requires id to
        // be ID! and the schema fails validation otherwise.
        id: globalIdField('RegressionTask'),
        title: { type: GraphQLString }
      },
      interfaces: [node.nodeInterface]
    });

    this.taskConnection = sequelizeConnection({
      name: 'regressionTask',
      nodeType: this.taskType,
      target: this.User.Tasks,
      orderBy: new GraphQLEnumType({
        name: 'RegressionTaskOrder',
        values: {
          ID: { value: ['id', 'ASC'] },
          // Exercises the function-valued order attribute, which the resolver
          // used to stringify and reject.
          TITLE_FUNC: { value: [() => 'title', 'ASC'] }
        }
      })
    });

    this.userType = new GraphQLObjectType({
      name: 'RegressionUser',
      fields: () => ({
        id: globalIdField('RegressionUser'),
        name: { type: GraphQLString },
        nameUpper: { type: GraphQLString },
        tasks: {
          type: new GraphQLList(this.taskType),
          args: {
            limit: { type: GraphQLInt },
            order: { type: GraphQLString }
          },
          resolve: resolver(this.User.Tasks)
        },
        taskConnection: {
          type: this.taskConnection.connectionType,
          args: this.taskConnection.connectionArgs,
          resolve: this.taskConnection.resolve
        }
      }),
      interfaces: [node.nodeInterface]
    });

    node.nodeTypeMapper.mapTypes({
      [this.User.name]: { type: this.userType },
      [this.Task.name]: { type: this.taskType }
    });

    this.schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'RegressionRoot',
        fields: {
          node: this.nodeField,
          user: {
            type: this.userType,
            args: { id: { type: GraphQLInt } },
            resolve: resolver(this.User)
          },
          users: {
            type: new GraphQLList(this.userType),
            resolve: resolver(this.User)
          }
        }
      })
    });

    await sequelize.sync({ force: true });

    this.user = await this.User.create(
      {
        name: 'alice',
        tasks: [
          { title: 'c-task' },
          { title: 'a-task' },
          { title: 'b-task' },
          { title: 'd-task' },
          { title: 'e-task' }
        ]
      },
      { include: [this.User.Tasks] }
    );

    // A second user with tasks, so a fan-out bug produces a wrong count
    // rather than coincidentally the right one.
    this.otherUser = await this.User.create(
      {
        name: 'bob',
        tasks: [{ title: 'x-task' }, { title: 'y-task' }]
      },
      { include: [this.User.Tasks] }
    );
  });

  /**
   * Run a query and fail loudly on GraphQL errors rather than returning null
   * data, which several of these defects surfaced as.
   */
  async function run(schema, query) {
    const result = await graphql(schema, query);
    if (result.errors) {
      throw new Error(result.errors[0].stack || result.errors[0].message);
    }

    return result.data;
  }

  it('does not put VIRTUAL attributes in the GROUP BY', async function () {
    // Previously: unknown-column error, because a VIRTUAL attribute has no
    // column but was still grouped on.
    const data = await run(
      this.schema,
      `{ user(id: ${this.user.id}) { name nameUpper } }`
    );

    expect(data.user.nameUpper).to.equal('ALICE');
  });

  it('qualifies GROUP BY columns and stays legal alongside an include', async function () {
    // Previously: "ambiguous column name: id" on sqlite/mysql, and on
    // postgres "column must appear in the GROUP BY clause", because the group
    // listed bare column names while the join selected the same names.
    const data = await run(
      this.schema,
      `{ user(id: ${this.user.id}) { name tasks { title } } }`
    );

    expect(data.user.tasks).to.have.length(5);
  });

  it('resolves node queries against sequelize 6 instances', async function () {
    // Previously: typeResolver read obj.Model / obj._modelOptions, removed
    // after sequelize 3, and fell through to obj.name -- the value of the
    // row's name column -- so every node query resolved to null.
    const globalId = toGlobalId(this.User.name, this.user.id);
    const data = await run(
      this.schema,
      `{ node(id: "${globalId}") { ... on RegressionUser { name } } }`
    );

    expect(data.node).to.not.equal(null);
    expect(data.node.name).to.equal('alice');
  });

  it('applies a connection limit rather than returning every row', async function () {
    // Previously: the parent eagerly included every association, and the
    // child resolver returned that preloaded array verbatim, so first: N was
    // silently ignored and all rows came back.
    const data = await run(
      this.schema,
      `{ user(id: ${this.user.id}) { taskConnection(first: 2) { edges { node { title } } } } }`
    );

    expect(data.user.taskConnection.edges).to.have.length(2);
  });

  it('applies a limit on a plain hasMany association', async function () {
    // Same preloaded-array defect, reached through a non-connection field.
    const data = await run(
      this.schema,
      `{ user(id: ${this.user.id}) { tasks(limit: 2) { title } } }`
    );

    expect(data.user.tasks).to.have.length(2);
  });

  it('honours a caller-supplied order on an eager-loaded association', async function () {
    // Previously: the preloaded array was returned in whatever order the join
    // produced, silently discarding the requested ordering.
    const data = await run(
      this.schema,
      `{ user(id: ${this.user.id}) { tasks(order: "title") { title } } }`
    );

    const titles = data.user.tasks.map((task) => task.title);
    expect(titles).to.deep.equal([...titles].sort());
  });

  it('accepts a function as an order attribute', async function () {
    // Previously: the resolver stringified the function and rejected it with
    // "Unknown order by: <function source>".
    const data = await run(
      this.schema,
      `{ user(id: ${this.user.id}) { taskConnection(first: 5, orderBy: TITLE_FUNC) { edges { node { title } } } } }`
    );

    const titles = data.user.taskConnection.edges.map(({ node }) => node.title);
    expect(titles).to.deep.equal([...titles].sort());
  });

  it('does not mutate the caller\'s orderBy between resolutions', async function () {
    // Previously: order.splice(0, 1) emptied the caller's array, so resolving
    // the same args object a second time threw on undefined.split.
    const query = `{ user(id: ${this.user.id}) { taskConnection(first: 5, orderBy: ID) { edges { node { title } } } } }`;

    const first = await run(this.schema, query);
    const second = await run(this.schema, query);

    expect(second.user.taskConnection.edges).to.have.length(
      first.user.taskConnection.edges.length
    );
  });

  describe('fan-out', function () {
    it('does not multiply parent rows across a joined association', async function () {
      // A LEFT JOIN against a hasMany yields one row per child. Without
      // collapsing, two users with 5 and 2 tasks would come back as 7 rows.
      const data = await run(this.schema, '{ users { name } }');

      expect(data.users).to.have.length(2);
      expect(data.users.map((user) => user.name).sort()).to.deep.equal([
        'alice',
        'bob'
      ]);
    });

    it('keeps each parent\'s children separate when listing', async function () {
      const data = await run(this.schema, '{ users { name tasks { title } } }');

      const byName = {};
      data.users.forEach((user) => {
        byName[user.name] = user.tasks.length;
      });

      expect(byName).to.deep.equal({ alice: 5, bob: 2 });
    });

    it('limits each parent\'s connection independently', async function () {
      // The limit must apply per parent, not once across the whole result.
      const data = await run(
        this.schema,
        '{ users { name taskConnection(first: 2) { edges { node { title } } } } }'
      );

      data.users.forEach((user) => {
        const expected = user.name === 'alice' ? 2 : 2;
        expect(user.taskConnection.edges).to.have.length(expected);
      });
    });

    it('reports a total count that is not inflated by the join', async function () {
      const data = await run(
        this.schema,
        `{ user(id: ${this.user.id}) { taskConnection(first: 2) { edges { node { title } } } } }`
      );

      // Five tasks exist; asking for two must yield two, not two per joined row.
      expect(data.user.taskConnection.edges).to.have.length(2);

      const titles = data.user.taskConnection.edges.map(({ node }) => node.title);
      expect(new Set(titles).size).to.equal(titles.length);
    });
  });

  describe('filtering boundary', function () {
    it('refuses an order on an attribute that is not filterable', async function () {
      // End-to-end counterpart to the authorization unit specs. createdAt is
      // generated by sequelize rather than declared by the fixture, so it is
      // not filterable and must be refused rather than quietly applied.
      expect(this.Task.getAttributes().title.filterable).to.equal(true);
      expect(this.Task.getAttributes().createdAt.filterable).to.not.equal(true);

      const result = await graphql(
        this.schema,
        `{ user(id: ${this.user.id}) { tasks(order: "createdAt") { title } } }`
      );

      expect(result.errors, 'an undeclared attribute must be refused').to.not
        .equal(undefined);
      expect(result.errors[0].message).to.match(/Unknown order by: createdAt/);
    });

    it('allows an order on an attribute that is filterable', async function () {
      const result = await graphql(
        this.schema,
        `{ user(id: ${this.user.id}) { tasks(order: "title") { title } } }`
      );

      expect(result.errors).to.equal(undefined);
    });
  });
});
