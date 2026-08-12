import { beforeAll, describe, expect, it } from 'vitest';
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

import resolver from '../../src/resolver.js';
import { sequelizeConnection, sequelizeNodeInterface } from '../../src/relay.js';
import {
  sequelize,
  markFilterable,
  beforeRemoveAllTables
} from '../support/helper.js';

type RegressionModel = ReturnType<typeof sequelize.define>;
type RegressionAssociation = ReturnType<RegressionModel['hasMany']>;

interface RegressionState {
  User: RegressionModel & { Tasks: RegressionAssociation };
  Task: RegressionModel;
  nodeField: ReturnType<typeof sequelizeNodeInterface>['nodeField'];
  taskType: GraphQLObjectType;
  taskConnection: ReturnType<typeof sequelizeConnection>;
  plainTaskConnection: ReturnType<typeof connectionDefinitions>;
  userType: GraphQLObjectType;
  schema: GraphQLSchema;
  user: Awaited<ReturnType<RegressionModel['create']>>;
  otherUser: Awaited<ReturnType<RegressionModel['create']>>;
}

const state = {} as RegressionState;

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

  beforeAll(async function () {
    state.User = sequelize.define('regressionUser', {
      name: Sequelize.STRING,
      // A VIRTUAL attribute has no column. It used to be added to the
      // GROUP BY, which the database rejected as an unknown column.
      nameUpper: {
        type: Sequelize.VIRTUAL,
        get() {
          return (this.get('name') || '').toUpperCase();
        }
      }
    }) as RegressionState['User'];

    state.Task = sequelize.define('regressionTask', {
      title: Sequelize.STRING
    });

    state.User.Tasks = state.User.hasMany(state.Task, {
      as: 'tasks',
      foreignKey: 'userId'
    });

    // These specs query and order by primary key, which sequelize generates
    // rather than the fixture declaring it.
    markFilterable(state.User, 'id');
    markFilterable(state.Task, 'id', 'title');

    const node = sequelizeNodeInterface(sequelize);
    state.nodeField = node.nodeField;

    state.taskType = new GraphQLObjectType({
      name: 'RegressionTask',
      fields: {
        // globalIdField, not a plain Int: the Node interface requires id to
        // be ID! and the schema fails validation otherwise.
        id: globalIdField('RegressionTask'),
        title: { type: GraphQLString }
      },
      interfaces: [node.nodeInterface]
    });

    state.taskConnection = sequelizeConnection({
      name: 'regressionTask',
      nodeType: state.taskType,
      target: state.User.Tasks,
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
    state.plainTaskConnection = connectionDefinitions({
      name: 'RegressionPlainTask',
      nodeType: state.taskType
    });

    state.userType = new GraphQLObjectType({
      name: 'RegressionUser',
      fields: () => ({
        id: globalIdField('RegressionUser'),
        name: { type: GraphQLString },
        nameUpper: { type: GraphQLString },
        plainTasks: {
          type: state.plainTaskConnection.connectionType,
          args: connectionArgs,
          resolve: resolver(state.User.Tasks)
        },
        tasks: {
          type: new GraphQLList(state.taskType),
          args: {
            limit: { type: GraphQLInt },
            order: { type: GraphQLString }
          },
          resolve: resolver(state.User.Tasks)
        },
        taskConnection: {
          type: state.taskConnection.connectionType,
          args: state.taskConnection.connectionArgs,
          resolve: state.taskConnection.resolve
        }
      }),
      interfaces: [node.nodeInterface]
    });

    node.nodeTypeMapper.mapTypes({
      [state.User.name]: { type: state.userType },
      [state.Task.name]: { type: state.taskType }
    });

    state.schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'RegressionRoot',
        fields: {
          node: state.nodeField,
          user: {
            type: state.userType,
            args: { id: { type: GraphQLInt } },
            resolve: resolver(state.User)
          },
          users: {
            type: new GraphQLList(state.userType),
            resolve: resolver(state.User)
          }
        }
      })
    });

    await sequelize.sync({ force: true });

    state.user = await state.User.create(
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
      { include: [state.User.Tasks] }
    );

    // A second user with tasks, so a fan-out bug produces a wrong count
    // rather than coincidentally the right one.
    state.otherUser = await state.User.create(
      {
        name: 'bob',
        tasks: [{ title: 'x-task' }, { title: 'y-task' }]
      },
      { include: [state.User.Tasks] }
    );
  });

  /**
   * Run a query and fail loudly on GraphQL errors rather than returning null
   * data, which several of these defects surfaced as.
   */
  async function run(
    schema: GraphQLSchema,
    query: string
  ) {
    const result = await graphql({ schema, source: query });
    if (result.errors) {
      throw new Error(result.errors[0].stack || result.errors[0].message);
    }

    return result.data;
  }

  it('does not put VIRTUAL attributes in the GROUP BY', async function () {
    // Previously: unknown-column error, because a VIRTUAL attribute has no
    // column but was still grouped on.
    const data = await run(
      state.schema,
      `{ user(id: ${state.user.id}) { name nameUpper } }`
    );

    expect(data.user.nameUpper).to.equal('ALICE');
  });

  it('qualifies GROUP BY columns and stays legal alongside an include', async function () {
    // Previously: "ambiguous column name: id" on sqlite/mysql, and on
    // postgres "column must appear in the GROUP BY clause", because the group
    // listed bare column names while the join selected the same names.
    const data = await run(
      state.schema,
      `{ user(id: ${state.user.id}) { name tasks { title } } }`
    );

    expect(data.user.tasks).to.have.length(5);
  });

  it('resolves node queries against sequelize 6 instances', async function () {
    // Previously: typeResolver read obj.Model / obj._modelOptions, removed
    // after sequelize 3, and fell through to obj.name -- the value of the
    // row's name column -- so every node query resolved to null.
    const globalId = toGlobalId(state.User.name, state.user.id);
    const data = await run(
      state.schema,
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
      state.schema,
      `{ user(id: ${state.user.id}) { taskConnection(first: 2) { edges { node { title } } } } }`
    );

    expect(data.user.taskConnection.edges).to.have.length(2);
  });

  it('applies a limit on a plain hasMany association', async function () {
    // Same preloaded-array defect, reached through a non-connection field.
    const data = await run(
      state.schema,
      `{ user(id: ${state.user.id}) { tasks(limit: 2) { title } } }`
    );

    expect(data.user.tasks).to.have.length(2);
  });

  it('honours a caller-supplied order on an eager-loaded association', async function () {
    // Previously: the preloaded array was returned in whatever order the join
    // produced, silently discarding the requested ordering.
    const data = await run(
      state.schema,
      `{ user(id: ${state.user.id}) { tasks(order: "title") { title } } }`
    );

    const titles = data.user.tasks.map((task) => task.title);
    expect(titles).to.deep.equal([...titles].sort());
  });

  it('accepts a function as an order attribute', async function () {
    // Previously: the resolver stringified the function and rejected it with
    // "Unknown order by: <function source>".
    const data = await run(
      state.schema,
      `{ user(id: ${state.user.id}) { taskConnection(first: 5, orderBy: TITLE_FUNC) { edges { node { title } } } } }`
    );

    const titles = data.user.taskConnection.edges.map(({ node }) => node.title);
    expect(titles).to.deep.equal([...titles].sort());
  });

  it('does not mutate the caller\'s orderBy between resolutions', async function () {
    // Previously: order.splice(0, 1) emptied the caller's array, so resolving
    // the same args object a second time threw on undefined.split.
    const query = `{ user(id: ${state.user.id}) { taskConnection(first: 5, orderBy: ID) { edges { node { title } } } } }`;

    const first = await run(state.schema, query);
    const second = await run(state.schema, query);

    expect(second.user.taskConnection.edges).to.have.length(
      first.user.taskConnection.edges.length
    );
  });

  describe('fan-out', function () {
    it('does not multiply parent rows across a joined association', async function () {
      // A LEFT JOIN against a hasMany yields one row per child. Without
      // collapsing, two users with 5 and 2 tasks would come back as 7 rows.
      const data = await run(state.schema, '{ users { name } }');

      expect(data.users).to.have.length(2);
      expect(data.users.map((user) => user.name).sort()).to.deep.equal([
        'alice',
        'bob'
      ]);
    });

    it('keeps each parent\'s children separate when listing', async function () {
      const data = await run(state.schema, '{ users { name tasks { title } } }');

      const byName = {};
      data.users.forEach((user) => {
        byName[user.name] = user.tasks.length;
      });

      expect(byName).to.deep.equal({ alice: 5, bob: 2 });
    });

    it('limits each parent\'s connection independently', async function () {
      // The limit must apply per parent, not once across the whole result.
      const data = await run(
        state.schema,
        '{ users { name taskConnection(first: 2) { edges { node { title } } } } }'
      );

      const connectionSizesByUser = Object.fromEntries(
        data.users.map((user) => [
          user.name,
          user.taskConnection.edges.length
        ])
      );
      expect(connectionSizesByUser).to.deep.equal({alice: 2, bob: 2});
    });

    it('reports a total count that is not inflated by the join', async function () {
      const data = await run(
        state.schema,
        `{ user(id: ${state.user.id}) { taskConnection(first: 2) { edges { node { title } } } } }`
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
        state.User,
        state.Task,
        state.User.Tasks,
        state.user.id
      );

      const preloaded = parent[state.User.Tasks.as].map((task) => task.get('id'));
      expect(
        preloaded,
        'fixture must hand the resolver an out-of-order array'
      ).to.not.deep.equal([...preloaded].sort((a, b) => a - b));

      const result = await resolver(state.User.Tasks)(
        parent,
        {},
        {},
        resolveInfo(new GraphQLList(state.taskType))
      );

      const ids = result.map((task) => task.get('id'));
      expect(ids).to.deep.equal([...ids].sort((a, b) => a - b));
    });

    it('slices a plain connection from primary-key order, not join order', async function () {
      // The user-visible damage: a relay cursor is positional, so slicing a
      // reverse-ordered array returned the last rows while reporting them as
      // the first page.
      const parent = await loadParentWithReversedChildren(
        state.User,
        state.Task,
        state.User.Tasks,
        state.user.id
      );

      const ascendingIds = parent[state.User.Tasks.as]
        .map((task) => task.get('id'))
        .sort((a, b) => a - b);

      const result = await resolver(state.User.Tasks)(
        parent,
        { first: 2 },
        {},
        resolveInfo(state.plainTaskConnection.connectionType)
      );

      expect(result.edges.map(({ node }) => node.get('id'))).to.deep.equal(
        ascendingIds.slice(0, 2)
      );
    });

    it('returns no children when a preloaded association has limit zero', async function () {
      const parent = await loadParentWithReversedChildren(
        state.User,
        state.Task,
        state.User.Tasks,
        state.user.id
      );

      expect(parent[state.User.Tasks.as]).to.have.length.above(0);

      const result = await resolver(state.User.Tasks)(
        parent,
        { limit: 0 },
        {},
        resolveInfo(new GraphQLList(state.taskType))
      );

      expect(result).to.deep.equal([]);
    });

    it('transforms an empty limited association as a connection', async function () {
      const parent = await loadParentWithReversedChildren(
        state.User,
        state.Task,
        state.User.Tasks,
        state.user.id
      );
      let connectionPassedToAfter;
      const transformedResult = await resolver(state.User.Tasks, {
        after(connection) {
          connectionPassedToAfter = connection;

          return {edgeCount: connection.edges.length};
        }
      })(
        parent,
        {limit: 0},
        {},
        resolveInfo(state.plainTaskConnection.connectionType)
      );

      expect(connectionPassedToAfter.edges).to.deep.equal([]);
      expect(transformedResult).to.deep.equal({edgeCount: 0});
    });

    it('does not reorder the parent instance in place', async function () {
      // The array belongs to the parent, so sorting it in place would be
      // visible to anything else holding that instance.
      const parent = await loadParentWithReversedChildren(
        state.User,
        state.Task,
        state.User.Tasks,
        state.user.id
      );

      const before = parent[state.User.Tasks.as].map((task) => task.get('id'));

      await resolver(state.User.Tasks)(
        parent,
        {},
        {},
        resolveInfo(new GraphQLList(state.taskType))
      );

      expect(
        parent[state.User.Tasks.as].map((task) => task.get('id'))
      ).to.deep.equal(before);
    });
  });

  describe('filtering boundary', function () {
    it('refuses an order on an attribute that is not filterable', async function () {
      // End-to-end counterpart to the authorization unit specs. createdAt is
      // generated by sequelize rather than declared by the fixture, so it is
      // not filterable and must be refused rather than quietly applied.
      expect(state.Task.getAttributes().title.filterable).to.equal(true);
      expect(state.Task.getAttributes().createdAt.filterable).to.not.equal(true);

      const result = await graphql({
        schema: state.schema,
        source: `{ user(id: ${state.user.id}) { tasks(order: "createdAt") { title } } }`
      });

      expect(result.errors, 'an undeclared attribute must be refused').to.not
        .equal(undefined);
      expect(result.errors[0].message).to.match(/Unknown order by: createdAt/);
    });

    it('allows an order on an attribute that is filterable', async function () {
      const result = await graphql({
        schema: state.schema,
        source: `{ user(id: ${state.user.id}) { tasks(order: "title") { title } } }`
      });

      expect(result.errors).to.equal(undefined);
    });
  });
});
