import Sequelize from 'sequelize';
import type { FindOptions, Model, ModelStatic } from 'sequelize';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { sequelize } from '../../support/helper.js';
import attributeFields from '../../../src/attributeFields.js';

import {
  GraphQLObjectType,
  GraphQLSchema,
  graphql
} from 'graphql';
import type { GraphQLResolveInfo } from 'graphql';
import type {
  ConnectionDefinition,
  ConnectionResult,
  ResolverArguments
} from '../../../src/contracts.js';

import {
  globalIdField,
  toGlobalId
} from 'graphql-relay';

import {
  NodeTypeMapper,
  createConnectionResolver,
  handleConnection,
  idFetcher,
  sequelizeConnection,
  typeResolver
} from '../../../src/relay.js';

describe('relay', function () {
  it('uses a typed static resolver import without a CommonJS bridge', function () {
    expect(existsSync('src/relay.ts')).to.equal(true);

    const relaySource = readFileSync('src/relay.ts', 'utf8');

    expect(relaySource).to.include("import resolver from './resolver.js';");
    expect(relaySource).not.to.match(/require\(['\"]\.\/resolver/);
  });

  it('annotates callable custom nodes for type resolution', async function () {
    const callableNode = Object.assign(function callableNode() {}, {
      value: 'custom value'
    });
    const nodeTypeMapper = new NodeTypeMapper();
    nodeTypeMapper.mapTypes({
      CallableNode: {
        type: 'CallableNode',
        resolve: () => callableNode
      }
    });

    const fetchedNode = await idFetcher(sequelize, nodeTypeMapper)(
      toGlobalId('CallableNode', '1'),
      {},
      {} as GraphQLResolveInfo
    );

    expect(fetchedNode).to.equal(callableNode);
    expect(typeResolver(nodeTypeMapper)(callableNode)).to.equal('CallableNode');
  });

  it('coerces legacy string counts in in-memory connections', function () {
    const connection = Reflect.apply(handleConnection, undefined, [
      [{ id: 1 }, { id: 2 }],
      { first: '1' }
    ]);

    expect(connection.edges).to.have.length(1);
    expect(connection.edges[0].node).to.deep.equal({ id: 1 });
  });

  describe('connections', function () {
    let User: ModelStatic<Model>;
    let Task: ModelStatic<Model>;
    let tasksAssociation: ReturnType<ModelStatic<Model>['hasMany']>;
    let taskType: GraphQLObjectType;
    let viewerTaskConnection: ConnectionDefinition<
      unknown,
      unknown,
      ResolverArguments,
      unknown,
      ConnectionResult
    >;
    let viewerType: GraphQLObjectType;
    let schema: GraphQLSchema;
    let viewer: Model;

    const beforeSpy = vi.fn((...hookArguments: [
      FindOptions,
      ResolverArguments,
      unknown,
      GraphQLResolveInfo
    ]) => hookArguments[0]);
    const afterSpy = vi.fn((...hookArguments: [
      ConnectionResult,
      ResolverArguments,
      unknown,
      GraphQLResolveInfo
    ]) => hookArguments[0]);

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
        before: beforeSpy,
        after: afterSpy
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
        })
      });
    });

    beforeEach(function () {
      beforeSpy.mockClear();
      afterSpy.mockClear();

      viewer = User.build({
        id: Math.ceil(Math.random() * 999)
      });

      const task = Task.build({
        id: 1,
      });

      task.dataValues['full_count'] = Math.random() * 999;
      vi.spyOn(Task, 'findAll').mockResolvedValue([task]);
      vi.spyOn(User, 'findByPk').mockResolvedValue(User.build());
    });

    afterEach(function () {
      vi.restoreAllMocks();
    });

    it('creates cursors for scalar connection nodes', function () {
      const connectionResolver = createConnectionResolver({
        target: tasksAssociation
      });

      const edge = connectionResolver.resolveEdge('scalar', 0);

      expect(edge.node).to.equal('scalar');
      expect(Buffer.from(edge.cursor, 'base64').toString()).to.equal(
        JSON.stringify(['s', 0])
      );
      expect(edge.source).to.equal(undefined);
      expect(edge.sourceArgs).to.deep.equal({});
    });

    it('paginates after a standalone edge cursor', async function () {
      const standaloneTask = Task.build({id: 1});
      const standaloneEdge = viewerTaskConnection.resolveEdge(
        standaloneTask
      );

      expect(JSON.parse(Buffer.from(
        standaloneEdge.cursor,
        'base64'
      ).toString())).to.deep.equal([1, null]);

      const result = await graphql({
        schema,
        source: `
          query tasksAfterStandaloneEdge($after: String!) {
            viewer {
              tasks(first: 1, after: $after) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          }
        `,
        variableValues: {
          after: standaloneEdge.cursor
        },
        contextValue: {
          viewer
        }
      });

      expect(result.errors).to.equal(undefined);
      expect(Task.findAll).toHaveBeenCalledWith(
        expect.objectContaining({offset: 1})
      );
    });

    it('rejects a cursor with a non-numeric index', async function () {
      const invalidCursor = Buffer.from(JSON.stringify([1, '0'])).toString(
        'base64'
      );

      const result = await graphql({
        schema,
        source: `
          query tasksAfterInvalidCursor($after: String!) {
            viewer {
              tasks(first: 1, after: $after) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          }
        `,
        variableValues: {
          after: invalidCursor
        },
        contextValue: {
          viewer
        }
      });

      expect(result.errors).to.have.length(1);
      expect(result.errors?.[0]?.message).to.equal('Invalid Relay cursor.');
    });

    it('passes context, root and info to before', async function () {
      const result = await graphql({
        schema,
        source: `
          query {
            viewer {
              tasks {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          }
        `,
        contextValue: {
          viewer
        },
      });

      if (result.errors) throw new Error(result.errors[0]?.message);

      expect(beforeSpy).toHaveBeenCalledOnce();
      const [findOptions, args, context, info] = beforeSpy.mock.calls[0];

      expect(findOptions).toEqual(expect.any(Object));
      expect(args).toEqual(expect.any(Object));
      expect(args.first).to.equal(undefined);
      expect(context).toMatchObject({
        viewer: {
          id: viewer.get('id')
        }
      });
      expect(info).toMatchObject({
        fieldNodes: expect.any(Array)
      });

      const [connectionResult, afterArgs, afterContext, afterInfo] =
        afterSpy.mock.calls[0];

      expect(connectionResult).toMatchObject({
        fullCount: expect.any(Number)
      });
      expect(afterArgs).toEqual(expect.any(Object));
      expect(afterArgs.first).to.equal(undefined);
      expect(afterContext).toMatchObject({
        viewer: {
          id: viewer.get('id')
        }
      });
      expect(afterInfo).toMatchObject({
        path: expect.any(Object)
      });

    });
  });
});
