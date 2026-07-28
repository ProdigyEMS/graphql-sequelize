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
import {
  globalIdField,
  toGlobalId,
  connectionArgs,
  connectionDefinitions
} from 'graphql-relay';

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

    // A plain graphql-relay connection, deliberately NOT sequelizeConnection:
    // it has no ordering of its own and slices the resolver's result array in
    // memory, which is the shape that exposed the unordered-eager-load defect.
    // The field name also differs from the association alias ('tasks' vs the
    // sequelize alias), which is what stopped it being recognised as a
    // connection and left it eager-loaded in the first place.
    this.plainTaskConnection = connectionDefinitions({
      name: 'RegressionPlainTask',
      nodeType: this.taskType
    });

    this.userType = new GraphQLObjectType({
      name: 'RegressionUser',
      fields: () => ({
        id: globalIdField('RegressionUser'),
        name: { type: GraphQLString },
        nameUpper: { type: GraphQLString },
        plainTasks: {
          type: this.plainTaskConnection.connectionType,
          args: connectionArgs,
          resolve: resolver(this.User.Tasks)
        },
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

  describe('eager-loaded association ordering', function () {
    /**
     * Load the parent with its association deliberately in descending primary
     * key order, so the preloaded array disagrees with the order the resolver
     * is required to produce.
     *
     * Scrambling the physical rows and hoping the planner returns them in that
     * order does not work -- it stays free to use an index and hand back
     * primary key order anyway, which makes the assertion pass whether or not
     * the fix is present. Setting the include order explicitly removes the
     * planner from the question: the array reaching the resolver is known-bad
     * by construction, so the assertion tests the resolver rather than the
     * database.
     */
    async function loadParentWithReversedChildren(User, Task, association, id) {
      return User.findOne({
        where: { id },
        include: [{ model: Task, as: association.as }],
        order: [[{ model: Task, as: association.as }, 'id', 'DESC']]
      });
    }

    /**
     * Minimal GraphQLResolveInfo. The resolver reads returnType to decide
     * whether it is resolving a list or a connection; nothing else on info is
     * touched on this path.
     */
    function resolveInfo(returnType) {
      return { returnType };
    }

    it('returns a preloaded list in primary-key order', async function () {
      const parent = await loadParentWithReversedChildren(
        this.User,
        this.Task,
        this.User.Tasks,
        this.user.id
      );

      const preloaded = parent[this.User.Tasks.as].map((task) => task.get('id'));
      expect(
        preloaded,
        'fixture must hand the resolver an out-of-order array'
      ).to.not.deep.equal([...preloaded].sort((a, b) => a - b));

      const result = await resolver(this.User.Tasks)(
        parent,
        {},
        {},
        resolveInfo(new GraphQLList(this.taskType))
      );

      const ids = result.map((task) => task.get('id'));
      expect(ids).to.deep.equal([...ids].sort((a, b) => a - b));
    });

    it('slices a plain connection from primary-key order, not join order', async function () {
      // The user-visible damage: a relay cursor is positional, so slicing a
      // reverse-ordered array returned the last rows while reporting them as
      // the first page.
      const parent = await loadParentWithReversedChildren(
        this.User,
        this.Task,
        this.User.Tasks,
        this.user.id
      );

      const ascendingIds = parent[this.User.Tasks.as]
        .map((task) => task.get('id'))
        .sort((a, b) => a - b);

      const result = await resolver(this.User.Tasks)(
        parent,
        { first: 2 },
        {},
        resolveInfo(this.plainTaskConnection.connectionType)
      );

      expect(result.edges.map(({ node }) => node.get('id'))).to.deep.equal(
        ascendingIds.slice(0, 2)
      );
    });

    it('does not reorder the parent instance in place', async function () {
      // The array belongs to the parent, so sorting it in place would be
      // visible to anything else holding that instance.
      const parent = await loadParentWithReversedChildren(
        this.User,
        this.Task,
        this.User.Tasks,
        this.user.id
      );

      const before = parent[this.User.Tasks.as].map((task) => task.get('id'));

      await resolver(this.User.Tasks)(
        parent,
        {},
        {},
        resolveInfo(new GraphQLList(this.taskType))
      );

      expect(
        parent[this.User.Tasks.as].map((task) => task.get('id'))
      ).to.deep.equal(before);
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
