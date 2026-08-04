'use strict';

import { describe, expect, it } from 'vitest';
import argsToFindOptions from '../../src/argsToFindOptions.js';

describe('argsToFindOptions', function () {
  // 'property' is included because these specs filter on it. Scalar where
  // values are validated against the filterable set like any other attribute
  // reference, so an attribute a spec filters on has to be declared here.
  const targetAttributes = ['order', 'limit', 'offset', 'property'];

  it('should return empty with no args or attributes', function () {
    const findOptions = argsToFindOptions(null, null);
    expect(findOptions).to.be.empty;
  });

  it('should not include "order" when present in both args and targetAttributes', function () {
    const findOptions = argsToFindOptions({ where: { property: 1 }, order: 'order' }, targetAttributes, {}, [], []);

    expect(findOptions).to.have.ownProperty('where');
    expect(findOptions.where).not.to.have.ownProperty('order');
    expect(findOptions).to.have.ownProperty('order');
    expect(findOptions.order).to.be.an.instanceOf(Array);
  });

  it('should not include "limit" when present in both args targetAttributes', function () {
    const findOptions = argsToFindOptions({ where: { property: 1 }, limit: 1 }, targetAttributes, {}, [], []);

    expect(findOptions).to.have.ownProperty('where');
    expect(findOptions.where).not.to.have.ownProperty('limit');
    expect(findOptions).to.have.ownProperty('limit');
    expect(findOptions.limit).to.equal(1);
  });

  it('should not include "offset" when present in both args and targetAttributes', function () {
    const findOptions = argsToFindOptions({ where: { property: 1 }, offset: 1 }, targetAttributes, {}, [], []);

    expect(findOptions).to.have.ownProperty('where');
    expect(findOptions.where).not.to.have.ownProperty('offset');
    expect(findOptions).to.have.ownProperty('offset');
    expect(findOptions.offset).to.be.equal(1);
  });

  it('should allow filtering by "order" column when in targetAttributes', function () {
    const findOptions = argsToFindOptions({ where: { order: 1 } }, targetAttributes, {}, [], []);
    expect(findOptions).to.have.ownProperty('where');
    expect(findOptions.where).to.have.ownProperty('order');
  });

  it('should allow filtering and ordering by "order" column when in targetAttributes', function () {
    const findOptions = argsToFindOptions({ where: { order: 1 }, order: 'order' }, targetAttributes, {}, [], []);
    expect(findOptions).to.have.ownProperty('where');
    expect(findOptions.where).to.have.ownProperty('order');
    expect(findOptions).to.have.ownProperty('order');
    expect(findOptions.order).to.be.an.instanceOf(Array);
  });

  it('should allow value = 0', function () {
    const findOptions = argsToFindOptions({ where: { order: 0 }, offset: 0, limit: 0 }, ['order'], {}, [], []);
    expect(findOptions).to.have.ownProperty('where');
    expect(findOptions.where).to.have.ownProperty('order');
    expect(findOptions).to.have.ownProperty('offset');
    expect(findOptions.where).to.have.ownProperty('order', 0);
    expect(findOptions.offset).to.be.equal(0);
    expect(findOptions.limit).to.be.equal(0);
  });

  it('should allow shorthand scalar filters when validation is disabled', function () {
    const findOptions = argsToFindOptions({ organizationId: 7 }, null);

    expect(findOptions.where).to.deep.equal({ organizationId: 7 });
  });

  it('should preserve an own __proto__ shorthand filter', function () {
    const shorthandValue = { eq: 7 };
    const args = Object.fromEntries([['__proto__', shorthandValue]]);
    const findOptions = argsToFindOptions(args, null);

    const where = findOptions.where as Record<string, unknown>;

    expect({
      hasOwnFilter: Object.prototype.hasOwnProperty.call(where, '__proto__'),
      prototype: Object.getPrototypeOf(where)
    }).to.deep.equal({ hasOwnFilter: true, prototype: null });
    expect(
      Object.getOwnPropertyDescriptor(where, '__proto__')?.value
    ).to.equal(shorthandValue);
  });

  it('should enforce required filters when where is omitted', function () {
    expect(() =>
      argsToFindOptions(
        { limit: 1 },
        ['organizationId'],
        {},
        [],
        ['organizationId']
      )
    ).to.throw(/Filter organizationId is missing/);
  });

  it('should reject invalid required filters when where is omitted', function () {
    expect(() =>
      Reflect.apply(argsToFindOptions, undefined, [
        { limit: 1 },
        ['organizationId'],
        {},
        [],
        'organizationId'
      ])
    ).to.throw(/requiredFilters must contain non-empty strings/);
  });
});
