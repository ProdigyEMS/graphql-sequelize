'use strict';

import Sequelize from 'sequelize';
import type { Model, ModelStatic } from 'sequelize';
import { describe, expect, it } from 'vitest';
import defaultListArgs from '../../src/defaultListArgs.js';

import { sequelize } from '../support/helper.js';

import {
  GraphQLString,
  GraphQLInt,
  GraphQLScalarType
} from 'graphql';

describe('defaultListArgs', function () {
  it('should return a limit key', function () {
    const args = defaultListArgs();

    expect(args).toHaveProperty('limit');
    expect(args.limit.type).toBe(GraphQLInt);
  });

  it('should return a order key', function () {
    const args = defaultListArgs();

    expect(args).toHaveProperty('order');
    expect(args.order.type).toBe(GraphQLString);
  });

  describe('will have an "where" argument', function () {

    it('that is an GraphQLScalarType', function () {
      const Model = sequelize.define('DefaultArgModel', {
        modelId: {
          type: Sequelize.STRING,
          primaryKey: true
        }
      });

      const defaultListArgsWithLegacyArgument = defaultListArgs as unknown as (
        model: ModelStatic<Model>
      ) => ReturnType<typeof defaultListArgs>;
      const args = defaultListArgsWithLegacyArgument(Model);

      expect(args).toHaveProperty('where');
      expect(args.where.type).toBeInstanceOf(GraphQLScalarType);
      expect(args.where.description).toBe(
        'A JSON object conforming to the shape specified in ' +
          'http://docs.sequelizejs.com/en/latest/docs/querying/'
      );
    });

  });

});
