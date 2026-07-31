'use strict';

import { expect } from 'chai';
import { GraphQLScalarType } from 'graphql';

import {
  argsToFindOptions,
  resolver,
  JSONType,
  DateType
} from '../../src';

describe('package exports', function () {
  it('exports argsToFindOptions as a callable function', function () {
    expect(argsToFindOptions).to.be.a('function');
  });

  it('exports resolver as a callable function', function () {
    expect(resolver).to.be.a('function');
  });

  it('exports JSONType as a GraphQL scalar', function () {
    expect(JSONType).to.be.instanceOf(GraphQLScalarType);
  });

  it('exports DateType as a GraphQL scalar', function () {
    expect(DateType).to.be.instanceOf(GraphQLScalarType);
  });
});
