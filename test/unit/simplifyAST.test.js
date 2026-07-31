'use strict';

import {expect} from 'chai';
import {
  graphql,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString
} from 'graphql';
import simplifyAST from '../../src/simplifyAST';
var parser = require('graphql/language/parser').parse // eslint-disable-line
  , parse = function (query) {
    return parser(query).definitions[0];
  };

describe('simplifyAST', function () {
  it('should simplify a basic nested structure', function () {
    expect(simplifyAST(parse(`
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
    expect(simplifyAST(parse(`
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
    expect(simplifyAST(parse(`
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
    expect(simplifyAST(parse(`
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
    expect(simplifyAST(parse(`
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
    expect(simplifyAST(parse(`
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
    expect(simplified.fields.item.args.limit).to.equal(2);
  });

  it('should simplify a basic structure with an inline fragment', function () {
    expect(simplifyAST(parse(`
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

  it('should expose a $parent', function () {
    var ast = simplifyAST(parse(`
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
    expect(simplifyAST(parse(`
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
    expect(simplifyAST(parse(`
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
    expect(simplifyAST(parse(`
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
});
