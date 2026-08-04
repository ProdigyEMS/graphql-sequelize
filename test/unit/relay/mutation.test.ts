'use strict';

import Sequelize from 'sequelize';
import type { Model, ModelStatic } from 'sequelize';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import attributeFields from '../../../src/attributeFields.js';
import { sequelize } from '../../support/helper.js';

import {
  sequelizeConnection
} from '../../../src/relay.js';

import {
  GraphQLString,
  GraphQLNonNull,
  GraphQLEnumType,
  GraphQLObjectType,
  GraphQLSchema,
  graphql
} from 'graphql';

import {
  globalIdField,
  toGlobalId,
  mutationWithClientMutationId
} from 'graphql-relay';

interface AddTaskMutationData {
  addTask: {
    task: {
      id: string;
    };
    newTaskEdge: {
      cursor: string;
      node: {
        id: string;
        title: string;
      };
    };
  };
}

describe('relay', function () {
  describe('mutation', function () {
    describe('connections', function () {
      let User: ModelStatic<Model>;
      let Task: ModelStatic<Model>;
      let tasksAssociation: ReturnType<ModelStatic<Model>['hasMany']>;
      let taskType: GraphQLObjectType;
      let viewerTaskConnection: ReturnType<typeof sequelizeConnection>;
      let viewerType: GraphQLObjectType;
      let schema: GraphQLSchema;
      let viewer: Model;

      beforeAll(function () {
        User = sequelize.define('user', {}, {timestamps: false});
        Task = sequelize.define('task', {title: Sequelize.STRING}, {timestamps: false});

        tasksAssociation = User.hasMany(Task, {as: 'tasks', foreignKey: 'userId'});

        taskType = new GraphQLObjectType({
          name: Task.name,
          fields: {
            ...attributeFields(Task),
            id: globalIdField(Task.name)
          }
        });

        viewerTaskConnection = sequelizeConnection({
          name: 'Viewer' + Task.name,
          nodeType: taskType,
          target: tasksAssociation,
          orderBy: new GraphQLEnumType({
            name: 'Viewer' + Task.name + 'ConnectionOrder',
            values: {
              ID: {value: [Task.primaryKeyAttribute, 'ASC']},
            }
          })
        });

        viewerType = new GraphQLObjectType({
          name: 'Viewer',
          fields: {
            tasks: {
              type: viewerTaskConnection.connectionType,
              args: viewerTaskConnection.connectionArgs,
              resolve: viewerTaskConnection.resolve
            }
          }
        });

        const addTaskMutation = mutationWithClientMutationId({
          name: 'addTask',
          inputFields: {
            title: {
              type: new GraphQLNonNull(GraphQLString)
            }
          },
          outputFields: () => ({
            viewer: {
              type: viewerType,
              resolve: (payload, {viewer: contextViewer}) => {
                return contextViewer;
              }
            },
            task: {
              type: taskType,
              resolve: (payload) => (
                payload as { task: Model }
              ).task
            },
            newTaskEdge: {
              type: viewerTaskConnection.edgeType,
              resolve: (payload) => viewerTaskConnection.resolveEdge(
                (payload as { task: Model }).task
              )
            }
          }),
          mutateAndGetPayload: async ({title}, {viewer: contextViewer}) => {
            const task = await Task.create({
              title,
              userId: contextViewer.id
            });

            return {
              task
            };
          }
        });

        schema = new GraphQLSchema({
          query: new GraphQLObjectType({
            name: 'RootQueryType',
            fields: {
              viewer: {
                type: viewerType,
                resolve: function (source, args, {viewer: contextViewer}) {
                  return contextViewer;
                }
              }
            }
          }),
          mutation: new GraphQLObjectType({
            name: 'Mutation',
            fields: {
              addTask: addTaskMutation
            }
          })
        });
      });

      beforeEach(function () {
        viewer = User.build({
          id: Math.ceil(Math.random() * 999)
        });

        vi.spyOn(Task, 'create').mockResolvedValue(Task.build());
      });

      afterEach(function () {
        vi.restoreAllMocks();
      });

      describe('addEdgeMutation', function () {
        it('should return a appropriate cursor and node', async function () {
          const title = Math.random().toString();
          const id = Math.ceil(Math.random() * 999);

          vi.mocked(Task.create).mockResolvedValue(Task.build({
            id,
            title,
            userId: viewer.get('id')
          }));

          const result = await graphql({
            schema,
            source: `
              mutation {
                addTask(input: {title: "${title}", clientMutationId: "${Math.random().toString()}"}) {
                  task {
                    id
                  }

                  newTaskEdge {
                    cursor
                    node {
                      id
                      title
                    }
                  }
                }
              }
            `,
            contextValue: {
              viewer
            }
          });

          if (result.errors) throw new Error(result.errors[0]?.stack);

          const data = result.data as unknown as AddTaskMutationData;

          expect(data.addTask.task.id).to.equal(toGlobalId(Task.name, id));
          expect(data.addTask.newTaskEdge.cursor).to.be.ok;
          expect(data.addTask.newTaskEdge.node.id).to.equal(toGlobalId(Task.name, id));
          expect(data.addTask.newTaskEdge.node.title).to.equal(title);
        });
      });
    });
  });
});
