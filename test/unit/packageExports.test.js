'use strict';

import { expect } from 'chai';
import { GraphQLScalarType } from 'graphql';

import {
  argsToFindOptions,
  resolver,
  JSONType,
  DateType
} from '../../src/index.js';
import * as publicApi from '../../src/index.js';

const expectedExports = [
  'DateType',
  'JSONType',
  'argsToFindOptions',
  'attributeFields',
  'createConnection',
  'createConnectionResolver',
  'createNodeInterface',
  'defaultArgs',
  'defaultListArgs',
  'relay',
  'resolver',
  'sequelizeConnection',
  'simplifyAST',
  'typeMapper'
];

describe('package exports', function () {
  it('preserves the exact version 1 runtime export surface', function () {
    expect(Object.keys(publicApi).sort()).to.deep.equal(expectedExports);
  });

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
