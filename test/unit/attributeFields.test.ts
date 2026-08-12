'use strict';

import { beforeAll, describe, expect, it } from 'vitest';
import Sequelize from 'sequelize';
import attributeFields from '../../src/attributeFields.js';
import DateType from '../../src/types/dateType.js';

import { sequelize } from '../support/helper.js';


import {
  type GraphQLFieldConfigMap,
  type GraphQLOutputType,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLNonNull,
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLList,
  GraphQLObjectType,
  GraphQLSchema
} from 'graphql';
import type { Model as SequelizeModel, ModelStatic } from 'sequelize';

import {
  toGlobalId
} from 'graphql-relay';

/**
 * Assert and narrow a GraphQL output type to a non-null wrapper.
 *
 * @param type GraphQL output type to inspect
 * @return nothing; narrows the supplied type when the assertion passes
 */
function expectNonNull(
  type: GraphQLOutputType
): asserts type is GraphQLNonNull<GraphQLOutputType> {
  expect(type).to.be.an.instanceOf(GraphQLNonNull);
}

/**
 * Assert and narrow a GraphQL output type to a list wrapper.
 *
 * @param type GraphQL output type to inspect
 * @return nothing; narrows the supplied type when the assertion passes
 */
function expectList(
  type: GraphQLOutputType
): asserts type is GraphQLList<GraphQLOutputType> {
  expect(type).to.be.an.instanceOf(GraphQLList);
}

/**
 * Assert and narrow a GraphQL output type to an enum.
 *
 * @param type GraphQL output type to inspect
 * @return nothing; narrows the supplied type when the assertion passes
 */
function expectEnum(
  type: GraphQLOutputType
): asserts type is GraphQLEnumType {
  expect(type).to.be.an.instanceOf(GraphQLEnumType);
}

describe('attributeFields', function () {
  let Model: ModelStatic<SequelizeModel>;
  const modelName = Math.random().toString();
  beforeAll(function () {
    Model = sequelize.define(modelName, {
      email: {
        type: Sequelize.STRING,
        allowNull: false
      },
      firstName: {
        type: Sequelize.STRING
      },
      lastName: {
        type: Sequelize.STRING
      },
      char: {
        type: Sequelize.CHAR
      },
      float: {
        type: Sequelize.FLOAT
      },
      decimal: {
        type: Sequelize.DECIMAL
      },
      enum: {
        type: Sequelize.ENUM('first', 'second')
      },
      enumSpecial: {
        type: Sequelize.ENUM('foo_bar', 'foo-bar', '25.8', 'two--specials', '¼', ' ¼--½_¾ - ')
      },
      enumArray: {
        type: Sequelize.ARRAY(Sequelize.ENUM('first', 'second'))
      },
      list: {
        type: Sequelize.ARRAY(Sequelize.STRING)
      },
      virtualInteger: {
        type: new Sequelize.VIRTUAL(Sequelize.INTEGER)
      },
      virtualBoolean: {
        type: new Sequelize.VIRTUAL(Sequelize.BOOLEAN)
      },
      date: {
        type: Sequelize.DATE
      },
      time: {
        type: Sequelize.TIME
      },
      dateonly: {
        type: Sequelize.DATEONLY
      },
      comment: {
        type: Sequelize.STRING,
        comment: 'This is a comment'
      }
    }, {
      timestamps: false
    });
  });

  it('should return fields for a simple model', function () {
    const fields = attributeFields(Model);

    expect(Object.keys(fields)).to.deep.equal([
      'id', 'email', 'firstName', 'lastName',
      'char', 'float', 'decimal',
      'enum', 'enumSpecial', 'enumArray',
      'list', 'virtualInteger', 'virtualBoolean',
      'date', 'time', 'dateonly', 'comment'
    ]);

    expectNonNull(fields.id.type);
    expect(fields.id.type.ofType).to.equal(GraphQLInt);

    expectNonNull(fields.email.type);
    expect(fields.email.type.ofType).to.equal(GraphQLString);

    expect(fields.firstName.type).to.equal(GraphQLString);

    expect(fields.lastName.type).to.equal(GraphQLString);

    expect(fields.char.type).to.equal(GraphQLString);

    expect(fields.enum.type).to.be.an.instanceOf(GraphQLEnumType);

    expect(fields.enumSpecial.type).to.be.an.instanceOf(GraphQLEnumType);

    expectList(fields.enumArray.type);
    expectEnum(fields.enumArray.type.ofType);

    expectList(fields.list.type);

    expect(fields.float.type).to.equal(GraphQLFloat);

    expect(fields.decimal.type).to.equal(GraphQLString);

    expect(fields.virtualInteger.type).to.equal(GraphQLInt);

    expect(fields.virtualBoolean.type).to.equal(GraphQLBoolean);

    expect(fields.date.type).to.equal(DateType);

    expect(fields.time.type).to.equal(GraphQLString);

    expect(fields.dateonly.type).to.equal(GraphQLString);
  });

  it('should be possible to rename fields with a object map',function () {
    const fields = attributeFields(Model, {map: {id: 'mappedId'}});
    expect(Object.keys(fields)).to.deep.equal([
      'mappedId', 'email', 'firstName', 'lastName', 'char', 'float', 'decimal',
      'enum', 'enumSpecial', 'enumArray',
      'list', 'virtualInteger', 'virtualBoolean', 'date',
      'time', 'dateonly', 'comment'
    ]);
  });

  it('should be possible to rename fields with a function that maps keys',function () {
    const fields = attributeFields(Model, {
      map: k => k + 's'
    });
    expect(Object.keys(fields)).to.deep.equal([
      'ids', 'emails', 'firstNames', 'lastNames', 'chars', 'floats', 'decimals',
      'enums', 'enumSpecials', 'enumArrays',
      'lists', 'virtualIntegers', 'virtualBooleans',
      'dates', 'times', 'dateonlys', 'comments'
    ]);
  });

  it('should be possible to exclude fields', function () {
    const fields = attributeFields(Model, {
      exclude: [
        'id', 'email', 'char', 'float', 'decimal',
        'enum', 'enumSpecial', 'enumArray',
        'list', 'virtualInteger', 'virtualBoolean',
        'date','time','dateonly','comment'
      ]
    });

    expect(Object.keys(fields)).to.deep.equal(['firstName', 'lastName']);
  });

  it('should be able to exclude fields via a function', function () {
    const fields = attributeFields(Model, {
      exclude: field => Boolean(~[
        'id', 'email', 'char', 'float', 'decimal',
        'enum', 'enumSpecial', 'enumArray',
        'list', 'virtualInteger', 'virtualBoolean',
        'date','time','dateonly','comment'
      ].indexOf(field))
    });

    expect(Object.keys(fields)).to.deep.equal(['firstName', 'lastName']);
  });

  it('should be possible to specify specific fields', function () {
    const fields = attributeFields(Model, {
      only: ['id', 'email', 'list']
    });

    expect(Object.keys(fields)).to.deep.equal(['id', 'email', 'list']);
  });

  it('should be possible to specify specific fields via a function', function () {
    const fields = attributeFields(Model, {
      only: field => Boolean(~['id', 'email', 'list'].indexOf(field)),
    });

    expect(Object.keys(fields)).to.deep.equal(['id', 'email', 'list']);
  });

  it('should ignore unsupported selector objects like version 1', function () {
    const excluded = Reflect.apply(attributeFields, undefined, [
      Model,
      { exclude: new Set(['email']) }
    ]);
    const selected = Reflect.apply(attributeFields, undefined, [
      Model,
      { only: new Set(['email']) }
    ]);

    expect(excluded).to.have.property('email');
    expect(selected).to.have.property('id');
    expect(selected).to.have.property('email');
  });

  it('should be possible to automatically set a relay globalId', function () {
    const fields = attributeFields(Model, {
      globalId: true
    });

    expect(fields.id.resolve).to.be.ok;
    expect(fields.id.type).to.have.nested.property('ofType.name', 'ID');
    expect(Reflect.apply(fields.id.resolve!, undefined, [{
      id: 23
    }])).to.equal(toGlobalId(Model.name, 23));
  });

  it('should automatically name enum types', function () {
    const fields = attributeFields(Model);

    expect(fields.enum.type).to.have.property('name').that.is.not.undefined;
    expect(fields.enumSpecial.type).to.have.property('name').that.is.not.undefined;

    expect(fields.enum.type).to.have.property('name', modelName + 'enum' + 'EnumType');
    expect(fields.enumSpecial.type).to.have.property('name', modelName + 'enumSpecial' + 'EnumType');
    expect(fields.enumArray.type).to.have.nested.property('ofType.name', modelName + 'enumArray' + 'EnumType');
  });

  it('should support enum values with characters not allowed by GraphQL', function () {
    const fields = attributeFields(Model);
    expectEnum(fields.enumSpecial.type);
    const enums = fields.enumSpecial.type.getValues();

    expect(enums).to.not.be.undefined;
    expect(enums[0].name).to.equal('foo_bar');
    expect(enums[0].value).to.equal('foo_bar');
    expect(enums[1].name).to.equal('fooBar');
    expect(enums[1].value).to.equal('foo-bar');
    expect(enums[2].name).to.equal('_258');
    expect(enums[2].value).to.equal('25.8');
    expect(enums[3].name).to.equal('twoSpecials');
    expect(enums[3].value).to.equal('two--specials');
    expect(enums[4].name).to.equal('frac14');
    expect(enums[4].value).to.equal('¼');
    expect(enums[5].name).to.equal('frac14Frac12_frac34');
    expect(enums[5].value).to.equal(' ¼--½_¾ - ');
  });

  it('should support enum values with underscores', function () {
    const fields = attributeFields(Model);
    expectEnum(fields.enumSpecial.type);
    const enums = fields.enumSpecial.type.getValues();

    expect(enums).to.not.be.undefined;
    expect(enums[0].name).to.equal('foo_bar');
    expect(enums[0].value).to.equal('foo_bar');
  });

  it('should not create multiple enum types with same name when using cache', function () {

    // Create Schema
    const schemaFn = function (
      fields1: GraphQLFieldConfigMap<SequelizeModel, unknown>,
      fields2: GraphQLFieldConfigMap<SequelizeModel, unknown>
    ) {
      return function () {
        const object1 = new GraphQLObjectType({
          name: 'Object1',
          fields: fields1
        });
        const object2 = new GraphQLObjectType({
          name: 'Object2',
          fields: fields2
        });
        return new GraphQLSchema({
          query: new GraphQLObjectType({
            name: 'RootQueryType',
            fields: {
              object1: {
                type: object1,
                resolve: function () {
                  return {};
                }
              },
              object2: {
                type: object2,
                resolve: function () {
                  return {};
                }
              }
            }
          })
        });
      };
    };

    // Bad: Will create multiple/duplicate types with same name
    const fields1a = attributeFields(Model);
    const fields2a = attributeFields(Model);

    expect(schemaFn(fields1a, fields2a)).to.throw(Error);

    // Good: Will use cache and not create mutliple/duplicate types with same name
    const cache = {};
    const fields1b = attributeFields(Model, {cache: cache});
    const fields2b = attributeFields(Model, {cache: cache});

    expect(schemaFn(fields1b, fields2b)).to.not.throw(Error);

  });

  it('should replace an incompatible scalar enum cache entry', function () {
    const typeName = `${Model.name}enumEnumType`;
    const cache = {
      [typeName]: GraphQLString
    };

    const fields = attributeFields(Model, {cache});

    expect(cache[typeName]).to.be.an.instanceOf(GraphQLEnumType);
    expect(fields.enum.type).to.equal(cache[typeName]);
  });

  it('should replace an incompatible list enum cache entry', function () {
    const typeName = `${Model.name}enumArrayEnumType`;
    const cache = {
      [typeName]: GraphQLString
    };

    const fields = attributeFields(Model, {cache});

    expect(cache[typeName]).to.be.an.instanceOf(GraphQLEnumType);
    expectList(fields.enumArray.type);
    expect(fields.enumArray.type.ofType).to.equal(cache[typeName]);
  });

  describe('with non-default primary key', function () {
    let ModelWithoutId: ModelStatic<SequelizeModel>;
    const modelName = Math.random().toString();
    beforeAll(function () {
      ModelWithoutId = sequelize.define(modelName, {
        email: {
          primaryKey: true,
          type: Sequelize.STRING,
        },
        firstName: {
          type: Sequelize.STRING
        },
        lastName: {
          type: Sequelize.STRING
        },
        float: {
          type: Sequelize.FLOAT
        },
      }, {
        timestamps: false
      });
    });

    it('should return fields', function () {
      const fields = attributeFields(ModelWithoutId);

      expect(Object.keys(fields)).to.deep.equal(['email', 'firstName', 'lastName', 'float']);

      expectNonNull(fields.email.type);
      expect(fields.email.type.ofType).to.equal(GraphQLString);

      expect(fields.firstName.type).to.equal(GraphQLString);

      expect(fields.lastName.type).to.equal(GraphQLString);

      expect(fields.float.type).to.equal(GraphQLFloat);
    });

    it('should be possible to automatically set a relay globalId', function () {
      const fields = attributeFields(ModelWithoutId, {
        globalId: true
      });

      expect(fields.id.resolve).to.be.ok;
      expect(fields.id.type).to.have.nested.property('ofType.name', 'ID');
      expect(Reflect.apply(fields.id.resolve!, undefined, [{
        email: 'idris@example.com'
      }])).to.equal(toGlobalId(ModelWithoutId.name, 'idris@example.com'));
    });

    it('should be possible to bypass NonNull', function () {
      const fields = attributeFields(Model, {
        allowNull: true,
      });

      expect(fields.email.type).to.not.be.an.instanceOf(GraphQLNonNull);
      expect(fields.email.type).to.equal(GraphQLString);
    });

    it('should be possible to comment attributes', function () {
      const fields = attributeFields(Model, {
        commentToDescription: true
      });

      expect(fields.comment.description).to.equal('This is a comment');
    });

  });
});
