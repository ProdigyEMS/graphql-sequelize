'use strict';


import {expect} from 'chai';
import Sequelize from 'sequelize';
import defaultArgs from '../../src/defaultArgs.js';
import {mapType} from '../../src/typeMapper.js';
import DateType from '../../src/types/dateType.js';

import { sequelize } from '../support/helper.js';

import {
  GraphQLString,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLScalarType
} from 'graphql';

describe('defaultArgs', function () {
  it('should return a key for a integer primary key', function () {
    var Model
      , args;

    Model = sequelize.define('DefaultArgModel', {});

    args = defaultArgs(Model);

    expect(args).to.have.ownProperty('id');
    expect(args.id.type).to.equal(GraphQLInt);
  });

  it('should return a key for a string primary key', function () {
    var Model
      , args;

    Model = sequelize.define('DefaultArgModel', {
      modelId: {
        type: Sequelize.STRING,
        primaryKey: true
      }
    });

    args = defaultArgs(Model);

    expect(args.modelId.type).to.equal(GraphQLString);
  });

  it('should return a key for a UUID primary key', function () {
    var Model
      , args;

    Model = sequelize.define('DefaultArgModel', {
      uuid: {
        type: Sequelize.UUID,
        primaryKey: true
      }
    });

    args = defaultArgs(Model);

    expect(args.uuid.type).to.equal(GraphQLString);
  });

  it('should return a key for a UUIDV4 primary key', function () {
    var Model
      , args;

    Model = sequelize.define('DefaultArgModel', {
      uuidv4: {
        type: Sequelize.UUIDV4,
        primaryKey: true
      }
    });

    args = defaultArgs(Model);

    expect(args.uuidv4.type).to.equal(GraphQLString);
  });

  it('should return multiple keys for a compound primary key', function () {
    var Model
      , args;

    Model = sequelize.define('UserHistory', {
      userId: {
        type: Sequelize.INTEGER,
        primaryKey: true,
      },
      timestamp: {
        type: Sequelize.DATE,
        primaryKey: true,
      },
    });

    args = defaultArgs(Model);

    expect(args.userId.type).to.equal(GraphQLInt);
    expect(args.timestamp.type).to.equal(DateType);
  });

  it('should reject primary keys mapped to output-only GraphQL types', function () {
    const Model = sequelize.define('DefaultArgInvalidTypeModel', {});
    const invalidType = new GraphQLObjectType({
      name: 'DefaultArgInvalidType',
      fields: {
        value: {
          type: GraphQLString
        }
      }
    });

    mapType(() => invalidType);

    try {
      expect(() => defaultArgs(Model)).to.throw(
        TypeError,
        'Primary key attribute "id" on model "DefaultArgInvalidTypeModel" must map to a GraphQL input type.'
      );
    } finally {
      mapType(null);
    }
  });

  describe('will have an "where" argument', function () {

    it('that is an GraphQLScalarType', function () {
      var Model
        , args;

      Model = sequelize.define('DefaultArgModel', {
        modelId: {
          type: Sequelize.STRING,
          primaryKey: true
        }
      });

      args = defaultArgs(Model);

      expect(args).to.have.ownProperty('where');
      expect(args.where.type).to.be.an.instanceOf(GraphQLScalarType);
      expect(args.where.description).to.equal(
        'A JSON object conforming to the shape specified in ' +
          'http://docs.sequelizejs.com/en/latest/docs/querying/'
      );
    });

  });


});
