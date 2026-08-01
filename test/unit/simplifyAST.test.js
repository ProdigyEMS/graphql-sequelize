'use strict';

import {expect} from 'chai';
import {
  graphql,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse,
  validate
} from 'graphql';
import simplifyAST from '../../src/simplifyAST.js';

/**
 * Parse a GraphQL document and return its first definition.
 *
 * @param {string} query GraphQL query text
 * @return {import('graphql').DefinitionNode} first parsed definition
 */
function parseFirstDefinition(query) {
  return parse(query).definitions[0];
}

describe('simplifyAST', function () {
  it('should simplify a basic nested structure', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        users {
          name
          projects {
            name
          }
        }
      }
    `))).to.deep.equal({
      args: {},
      fields: {
        users: {
          args: {},
          fields: {
            name: {
              args: {},
              fields: {}
            },
            projects: {
              args: {},
              fields: {
                name: {
                  args: {},
                  fields: {}
                }
              }
            }
          }
        }
      }
    });
  });

  it('should simplify a basic structure with args', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        user(id: 1) {
          name
        }
      }
    `))).to.deep.equal({
      args: {},
      fields: {
        user: {
          args: {
            id: '1'
          },
          fields: {
            name: {
              args: {},
              fields: {}
            }
          }
        }
      }
    });
  });

  it('should simplify a basic structure with array args', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        luke: human(id: ["1000", "1003"]) {
          name
        }
      }
    `))).to.deep.equal({
      args: {},
      fields: {
        luke: {
          key: 'human',
          args: {
            id: ['1000', '1003']
          },
          fields: {
            name: {
              args: {},
              fields: {}
            }
          }
        }
      }
    });
  });

  it('should simplify a basic structure with object args', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        luke: human(contact: { phone: "91264646" }) {
          name
        }
      }
    `))).to.deep.equal({
      args: {},
      fields: {
        luke: {
          key: 'human',
          args: {
            contact: { phone: '91264646' }
          },
          fields: {
            name: {
              args: {},
              fields: {}
            }
          }
        }
      }
    });
  });

  it('should simplify a basic structure with nested array args', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        user(units: ["1", "2", ["3", ["4"], [["5"], "6"], "7"]]) {
          name
        }
      }
    `))).to.deep.equal({
      args: {},
      fields: {
        user: {
          args: {
            units: ['1', '2', ['3', ['4'], [['5'], '6'], '7']]
          },
          fields: {
            name: {
              args: {},
              fields: {}
            }
          }
        }
      }
    });
  });

  it('should simplify a basic structure with variable args', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        user(id: $id) {
          name
        }
      }
    `), {
      variableValues: {
        id: '1'
      }
    })).to.deep.equal({
      args: {},
      fields: {
        user: {
          args: {
            id: '1'
          },
          fields: {
            name: {
              args: {},
              fields: {}
            }
          }
        }
      }
    });
  });

  it('should simplify a variable-backed field argument from resolver info', async function () {
    let simplified;
    const viewerType = new GraphQLObjectType({
      name: 'SimplifyASTVariableViewer',
      fields: {
        item: {
          type: GraphQLString,
          args: {
            limit: {
              type: GraphQLInt
            }
          }
        }
      }
    });
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'SimplifyASTVariableQuery',
        fields: {
          viewer: {
            type: viewerType,
            resolve(source, args, context, info) {
              simplified = simplifyAST(info.fieldNodes, info);

              return {};
            }
          }
        }
      })
    });

    const result = await graphql({
      schema,
      source: `
        query SimplifyASTVariable($limit: Int) {
          viewer {
            item(limit: $limit)
          }
        }
      `,
      variableValues: {
        limit: 2
      }
    });

    expect(result.errors).to.equal(undefined);
    expect(simplified).to.deep.equal({
      fields: {
        item: {
          args: {
            limit: 2
          },
          fields: {}
        }
      }
    });
  });

  it('should ignore inherited variable map entries', async function () {
    let simplified;
    const viewerType = new GraphQLObjectType({
      name: 'SimplifyASTInheritedVariableViewer',
      fields: {
        item: {
          type: GraphQLString,
          args: {
            value: {
              type: GraphQLString
            }
          }
        }
      }
    });
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'SimplifyASTInheritedVariableQuery',
        fields: {
          viewer: {
            type: viewerType,
            resolve(source, args, context, info) {
              simplified = simplifyAST(info.fieldNodes, info);

              return {};
            }
          }
        }
      })
    });

    const result = await graphql({
      schema,
      source: `
        query SimplifyASTInheritedVariable($constructor: String) {
          viewer {
            item(value: $constructor)
          }
        }
      `
    });

    expect(result.errors).to.equal(undefined);
    expect(Object.prototype.hasOwnProperty.call(
      simplified.fields.item.args,
      'value'
    )).to.equal(true);
    expect(simplified.fields.item.args.value).to.equal(undefined);
  });

  it('should preserve the empty result for an empty AST collection', function () {
    expect(simplifyAST([])).to.deep.equal({});
  });

  it('should simplify a basic structure with an inline fragment', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        user {
          ... on User {
            name
          }
        }
      }
    `))).to.deep.equal({
      args: {},
      fields: {
        user: {
          args: {},
          fields: {
            name: {
              args: {},
              fields: {}
            }
          }
        }
      }
    });
  });

  it('should distinguish a field from a fragment with the same name', async function () {
    let simplified;
    const viewerType = new GraphQLObjectType({
      name: 'SimplifyASTSameNameViewer',
      fields: {
        viewer: {
          type: GraphQLString
        }
      }
    });
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'SimplifyASTSameNameQuery',
        fields: {
          viewer: {
            type: viewerType,
            resolve(source, args, context, info) {
              simplified = simplifyAST(info.fieldNodes, info);

              return {viewer: 'ok'};
            }
          }
        }
      })
    });

    const result = await graphql({
      schema,
      source: `
        query SimplifyASTSameName {
          viewer {
            ...viewer
          }
        }

        fragment viewer on SimplifyASTSameNameViewer {
          viewer
        }
      `
    });

    expect(result.errors).to.equal(undefined);
    expect(result.data.viewer.viewer).to.equal('ok');
    expect(simplified).to.deep.equal({
      fields: {
        viewer: {
          args: {},
          fields: {}
        }
      }
    });
  });

  it('should ignore a fragment spread without fragment information', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        user {
          ...Missing
        }
      }
    `))).to.deep.equal({
      args: {},
      fields: {
        user: {
          args: {},
          fields: {}
        }
      }
    });
  });

  it('should ignore inherited fragment map entries', function () {
    const inheritedFragment = parseFirstDefinition(`
      fragment Inherited on User {
        leaked
      }
    `);
    const presentFragment = parseFirstDefinition(`
      fragment Present on User {
        present
      }
    `);
    const fragments = Object.create({Inherited: inheritedFragment});
    fragments.Present = presentFragment;

    expect(simplifyAST(parseFirstDefinition(`
      {
        user {
          ...Inherited
        }
      }
    `), {fragments})).to.deep.equal({
      args: {},
      fields: {
        user: {
          args: {},
          fields: {}
        }
      }
    });
  });

  it('should expose a $parent', function () {
    var ast = simplifyAST(parseFirstDefinition(`
      {
        users {
          name
          projects(first: 1) {
            nodes {
              name
            }
          }
        }
      }
    `));

    expect(ast.fields.users.fields.projects.fields.nodes.$parent).to.be.ok;
    expect(ast.fields.users.fields.projects.fields.nodes.$parent.args).to.deep.equal({
      first: '1'
    });
  });

  it('should simplify a nested structure at the lowest level', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        users {
          name
          projects {
            node {
              name
            }
            node {
              id
            }
          }
        }
      }
    `))).to.deep.equal({
      args: {},
      fields: {
        users: {
          args: {},
          fields: {
            name: {
              args: {},
              fields: {}
            },
            projects: {
              args: {},
              fields: {
                node: {
                  args: {},
                  fields: {
                    name: {
                      args: {},
                      fields: {}
                    },
                    id: {
                      args: {},
                      fields: {}
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
  });

  it('should simplify a nested structure duplicated at a high level', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        users {
          name
          projects {
            node {
              name
            }
          }
          projects {
            node {
              id
            }
          }
        }
      }
    `))).to.deep.equal({
      args: {},
      fields: {
        users: {
          args: {},
          fields: {
            name: {
              args: {},
              fields: {}
            },
            projects: {
              args: {},
              fields: {
                node: {
                  args: {},
                  fields: {
                    name: {
                      args: {},
                      fields: {}
                    },
                    id: {
                      args: {},
                      fields: {}
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
  });

  it('should simplify a structure with aliases', function () {
    expect(simplifyAST(parseFirstDefinition(`
      {
        luke: human(id: "1000") {
          name
        }
        leia: human(id: "1003") {
          firstName: name
        }
      }
    `))).to.deep.equal({
      args: {},
      fields: {
        luke: {
          key: 'human',
          args: {
            id: '1000'
          },
          fields: {
            name: {
              args: {},
              fields: {}
            }
          }
        },
        leia: {
          key: 'human',
          args: {
            id: '1003'
          },
          fields: {
            firstName: {
              key: 'name',
              args: {},
              fields: {}
            }
          }
        }
      }
    });
  });

  it('should safely simplify aliases that match inherited object keys', function () {
    const viewerType = new GraphQLObjectType({
      name: 'SimplifyASTInheritedKeyViewer',
      fields: {
        name: {
          type: GraphQLString
        }
      }
    });
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'SimplifyASTInheritedKeyQuery',
        fields: {
          viewer: {
            type: viewerType
          }
        }
      })
    });
    const document = parse(`
      {
        __proto__: viewer {
          name
        }
        constructor: viewer {
          name
        }
        toString: viewer {
          name
        }
      }
    `);

    expect(validate(schema, document)).to.deep.equal([]);

    const protectedTargets = [
      Object.prototype,
      Object,
      Object.prototype.toString
    ];
    const descriptorsBefore = protectedTargets.map((target) =>
      Object.getOwnPropertyDescriptors(target)
    );

    try {
      const ast = simplifyAST(document.definitions[0]);
      const aliases = ['__proto__', 'constructor', 'toString'];

      expect(Object.getPrototypeOf(ast.fields)).to.equal(Object.prototype);
      expect(Object.keys(ast.fields)).to.deep.equal(aliases);

      aliases.forEach((alias) => {
        expect(Object.prototype.hasOwnProperty.call(ast.fields, alias)).to.equal(true);
        expect(ast.fields[alias].key).to.equal('viewer');

        const parentDescriptor = Object.getOwnPropertyDescriptor(
          ast.fields[alias].fields.name,
          '$parent'
        );

        expect(parentDescriptor).to.include({
          configurable: false,
          enumerable: false,
          writable: false
        });
        expect(parentDescriptor.value).to.equal(ast.fields[alias]);
      });

      protectedTargets.forEach((target, index) => {
        expect(Object.getOwnPropertyDescriptors(target)).to.deep.equal(
          descriptorsBefore[index]
        );
      });
    } finally {
      protectedTargets.forEach((target, index) => {
        const descriptors = descriptorsBefore[index];

        Reflect.ownKeys(target).forEach((key) => {
          if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
            delete target[key];
          }
        });
        Object.defineProperties(target, descriptors);
      });
    }
  });
});
