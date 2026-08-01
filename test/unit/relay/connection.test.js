import Sequelize from 'sequelize';
import {expect} from 'chai';
import { existsSync, readFileSync } from 'fs';
import sinon from 'sinon';
import { sequelize } from '../../support/helper';
import attributeFields from '../../../src/attributeFields';

import {
  GraphQLObjectType,
  GraphQLSchema,
  graphql
} from 'graphql';

import {
  globalIdField,
  toGlobalId
} from 'graphql-relay';

import {
  NodeTypeMapper,
  createConnectionResolver,
  idFetcher,
  sequelizeConnection,
  typeResolver
} from '../../../src/relay';

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
      {}
    );

    expect(fetchedNode).to.equal(callableNode);
    expect(typeResolver(nodeTypeMapper)(callableNode)).to.equal('CallableNode');
  });

  describe('connections', function () {
    before(function () {
      this.User = sequelize.define('user', {}, {timestamps: false});
      this.Task = sequelize.define('task', {title: Sequelize.STRING}, {timestamps: false});

      this.User.Tasks = this.User.hasMany(this.Task, {as: 'tasks', foreignKey: 'userId'});

      this.taskType = new GraphQLObjectType({
        name: this.Task.name,
        fields: {
          ...attributeFields(this.Task),
          id: globalIdField(this.Task.name)
        }
      });

      this.beforeSpy = sinon.spy(options => options);
      this.afterSpy = sinon.spy(options => options);

      this.viewerTaskConnection = sequelizeConnection({
        name: 'Viewer' + this.Task.name,
        nodeType: this.taskType,
        target: this.User.Tasks,
        before: this.beforeSpy,
        after: this.afterSpy
      });

      this.viewerType = new GraphQLObjectType({
        name: 'Viewer',
        fields: {
          tasks: {
            type: this.viewerTaskConnection.connectionType,
            args: this.viewerTaskConnection.connectionArgs,
            resolve: this.viewerTaskConnection.resolve
          }
        }
      });

      this.schema = new GraphQLSchema({
        query: new GraphQLObjectType({
          name: 'RootQueryType',
          fields: {
            viewer: {
              type: this.viewerType,
              resolve: function (source, args, {viewer}) {
                return viewer;
              }
            }
          }
        })
      });
    });

    beforeEach(function () {
      this.sinon = sinon.createSandbox();
      this.beforeSpy.resetHistory();
      this.afterSpy.resetHistory();

      this.viewer = this.User.build({
        id: Math.ceil(Math.random() * 999)
      });

      const task = this.Task.build({
        id: 1,
      });

      task.dataValues['full_count'] = Math.random() * 999;
      this.sinon.stub(this.Task, 'findAll').resolves([task]);
      this.sinon.stub(this.User, this.User.findByPk ? 'findByPk' : 'findById').resolves(this.User.build());
    });

    afterEach(function () {
      this.sinon.restore();
    });

    it('creates cursors for scalar connection nodes', function () {
      const connectionResolver = createConnectionResolver({
        target: this.User.Tasks
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
      const standaloneTask = this.Task.build({id: 1});
      const standaloneEdge = this.viewerTaskConnection.resolveEdge(
        standaloneTask
      );

      expect(JSON.parse(Buffer.from(
        standaloneEdge.cursor,
        'base64'
      ).toString())).to.deep.equal([1, null]);

      const result = await graphql({
        schema: this.schema,
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
          viewer: this.viewer
        }
      });

      expect(result.errors).to.equal(undefined);
      expect(this.Task.findAll).to.have.been.calledWithMatch(
        sinon.match({offset: 1})
      );
    });

    it('rejects a cursor with a non-numeric index', async function () {
      const invalidCursor = Buffer.from(JSON.stringify([1, '0'])).toString(
        'base64'
      );

      const result = await graphql({
        schema: this.schema,
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
          viewer: this.viewer
        }
      });

      expect(result.errors).to.have.length(1);
      expect(result.errors[0].message).to.equal('Invalid Relay cursor.');
    });

    it('passes context, root and info to before', async function () {
      const result = await graphql({
        schema: this.schema,
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
          viewer: this.viewer
        },
      });

      if (result.errors) throw new Error(result.errors[0]);

      expect(this.beforeSpy).to.have.been.calledOnce;
      expect(this.beforeSpy).to.have.been.calledWithMatch(
        sinon.match.any,
        sinon.match({
          first: sinon.match.any
        }),
        sinon.match({
          viewer: {
            id: this.viewer.id
          }
        }),
        sinon.match({
          ast: sinon.match.any
        })
      );

      expect(this.afterSpy).to.have.been.calledWithMatch(
        sinon.match({
          fullCount: sinon.match.number
        }),
        sinon.match({
          first: sinon.match.any
        }),
        sinon.match({
          viewer: {
            id: this.viewer.id
          }
        }),
        sinon.match({
          path: sinon.match.any
        })
      );

    });
  });
});
