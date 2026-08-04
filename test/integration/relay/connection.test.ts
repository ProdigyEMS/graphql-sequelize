import {beforeAll, describe, expect, it, vi} from 'vitest';
import Sequelize from 'sequelize';
import attributeFields from '../../../src/attributeFields.js';
import resolver from '../../../src/resolver.js';
import lodash from 'lodash';
import { Promise, sequelize, markFilterable, beforeRemoveAllTables } from '../../support/helper.js';

import {
  sequelizeConnection,
  createConnectionResolver
} from '../../../src/relay.js';

import {
  GraphQLInt,
  GraphQLNonNull,
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLList,
  GraphQLObjectType,
  GraphQLSchema,
  graphql
} from 'graphql';

import {
  globalIdField,
  toGlobalId,
  fromGlobalId
} from 'graphql-relay';

const {uniq, property, sortBy} = lodash;

type ConnectionModel = ReturnType<typeof sequelize.define>;
type ConnectionInstance = Awaited<ReturnType<ConnectionModel['create']>>;
type HasManyAssociation = ReturnType<ConnectionModel['hasMany']>;
type BelongsToAssociation = ReturnType<ConnectionModel['belongsTo']>;
type BelongsToManyAssociation = ReturnType<ConnectionModel['belongsToMany']>;

interface ConnectionState {
  User: ConnectionModel & {
    Tasks: HasManyAssociation;
    Projects: BelongsToManyAssociation;
  };
  Project: ConnectionModel & {
    Tasks: HasManyAssociation;
    Owner: BelongsToAssociation;
  };
  Task: ConnectionModel & { Project: BelongsToAssociation };
  ProjectMember: ConnectionModel;
  taskType: GraphQLObjectType;
  projectOrderSpy: ReturnType<typeof vi.fn>;
  projectTaskConnectionFieldSpy: ReturnType<typeof vi.fn>;
  projectTaskConnection: ReturnType<typeof sequelizeConnection>;
  projectType: GraphQLObjectType;
  userTaskConnectionFieldSpy: ReturnType<typeof vi.fn>;
  userTaskConnection: ReturnType<typeof sequelizeConnection>;
  orderByEnum: GraphQLEnumType;
  userProjectConnection: ReturnType<typeof sequelizeConnection>;
  userProjectConnection2: GraphQLObjectType;
  userProjectConnection2Resolver: ReturnType<typeof createConnectionResolver>;
  userType: GraphQLObjectType;
  viewerTaskConnection: ReturnType<typeof sequelizeConnection>;
  viewerType: GraphQLObjectType;
  schema: GraphQLSchema;
  taskId: number;
  projectA: ConnectionInstance;
  projectB: ConnectionInstance;
  projectC: ConnectionInstance;
  projectD: ConnectionInstance;
  projectE: ConnectionInstance;
  userA: ConnectionInstance;
  userB: ConnectionInstance;
}

const state = {} as ConnectionState;

/**
 * Fail a GraphQL integration query with the underlying database message and
 * the ordered SQL that triggered it.
 *
 * @param {Object} result GraphQL execution result
 * @param {Function} sqlSpy query logger spy
 * @return {void}
 */
function throwOnGraphQlErrors(
  result: Awaited<ReturnType<typeof graphql>>,
  sqlSpy: ReturnType<typeof vi.fn>
): void {
  if (!result.errors) {
    return;
  }

  const graphQlError = result.errors[0];
  const originalError = graphQlError.originalError || graphQlError;
  const databaseError = originalError.parent || originalError.original || originalError;
  const loggedSql = sqlSpy.mock.calls.map(([sql]) => String(sql));
  const orderSql = loggedSql.find((sql) => sql.includes('NULLS')) ||
    [...loggedSql].reverse().find((sql) => sql.includes('ORDER BY'));

  throw new Error(`${databaseError.message}\nSQL: ${orderSql || 'unavailable'}`);
}

/**
 * Return the qualified task column as emitted by the active dialect.
 *
 * @param {String} dialect sequelize dialect name
 * @param {String} column task column name
 * @return {String} qualified and quoted column
 */
function quotedTaskColumn(dialect: string, column: string): string {
  if (dialect === 'mssql') {
    return `[task].[${column}]`;
  }
  if (dialect === 'postgres') {
    return `"task"."${column}"`;
  }

  return `\`task\`.\`${column}\``;
}

describe('relay', function () {
  describe('connection', function () {
    beforeRemoveAllTables();

    beforeAll(async () => {
      const fixture = state;

      state.User = sequelize.define('user', {}) as ConnectionState['User'];

      state.Project = sequelize.define(
        'project',
        {}
      ) as ConnectionState['Project'];

      state.Task = sequelize.define('task', {
        name: Sequelize.STRING,
        completed: Sequelize.BOOLEAN,
        otherDate: Sequelize.DATE
      }, {
        timestamps: true
      }) as ConnectionState['Task'];

      state.ProjectMember = sequelize.define('projectMember', {});

      state.User.Tasks = state.User.hasMany(state.Task, {as: 'tasks', foreignKey: 'userId'});
      state.User.Projects = state.User.belongsToMany(state.Project, {as: 'projects', through: state.ProjectMember});
      state.Project.belongsToMany(state.User, {through: state.ProjectMember});

      state.Project.Tasks = state.Project.hasMany(state.Task, {as: 'tasks', foreignKey: 'projectId'});
      state.Task.Project = state.Task.belongsTo(state.Project, {as: 'project', foreignKey: 'projectId'});

      state.Project.Owner = state.Project.belongsTo(state.User, {as: 'owner', foreignKey: 'ownerId'});

      // The connection specs order by createdAt, which sequelize generates
      // rather than the fixture declaring it, so opt it in explicitly.
      markFilterable(state.Task, 'createdAt', 'updatedAt', 'id');
      markFilterable(state.User, 'id');
      markFilterable(state.Project, 'id');

      state.taskType = new GraphQLObjectType({
        name: state.Task.name,
        fields: {
          ...attributeFields(state.Task),
          id: globalIdField(state.Task.name)
        }
      });

      state.projectOrderSpy = vi.fn(() => 'name');
      state.projectTaskConnectionFieldSpy = vi.fn();
      state.projectTaskConnection = sequelizeConnection({
        name: 'projectTask',
        nodeType: state.taskType,
        target: state.Project.Tasks,
        orderBy: new GraphQLEnumType({
          name: state.Project.name + state.Task.name + 'ConnectionOrder',
          values: {
            ID: {value: [state.Task.primaryKeyAttribute, 'ASC']},
            LATEST: {value: ['createdAt', 'DESC']},
            NAME: {value: ['name', 'ASC']},
            NAME_FUNC: {value: [state.projectOrderSpy, 'ASC']},
            NAME_NULLS_LAST: {value: ['name', 'ASC NULLS LAST']}
          }
        }),
        connectionFields: () => ({
          totalCount: {
            type: GraphQLInt,
            resolve: function (connection, args, {logging}) {
              fixture.projectTaskConnectionFieldSpy(connection);
              return connection.source.countTasks({
                where: connection.where,
                logging: logging
              });
            }
          }
        }),
      });

      state.projectType = new GraphQLObjectType({
        name: state.Project.name,
        fields: {
          ...attributeFields(state.Project),
          id: globalIdField(state.Project.name),
          tasks: {
            type: state.projectTaskConnection.connectionType,
            args: state.projectTaskConnection.connectionArgs,
            resolve: state.projectTaskConnection.resolve
          }
        }
      });

      state.userTaskConnectionFieldSpy = vi.fn();
      state.userTaskConnection = sequelizeConnection({
        name: 'userTask',
        nodeType: state.taskType,
        target: () => state.User.Tasks,
        orderBy: new GraphQLEnumType({
          name: state.User.name + state.Task.name + 'ConnectionOrder',
          values: {
            ID: {value: [state.Task.primaryKeyAttribute, 'ASC']},
            LATEST: {value: ['createdAt', 'DESC']},
            CUSTOM: {value: ['updatedAt', 'DESC']},
            NAME: {value: ['name', 'ASC']}
          }
        }),
        before: (options) => {
          options.raw = true;
          if (options.order && options.order[0][0] === 'updatedAt') {
            // Columns are qualified with the table alias: this connection
            // joins projects, which also has createdAt/updatedAt, and an
            // unqualified reference fails with "column reference
            // \"createdAt\" is ambiguous".
            //
            // Identifiers are quoted through the dialect's own query
            // generator rather than hardcoded per dialect. Each engine quotes
            // differently -- "x" on postgres, `x` on mysql/sqlite, [x] on
            // mssql -- and the previous postgres/else split silently handed
            // mssql the MySQL backtick form.
            const queryInterface = sequelize.getQueryInterface();
            const queryGenerator =
              queryInterface.queryGenerator || queryInterface.QueryGenerator;
            const col = (name) =>
              `${queryGenerator.quoteIdentifier('task')}.${queryGenerator.quoteIdentifier(name)}`;

            // mssql has no boolean literal; `completed` is a BIT there.
            const isTrue =
              sequelize.dialect.name === 'mssql' ? '1' : 'true';

            // Single line: sequelize's mssql dialect rewrites order + limit
            // into OFFSET/FETCH and mangles a multi-line literal, emitting a
            // stray fragment ahead of its own ORDER BY.
            // Wrapped in an array, which is sequelize's documented order
            // form. Passed bare, the mssql dialect does not recognise it as
            // the ordering for OFFSET/FETCH pagination and appends a second
            // ORDER BY of its own, producing invalid SQL.
            options.order = [
              Sequelize.literal(
                `CASE WHEN ${col('completed')} = ${isTrue} THEN ${col('createdAt')} ELSE ${col('otherDate')} END ASC`
              )
            ];
          }
          return options;
        },
        connectionFields: () => ({
          totalCount: {
            type: GraphQLInt,
            resolve: function (connection, args, { logging }) {
              fixture.userTaskConnectionFieldSpy(connection);
              return connection.source.countTasks({
                where: connection.where,
                logging: logging
              });
            }
          }
        }),
        where: (key, value, prevWhere) => {
          if (key === 'completed') {
            value = !!value;
          }
          if (key === 'timeRangeOne') {
            const existingWhere = prevWhere.createdAt || {};
            return {
              createdAt: {
                ...existingWhere,
                gte: new Date(now - 36000)
              }
            };
          }
          if (key === 'timeRangeTwo') {
            const existingWhere = prevWhere.createdAt || {};
            return {
              createdAt: {
                ...existingWhere,
                lte: new Date(now - 24000)
              }
            };
          }
          return {[key]: value};
        }
      });

      state.orderByEnum = new GraphQLEnumType({
        name: state.User.name + state.Project.name + 'ConnectionOrder',
        values: {
          ID: {value: [state.Project.primaryKeyAttribute, 'ASC']},
          LATEST: {value: [state.Project.primaryKeyAttribute, 'DESC']}
        }
      });

      state.userProjectConnection = sequelizeConnection({
        name: 'userProject',
        nodeType: state.projectType,
        target: state.User.Projects,
        orderBy: state.orderByEnum,
        edgeFields: {
          isOwner: {
            type: GraphQLBoolean,
            resolve: function (edge) {
              return edge.node.ownerId === edge.source.id;
            }
          }
        }
      });

      state.userProjectConnection2 = new GraphQLObjectType({
        name: 'UserProjectConnection2',
        fields: {
          edges: {
            type: new GraphQLList(new GraphQLObjectType({
              name: 'UserProjectEdge2',
              fields: {
                node: {
                  type: state.projectType,
                }
              }
            })),
          }
        }
      });

      state.userProjectConnection2Resolver = createConnectionResolver({
        target: state.User.Projects,
        orderBy: state.orderByEnum.name,
      });

      state.userType = new GraphQLObjectType({
        name: state.User.name,
        fields: {
          ...attributeFields(state.User),
          id: globalIdField(state.User.name),
          tasks: {
            type: state.userTaskConnection.connectionType,
            args: {
              ...state.userTaskConnection.connectionArgs,
              completed: {
                type: GraphQLBoolean
              },
              timeRangeOne: {
                type: GraphQLBoolean
              },
              timeRangeTwo: {
                type: GraphQLBoolean
              }
            },
            resolve: state.userTaskConnection.resolve
          },
          projects: {
            type: state.userProjectConnection.connectionType,
            args: state.userProjectConnection.connectionArgs,
            resolve: state.userProjectConnection.resolve
          },
          projects2: {
            type: state.userProjectConnection2,
            args: state.userProjectConnection.connectionArgs,
            resolve: state.userProjectConnection2Resolver.resolveConnection,
          },
        }
      });
      state.viewerTaskConnection = sequelizeConnection({
        name: 'Viewer' + state.Task.name,
        nodeType: state.taskType,
        target: state.Task,
        orderBy: new GraphQLEnumType({
          name: 'Viewer' + state.Task.name + 'ConnectionOrder',
          values: {
            ID: {value: [state.Task.primaryKeyAttribute, 'ASC']}
          }
        }),
        before: (options, args, {viewer}) => {
          options.where = options.where || {};
          options.where.userId = viewer.get('id');
          return options;
        }
      });
      state.viewerType = new GraphQLObjectType({
        name: 'Viewer',
        fields: {
          tasks: {
            type: state.viewerTaskConnection.connectionType,
            args: state.viewerTaskConnection.connectionArgs,
            resolve: state.viewerTaskConnection.resolve
          }
        }
      });
      state.schema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: 'RootQueryType',
          fields: {
            user: {
              type: state.userType,
              args: {
                id: {
                  type: new GraphQLNonNull(GraphQLInt)
                }
              },
              resolve: resolver(state.User)
            },
            viewer: {
              type: state.viewerType,
              resolve: function (source, args, {viewer}) {
                return viewer;
              }
            },
          }
        })
      });

      await sequelize.sync({force: true});

      const now = new Date(2015, 10, 17, 3, 24, 0, 0);

      state.taskId = 0;

      const projects = await Promise.all([
        state.Project.create({}),
        state.Project.create({}),
        state.Project.create({}),
        state.Project.create({}),
        state.Project.create({})
      ]);
      [state.projectA, state.projectB, state.projectC, state.projectD, state.projectE] = sortBy(projects, property('id'));

      state.userA = await state.User.create({
        [state.User.Tasks.as]: [
          {
            id: ++state.taskId,
            name: 'AAA',
            createdAt: new Date(now - 45000),
            otherDate: new Date(now - 45000),
            projectId: state.projectA.get('id'),
            completed: false
          },
          {
            id: ++state.taskId,
            name: 'ABA',
            createdAt: new Date(now - 40000),
            otherDate: new Date(now - 40000),
            projectId: state.projectA.get('id'),
            completed: true
          },
          {
            id: ++state.taskId,
            name: 'ABC',
            createdAt: new Date(now - 35000),
            otherDate: new Date(now - 35000),
            projectId: state.projectA.get('id'),
            completed: true
          },
          {
            id: ++state.taskId,
            name: 'ABC',
            createdAt: new Date(now - 30000),
            otherDate: new Date(now - 30000),
            projectId: state.projectA.get('id'),
            completed: false
          },
          {
            id: ++state.taskId,
            name: 'BAA',
            createdAt: new Date(now - 25000),
            otherDate: new Date(now - 25000),
            projectId: state.projectA.get('id'),
            completed: false
          },
          {
            id: ++state.taskId,
            name: 'BBB',
            createdAt: new Date(now - 20000),
            otherDate: new Date(now - 20000),
            projectId: state.projectB.get('id'),
            completed: true
          },
          {
            id: ++state.taskId,
            name: 'CAA',
            createdAt: new Date(now - 15000),
            otherDate: new Date(now - 15000),
            projectId: state.projectB.get('id'),
            completed: true
          },
          {
            id: ++state.taskId,
            name: 'CCC',
            createdAt: new Date(now - 10000),
            otherDate: new Date(now - 10000),
            projectId: state.projectB.get('id'),
            completed: false
          },
          {
            id: ++state.taskId,
            name: 'DDD',
            createdAt: new Date(now - 5000),
            otherDate: new Date(now - 5000),
            projectId: state.projectB.get('id'),
            completed: false
          }
        ]
      }, {
        include: [state.User.Tasks]
      });

      state.userB = await state.User.create({
        [state.User.Tasks.as]: [
          {
            id: ++state.taskId,
            name: 'ZAA',
            createdAt: new Date(now - 45000),
            otherDate: new Date(now - 45000),
            projectId: state.projectA.get('id'),
            completed: true
          },
          {
            id: ++state.taskId,
            name: 'ZAB',
            createdAt: new Date(now - 45000),
            otherDate: new Date(now - 45000),
            projectId: state.projectA.get('id'),
            completed: true
          },
          {
            id: ++state.taskId,
            name: 'ZAC',
            createdAt: new Date(now - 45000),
            otherDate: new Date(now - 45000),
            projectId: state.projectA.get('id'),
            completed: true
          }
        ]
      }, {
        include: [state.User.Tasks]
      });

      await Promise.all([
        state.projectA.update({
          ownerId: state.userA.get('id')
        }),
        state.ProjectMember.create({
          projectId: state.projectA.get('id'),
          userId: state.userA.get('id')
        }),
        state.ProjectMember.create({
          projectId: state.projectB.get('id'),
          userId: state.userA.get('id')
        }),
        state.ProjectMember.create({
          projectId: state.projectC.get('id'),
          userId: state.userA.get('id')
        }),
        state.ProjectMember.create({
          projectId: state.projectD.get('id'),
          userId: state.userA.get('id')
        }),
        state.ProjectMember.create({
          projectId: state.projectE.get('id'),
          userId: state.userA.get('id')
        })
      ]);
    });

    it('should not duplicate attributes', async () => {
      const sqlSpy = vi.fn();

      let projectConnectionAttributesUnique;

      const userProjectConnection = sequelizeConnection({
        name: 'userProject',
        nodeType: state.projectType,
        target: state.User.Projects,
        before(options) {
          // compare a uniq set of attributes against what is returned by the sequelizeConnection resolver
          const getUnique = uniq(options.attributes);
          projectConnectionAttributesUnique = getUnique.length === options.attributes.length;
        }
      });


      const userType = new GraphQLObjectType({
        name: state.User.name,
        fields: {
          ...attributeFields(state.User),
          id: globalIdField(state.User.name),
          projects: {
            type: userProjectConnection.connectionType,
            args: userProjectConnection.connectionArgs,
            resolve: userProjectConnection.resolve
          }
        }
      });

      const schema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: 'RootQueryType',
          fields: {
            user: {
              type: userType,
              args: {
                id: {
                  type: new GraphQLNonNull(GraphQLInt)
                }
              },
              resolve: resolver(state.User)
            },
            viewer: {
              type: state.viewerType,
              resolve: function (source, args, {viewer}) {
                return viewer;
              }
            }
          }
        })
      });

      await graphql({
        schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              projects {
                edges {
                  node {
                    tasks {
                      edges {
                        cursor
                        node {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        contextValue: {
          logging: sqlSpy
        },
      });


      expect(projectConnectionAttributesUnique).to.equal(true);

    });

    it('should handle orderBy function case', async () => {
      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              projects(first: 1) {
                edges {
                  node {
                    tasks(orderBy: NAME_FUNC, first: 5) {
                      edges {
                        cursor
                        node {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        contextValue: {}
      });

      if (result.errors) throw new Error(result.errors[0]);

      expect(state.projectOrderSpy).toHaveBeenCalledTimes(1);
      expect(state.projectOrderSpy.mock.calls[0][0]).toMatchObject({});
      expect(state.projectOrderSpy.mock.calls[0][1]).toMatchObject({ first: 5 });
    });

    it('should support connectionResolver orderBy enum references via name', async () => {
      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              projects2(orderBy: LATEST) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          }
        `,
        contextValue: {},
      });

      if (result.errors) throw new Error(result.errors[0]);

      const node = result.data.user.projects2.edges[0].node;
      expect(+fromGlobalId(node.id).id).to.equal(5);
    });

    it('should properly reverse orderBy with NULLS and last', async () => {
      const task = await state.Task.findByPk(1);
      const originalName = task.name;
      const sqlSpy = vi.fn();
      let result;

      try {
        await task.update({name: null});
        result = await graphql({
          schema: state.schema,
          source: `
            {
              user(id: ${state.userA.id}) {
                projects(first: 1) {
                  edges {
                    node {
                      tasks(orderBy: NAME_NULLS_LAST, last: 3) {
                        edges {
                          node {
                            id
                            name
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          contextValue: {logging: sqlSpy},
        });
      } finally {
        await task.update({name: originalName});
      }

      throwOnGraphQlErrors(result, sqlSpy);

      const taskIds = result.data.user.projects.edges[0].node.tasks.edges
        .map(({node}) => Number(fromGlobalId(node.id).id));
      expect(taskIds).to.deep.equal([1, 12, 11]);

      const dialect = sequelize.dialect.name;
      const quotedTaskName = quotedTaskColumn(dialect, 'name');
      const quotedTaskId = quotedTaskColumn(dialect, 'id');
      const orderSql = sqlSpy.mock.calls
        .map(([sql]) => sql)
        .find((sql) => (
          sql.includes('ORDER BY') && sql.includes(quotedTaskName)
        ));
      expect(orderSql).to.not.equal(undefined);

      if (['mssql', 'mysql'].includes(dialect)) {
        expect(orderSql).to.include(
          `CASE WHEN ${quotedTaskName} IS NULL THEN 0 ELSE 1 END ASC`
        );
        expect(orderSql).to.include(`${quotedTaskName} DESC`);
        expect(orderSql).to.include(`${quotedTaskId} DESC`);
        expect(orderSql).to.not.include('NULLS FIRST');
      } else {
        expect(orderSql).to.include(`${quotedTaskName} DESC NULLS FIRST`);
        expect(orderSql).to.include(`${quotedTaskId} DESC`);
        expect(orderSql).to.not.include('CASE WHEN');
      }
    });

    it('puts nulls last across dialects', async () => {
      const task = await state.Task.findByPk(1);
      const originalName = task.name;
      const sqlSpy = vi.fn();
      let result;

      try {
        await task.update({name: null});
        result = await graphql({
          schema: state.schema,
          source: `
            {
              user(id: ${state.userA.id}) {
                projects(first: 1) {
                  edges {
                    node {
                      tasks(orderBy: NAME_NULLS_LAST, first: 10) {
                        edges {
                          node {
                            id
                            name
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          contextValue: {logging: sqlSpy},
        });
      } finally {
        await task.update({name: originalName});
      }

      throwOnGraphQlErrors(result, sqlSpy);

      const tasks = result.data.user.projects.edges[0].node.tasks.edges
        .map(({node}) => ({
          id: Number(fromGlobalId(node.id).id),
          name: node.name
        }));
      expect(tasks).to.deep.equal([
        {id: 2, name: 'ABA'},
        {id: 3, name: 'ABC'},
        {id: 4, name: 'ABC'},
        {id: 5, name: 'BAA'},
        {id: 10, name: 'ZAA'},
        {id: 11, name: 'ZAB'},
        {id: 12, name: 'ZAC'},
        {id: 1, name: null}
      ]);

      const dialect = sequelize.dialect.name;
      const quotedTaskName = quotedTaskColumn(dialect, 'name');
      const quotedTaskId = quotedTaskColumn(dialect, 'id');
      const orderSql = sqlSpy.mock.calls
        .map(([sql]) => sql)
        .find((sql) => (
          sql.includes('ORDER BY') && sql.includes(quotedTaskName)
        ));

      if (['mssql', 'mysql'].includes(dialect)) {
        expect(orderSql).to.include(
          `CASE WHEN ${quotedTaskName} IS NULL THEN 1 ELSE 0 END ASC`
        );
        expect(orderSql).to.include(`${quotedTaskName} ASC`);
        expect(orderSql).to.include(`${quotedTaskId} ASC`);
        expect(orderSql).to.not.include('NULLS LAST');
      } else {
        expect(orderSql).to.include(`${quotedTaskName} ASC NULLS LAST`);
        expect(orderSql).to.include(`${quotedTaskId} ASC`);
        expect(orderSql).to.not.include('CASE WHEN');
      }
    });

    it('should support in-query slicing and pagination with first and orderBy', async () => {
      const firstThree = state.userA.tasks.slice(state.userA.tasks.length - 3, state.userA.tasks.length);
      const nextThree = state.userA.tasks.slice(state.userA.tasks.length - 6, state.userA.tasks.length - 3);
      const lastThree = state.userA.tasks.slice(state.userA.tasks.length - 9, state.userA.tasks.length - 6);

      expect(firstThree.length).to.equal(3);
      expect(nextThree.length).to.equal(3);
      expect(lastThree.length).to.equal(3);

      const verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack);

        const resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node;
        });

        const resultIds = resultTasks.map((task) => {
          return parseInt(fromGlobalId(task.id).id, 10);
        }).sort();

        const expectedIds = expectedTasks.map(function (task) {
          return task.get('id');
        }).sort();

        expect(resultTasks.length).to.equal(3);
        expect(resultIds).to.deep.equal(expectedIds);
      };

      const query = (after) => {
        return graphql({
          schema: state.schema,
          source: `
            {
              user(id: ${state.userA.id}) {
                tasks(first: 3, ${after ? 'after: "' + after + '", ' : ''} orderBy: LATEST) {
                  edges {
                    cursor
                    node {
                      id
                      name
                    }
                  }
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    endCursor
                  }
                }
              }
            }
          `,
          contextValue: {}
        });
      };

      const firstResult = await query();
      verify(firstResult, firstThree);
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true);
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(false);

      const nextResult = await query(firstResult.data.user.tasks.pageInfo.endCursor);
      verify(nextResult, nextThree);
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true);
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true);

      const lastResult = await query(nextResult.data.user.tasks.edges[2].cursor);
      verify(lastResult, lastThree);
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false);
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true);
    });

    it('should support in-query slicing and pagination with first and CUSTOM orderBy', async () => {
      const correctOrder = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              tasks(first: 9, orderBy: CUSTOM) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        `,
        contextValue: {},
      });
      const reordered = correctOrder.data.user.tasks.edges.map(({node}) => {
        const targetId = fromGlobalId(node.id).id;
        return state.userA.tasks.find(task => {
          return task.id === Number(targetId);
        });
      });

      const lastThree = reordered.slice(state.userA.tasks.length - 3, state.userA.tasks.length);
      const nextThree = reordered.slice(state.userA.tasks.length - 6, state.userA.tasks.length - 3);
      const firstThree = reordered.slice(state.userA.tasks.length - 9, state.userA.tasks.length - 6);

      expect(firstThree.length).to.equal(3);
      expect(nextThree.length).to.equal(3);
      expect(lastThree.length).to.equal(3);


      const verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack);

        const resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node;
        });

        const resultIds = resultTasks.map((task) => {
          return parseInt(fromGlobalId(task.id).id, 10);
        }).sort();

        const expectedIds = expectedTasks.map(function (task) {
          return task.get('id');
        }).sort();

        expect(resultTasks.length).to.equal(3);
        expect(resultIds).to.deep.equal(expectedIds);
      };

      const query = (after) => {
        return graphql({
          schema: state.schema,
          source: `
            {
              user(id: ${state.userA.id}) {
                tasks(first: 3, ${after ? 'after: "' + after + '", ' : ''} orderBy: CUSTOM) {
                  edges {
                    cursor
                    node {
                      id
                      name
                    }
                  }
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    endCursor
                  }
                }
              }
            }
          `,
          contextValue: {},
        });
      };

      const firstResult = await query();
      verify(firstResult, firstThree);
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true);
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(false);

      const nextResult = await query(firstResult.data.user.tasks.pageInfo.endCursor);
      verify(nextResult, nextThree);
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true);
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true);

      const lastResult = await query(nextResult.data.user.tasks.edges[2].cursor);
      verify(lastResult, lastThree);
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false);
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true);
    });

    it('should support pagination with where', async () => {
      const completedTasks = state.userA.tasks.filter(task => task.completed);

      expect(completedTasks.length).to.equal(4);

      const firstThree = completedTasks.slice(0, 3);
      const nextThree = completedTasks.slice(3, 6);

      expect(firstThree.length).to.equal(3);
      expect(nextThree.length).to.equal(1);

      const verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack);

        const resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node;
        });

        const resultIds = resultTasks.map((task) => {
          return parseInt(fromGlobalId(task.id).id, 10);
        }).sort();

        const expectedIds = expectedTasks.map(function (task) {
          return task.get('id');
        }).sort();

        expect(resultTasks.length).to.equal(expectedTasks.length);
        expect(resultIds).to.deep.equal(expectedIds);
      };

      const query = (after) => {
        return graphql({
          schema: state.schema,
          source: `
            {
              user(id: ${state.userA.id}) {
                tasks(first: 3, ${after ? 'after: "' + after + '", ' : ''} completed: true) {
                  edges {
                    cursor
                    node {
                      id
                      name
                    }
                  }
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    endCursor
                  }
                }
              }
            }
          `,
          contextValue: {},
        });
      };


      const firstResult = await query();
      verify(firstResult, firstThree);
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true);
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(false);

      const nextResult = await query(firstResult.data.user.tasks.pageInfo.endCursor);
      verify(nextResult, nextThree);
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false);
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true);
    });

    it('should support pagination on N:M', async () => {
      const query = (after) => {
        return graphql({
          schema: state.schema,
          source: `
            {
              user(id: ${state.userA.id}) {
                projects(first: 2, ${after ? 'after: "' + after + '", ' : ''}) {
                  edges {
                    cursor
                    node {
                      id
                    }
                  }
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    endCursor
                  }
                }
              }
            }
          `,
          contextValue: {},
        });
      };


      const firstResult = await query();
      expect(firstResult.data.user.projects.pageInfo.hasNextPage).to.equal(true);
      expect(firstResult.data.user.projects.pageInfo.hasPreviousPage).to.equal(false);

      const nextResult = await query(firstResult.data.user.projects.pageInfo.endCursor);
      expect(nextResult.data.user.projects.pageInfo.hasNextPage).to.equal(true);
      expect(nextResult.data.user.projects.pageInfo.hasPreviousPage).to.equal(true);

      const thirdResult = await query(nextResult.data.user.projects.pageInfo.endCursor);
      expect(thirdResult.data.user.projects.pageInfo.hasNextPage).to.equal(false);
      expect(thirdResult.data.user.projects.pageInfo.hasPreviousPage).to.equal(true);
    });

    it('should support in-query slicing with user provided args/where', async () => {
      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              tasks(first: 2, completed: true, orderBy: LATEST) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
              }
            }
          }
        `,
        contextValue: {}
      });

      if (result.errors) throw new Error(result.errors[0].stack);

      expect(result.data.user.tasks.edges.length).to.equal(2);
      expect(result.data.user.tasks.edges.map(task => {
        return parseInt(fromGlobalId(task.node.id).id, 10);
      })).to.deep.equal([
        state.userA.tasks[6].id,
        state.userA.tasks[5].id,
      ]);
    });

    it('should support multiple user provided args/where that act on a single database field', async () => {
      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              tasks(first: 5, orderBy: LATEST, timeRangeOne: true, timeRangeTwo: true) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
              }
            }
          }
        `,
        contextValue: {},
      });

      if (result.errors) throw new Error(result.errors[0].stack);

      expect(result.data.user.tasks.edges.length).to.equal(3);
      expect(result.data.user.tasks.edges.map(task => {
        return parseInt(fromGlobalId(task.node.id).id, 10);
      })).to.deep.equal([
        state.userA.tasks[4].id,
        state.userA.tasks[3].id,
        state.userA.tasks[2].id,
      ]);
    });

    it('should support nested aliased fields', async () => {
      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              tasks(first: 1, completed: true, orderBy: LATEST) {
                edges {
                  node {
                    id
                    title: name
                  }
                }
              }
            }
          }
        `,
        contextValue: {},
      });

      if (result.errors) throw new Error(result.errors[0].stack);
      expect(result.data.user.tasks.edges[0].node.title).to.equal('CAA');
    });

    it('should support reverse pagination with last and orderBy', async () => {
      const firstThree = state.userA.tasks.slice(0, 3);
      const nextThree = state.userA.tasks.slice(3, 6);
      const lastThree = state.userA.tasks.slice(6, 9);

      expect(firstThree.length).to.equal(3);
      expect(nextThree.length).to.equal(3);
      expect(lastThree.length).to.equal(3);

      const verify = function (result, expectedTasks) {
        if (result.errors) throw new Error(result.errors[0].stack);

        const resultTasks = result.data.user.tasks.edges.map(function (edge) {
          return edge.node;
        });

        const resultIds = resultTasks.map((task) => {
          return parseInt(fromGlobalId(task.id).id, 10);
        }).sort();

        const expectedIds = expectedTasks.map(function (task) {
          return task.get('id');
        }).sort();

        expect(resultTasks.length).to.equal(3);
        expect(resultIds).to.deep.equal(expectedIds);
      };

      const query = (before) => {
        return graphql({
          schema: state.schema,
          source: `
            {
              user(id: ${state.userA.id}) {
                tasks(last: 3, ${before ? 'before: "' + before + '", ' : ''} orderBy: LATEST) {
                  edges {
                    cursor
                    node {
                      id
                      name
                    }
                  }
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    endCursor
                  }
                }
              }
            }
          `,
          contextValue: {},
        });
      };

      const firstResult = await query();
      verify(firstResult, firstThree);
      expect(firstResult.data.user.tasks.pageInfo.hasNextPage).to.equal(false);
      expect(firstResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true);

      const nextResult = await query(firstResult.data.user.tasks.pageInfo.endCursor);
      verify(nextResult, nextThree);
      expect(nextResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true);
      expect(nextResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(true);

      const lastResult = await query(nextResult.data.user.tasks.edges[2].cursor);
      verify(lastResult, lastThree);
      expect(lastResult.data.user.tasks.pageInfo.hasNextPage).to.equal(true);
      expect(lastResult.data.user.tasks.pageInfo.hasPreviousPage).to.equal(false);
    });

    it('should support fetching the next element although it has the same orderValue', async () => {
      const firstResult = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              tasks(first: 3, orderBy: NAME) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
                pageInfo {
                  endCursor
                }
              }
            }
          }
        `,
        contextValue: {},
      });

      const secondResult = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              tasks(first: 3, after: "${firstResult.data.user.tasks.pageInfo.endCursor}", orderBy: NAME) {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
                pageInfo {
                  endCursor
                }
              }
            }
          }
        `,
        contextValue: {},
      });

      expect(firstResult.data.user.tasks.edges[2].node.name).to.equal('ABC');
      expect(firstResult.data.user.tasks.edges[2].node.name).to.equal(
        secondResult.data.user.tasks.edges[0].node.name
      );
    });


    it('should support prefetching two nested connections', async () => {
      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              projects {
                edges {
                  node {
                    tasks {
                      edges {
                        cursor
                        node {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
      });

      if (result.errors) throw new Error(result.errors[0].stack);

      const nodeNames = result.data.user.projects.edges.map(edge => {
        return edge.node.tasks.edges.map(edge => edge.node.name).sort();
      });
      expect(nodeNames).to.deep.equal([
        [
          'AAA',
          'ABA',
          'ABC',
          'ABC',
          'BAA',
          'ZAA',
          'ZAB',
          'ZAC'
        ],
        [
          'BBB',
          'CAA',
          'CCC',
          'DDD'
        ],
        [],
        [],
        []
      ]);
    });

    it('should support paging a nested connection', async () => {
      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              projects {
                edges {
                  node {
                    tasks(first: 3, orderBy: LATEST) {
                      edges {
                        cursor
                        node {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `
      });

      if (result.errors) throw new Error(result.errors[0].stack);

      const projects = result.data.user.projects.edges.map(edge => edge.node);

      expect(projects[0].tasks.edges.length).to.equal(3);
      expect(projects[1].tasks.edges.length).to.equal(3);

      expect(projects[0].tasks.edges[0].node.id).to.equal(toGlobalId(state.Task.name, state.userA.tasks[4].get('id')));
      expect(projects[1].tasks.edges[0].node.id).to.equal(toGlobalId(state.Task.name, state.userA.tasks[8].get('id')));
    });

    it('should support connection fields', async () => {
      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              tasks {
                totalCount
              }
            }
          }
        `,
        contextValue: {},
      });

      if (result.errors) throw new Error(result.errors[0].stack);

      expect(result.data.user.tasks.totalCount).to.equal(9);
      expect(
        state.userTaskConnectionFieldSpy.mock.calls[0][0].source.get('tasks')
      ).to.be.undefined;
    });

    it('should support connection fields on nested connections', async () => {
      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              projects {
                edges {
                  node {
                    tasks {
                      totalCount
                    }
                  }
                }
              }
            }
          }
        `,
        contextValue: {},
      });

      if (result.errors) throw new Error(result.errors[0].stack);

      expect(result.data.user.projects.edges[0].node.tasks.totalCount).to.equal(8);
      expect(result.data.user.projects.edges[1].node.tasks.totalCount).to.equal(4);
      expect(
        state.projectTaskConnectionFieldSpy.mock.calls[0][0].source.get('tasks')
      ).to.be.undefined;
    });

    it('should support edgeFields', async () => {
      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              projects {
                edges {
                  ...projectOwner
                  node {
                    id
                  }
                }
              }
            }
          }

          fragment projectOwner on userProjectEdge {
            isOwner
          }
        `,
      });

      if (result.errors) throw new Error(result.errors[0].stack);

      const isOwner = result.data.user.projects.edges.map(edge => edge.isOwner);
      expect(isOwner.sort()).to.deep.equal([true, false, false, false, false].sort());
    });

    it('should support connection fields with args/where', async () => {
      const sqlSpy = vi.fn();

      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${state.userA.id}) {
              tasks(completed: true) {
                totalCount
              }
            }
          }
        `,
        contextValue: { logging: sqlSpy },
      });

      if (result.errors) throw new Error(result.errors[0].stack);

      expect(result.data.user.tasks.totalCount).to.equal(4);
      expect(
        state.userTaskConnectionFieldSpy.mock.calls[0][0].source.get('tasks')
      ).to.be.undefined;
    });

    it('should not barf on paging if there are no connection edges', async () => {
      const user = await state.User.create({});

      const result = await graphql({
        schema: state.schema,
        source: `
          {
            user(id: ${user.get('id')}) {
              tasks(first: 10) {
                totalCount

                edges {
                  node {
                    id
                  }
                }

                pageInfo {
                  hasNextPage
                }
              }
            }
          }
        `,
        contextValue: {},
      });

      if (result.errors) throw new Error(result.errors[0].stack);
      expect(result.data.user).not.to.be.null;
      expect(result.data.user.tasks.totalCount).to.equal(0);
      expect(result.data.user.tasks.pageInfo.hasNextPage).to.equal(false);
    });

    it('should support model connections', async () => {
      const viewer = await state.User.create();

      const tasks = await Promise.all([
        viewer.createTask({
          id: ++state.taskId
        }),
        viewer.createTask({
          id: ++state.taskId
        }),
        state.Task.create({
          id: ++state.taskId
        })
      ]);

      const result = await graphql({
        schema: state.schema,
        source: `
          {
            viewer {
              tasks {
                edges {
                  cursor
                  node {
                    id
                    name
                  }
                }
              }
            }
          }
        `,
        contextValue: {
          viewer: viewer
        },
      });

      expect(result.data.viewer.tasks.edges.length).to.equal(2);
      expect(
        result.data.viewer.tasks.edges.map(edge => fromGlobalId(edge.node.id).id).sort()
      ).deep.equal(
        tasks.slice(0, 2).map(task => task.get('id').toString()).sort()
      );
    });
  });
});
