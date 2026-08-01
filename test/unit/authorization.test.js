'use strict';

import { expect } from 'chai';
import { replaceWhereOperators } from '../../src/replaceWhereOperators.js';
import argsToFindOptions from '../../src/argsToFindOptions.js';
import Sequelize from 'sequelize';

/**
 * The filtering boundary.
 *
 * A client controls the keys inside `where` and `orderBy`. Only attributes a
 * model explicitly marks `filterable: true` may be filtered on -- that flag is
 * how the consuming service enforces department scoping, so a change that
 * quietly widens what is accepted is a security regression, not a test
 * failure.
 *
 * The rest of the suite marks fixture attributes filterable so queries
 * succeed, which means nothing there exercises the refusal. These specs cover
 * it directly, and are written to fail loudly if the check ever inverts.
 */
describe('authorization: filterable attributes', function () {
  describe('replaceWhereOperators', function () {
    it('rejects an attribute that is not filterable', function () {
      expect(() =>
        replaceWhereOperators(
          { secret: { eq: 1 } },
          { filterableAttributes: ['allowed'] }
        )
      ).to.throw(/Unknown attribute: secret/);
    });

    it('accepts an attribute that is filterable', function () {
      expect(() =>
        replaceWhereOperators(
          { allowed: { eq: 1 } },
          { filterableAttributes: ['allowed'] }
        )
      ).to.not.throw();
    });

    it('treats prototype-named attributes as own field names', function () {
      const expression = Object.fromEntries([
        ['__proto__', 'proto'],
        ['constructor', 'constructor'],
        ['toString', 'to-string']
      ]);
      const result = replaceWhereOperators(expression, {
        filterableAttributes: ['__proto__', 'constructor', 'toString']
      });

      expect(Object.keys(result)).to.have.members([
        '__proto__',
        'constructor',
        'toString'
      ]);
      expect(
        Object.getOwnPropertyDescriptor(result, '__proto__').value
      ).to.equal('proto');
      expect(result.constructor).to.equal('constructor');
      expect(result.toString).to.equal('to-string');
    });

    it('fails closed when the filterable set is empty', function () {
      // An empty list must reject everything rather than wave everything
      // through. This is the shape a caller gets when it forgets to pass its
      // filterable set, so the safe direction matters.
      expect(() =>
        replaceWhereOperators({ anything: { eq: 1 } }, { filterableAttributes: [] })
      ).to.throw(/Unknown attribute: anything/);
    });

    it('fails closed when no options are supplied at all', function () {
      expect(() => replaceWhereOperators({ anything: { eq: 1 } })).to.throw(
        /Unknown attribute: anything/
      );
    });

    it('only skips validation when explicitly told to', function () {
      // The one escape hatch, used by relay's argsToWhere where keys come from
      // the application's own callback rather than from client input. It must
      // be impossible to reach by omission -- see the two specs above.
      expect(() =>
        replaceWhereOperators(
          { anything: { eq: 1 } },
          { validateAttributes: false }
        )
      ).to.not.throw();
    });

    it('validates nested attributes, not just top-level ones', function () {
      expect(() =>
        replaceWhereOperators(
          { allowed: { and: { secret: 1 } } },
          { filterableAttributes: ['allowed'] }
        )
      ).to.throw(/Unknown attribute: secret/);
    });

    it('validates attributes whose values are arrays', function () {
      expect(() =>
        replaceWhereOperators(
          { secret: [1, 2] },
          { filterableAttributes: ['allowed'] }
        )
      ).to.throw(/Unknown attribute: secret/);
    });

    it('enforces requiredFilters when the filter is absent', function () {
      expect(() =>
        replaceWhereOperators(
          { allowed: { eq: 1 } },
          {
            filterableAttributes: ['allowed'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.throw(/Filter organizationId is missing/);
    });

    it('rejects invalid required filter names', function () {
      [[''], [undefined], Array(1)].forEach((requiredFilters) => {
        expect(() =>
          replaceWhereOperators(
            {},
            {
              filterableAttributes: [],
              requiredFilters
            }
          )
        ).to.throw(/requiredFilters must contain non-empty strings/);
      });
    });

    it('passes when a required filter is present', function () {
      expect(() =>
        replaceWhereOperators(
          { organizationId: { eq: 7 } },
          {
            filterableAttributes: ['organizationId'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.not.throw();
    });

    it('accepts a required filter satisfied inside and', function () {
      // The satisfying key is nested, so it was cleared in a recursive call
      // whose result never reached the top-level check. It failed closed --
      // rejecting a query that did supply the filter -- rather than open.
      expect(() =>
        replaceWhereOperators(
          { and: [{ organizationId: 1 }] },
          {
            filterableAttributes: ['organizationId'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.not.throw();
    });

    it('accepts a required filter satisfied inside or', function () {
      expect(() =>
        replaceWhereOperators(
          { or: [{ organizationId: 1 }, { organizationId: 2 }] },
          {
            filterableAttributes: ['organizationId'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.not.throw();
    });

    it('requires every or branch to supply each required filter', function () {
      expect(() =>
        replaceWhereOperators(
          {
            or: [
              { organizationId: 1, departmentId: 10 },
              { organizationId: 2 }
            ]
          },
          {
            filterableAttributes: ['organizationId', 'departmentId'],
            requiredFilters: ['organizationId', 'departmentId']
          }
        )
      ).to.throw(/Filter departmentId is missing/);
    });

    it('requires every object-form or branch to supply the filter', function () {
      expect(() =>
        replaceWhereOperators(
          { or: { organizationId: 1, allowed: 2 } },
          {
            filterableAttributes: ['organizationId', 'allowed'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.throw(/Filter organizationId is missing/);
    });

    it('does not accept an empty or as a required filter', function () {
      expect(() =>
        replaceWhereOperators(
          { or: [] },
          {
            filterableAttributes: ['organizationId'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.throw(/Filter organizationId is missing/);
    });

    it('does not accept a required filter nested inside another attribute', function () {
      expect(() =>
        replaceWhereOperators(
          { allowed: { organizationId: { eq: 7 } } },
          {
            filterableAttributes: ['allowed', 'organizationId'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.throw(/Filter organizationId is missing/);
    });

    it('does not accept a required filter beneath not', function () {
      expect(() =>
        replaceWhereOperators(
          { not: { organizationId: 1 } },
          {
            filterableAttributes: ['organizationId'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.throw(/Filter organizationId is missing/);
    });

    it('does not accept negative operators on a required filter', function () {
      ['ne', 'notIn', 'notLike'].forEach((operator) => {
        expect(() =>
          replaceWhereOperators(
            { organizationId: { [operator]: 1 } },
            {
              filterableAttributes: ['organizationId'],
              requiredFilters: ['organizationId']
            }
          )
        ).to.throw(/Filter organizationId is missing/);
      });
    });

    it('only accepts equality or membership operators on a required filter', function () {
      expect(() =>
        replaceWhereOperators(
          { organizationId: { gt: 1 } },
          {
            filterableAttributes: ['organizationId'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.throw(/Filter organizationId is missing/);

      ['eq', 'in', 'is'].forEach((operator) => {
        expect(() =>
          replaceWhereOperators(
            { organizationId: { [operator]: 1 } },
            {
              filterableAttributes: ['organizationId'],
              requiredFilters: ['organizationId']
            }
          )
        ).to.not.throw();
      });
    });

    it('accepts scalar and array shorthand for a required filter', function () {
      [7, [7, 8]].forEach((value) => {
        expect(() =>
          replaceWhereOperators(
            { organizationId: value },
            {
              filterableAttributes: ['organizationId'],
              requiredFilters: ['organizationId']
            }
          )
        ).to.not.throw();
      });
    });

    it('accepts a required filter satisfied several levels down', function () {
      expect(() =>
        replaceWhereOperators(
          { and: [{ or: [{ organizationId: { eq: 1 } }] }] },
          {
            filterableAttributes: ['organizationId'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.not.throw();
    });

    it('still rejects when no nesting supplies the required filter', function () {
      // The fix must not turn the check into a no-op: this is the case the
      // requirement exists for.
      expect(() =>
        replaceWhereOperators(
          { and: [{ allowed: 1 }, { or: [{ allowed: 2 }] }] },
          {
            filterableAttributes: ['allowed', 'organizationId'],
            requiredFilters: ['organizationId']
          }
        )
      ).to.throw(/Filter organizationId is missing/);
    });

    it('enforces every required filter, not just the first', function () {
      expect(() =>
        replaceWhereOperators(
          { and: [{ organizationId: 1 }] },
          {
            filterableAttributes: ['organizationId', 'departmentId'],
            requiredFilters: ['organizationId', 'departmentId']
          }
        )
      ).to.throw(/Filter departmentId is missing/);
    });

    it('does not consume the caller\'s requiredFilters array', function () {
      // The Set is built per call. Sharing one across calls would let the
      // first query satisfy the requirement for every later one.
      const requiredFilters = ['organizationId'];
      const options = {
        filterableAttributes: ['organizationId'],
        requiredFilters
      };

      replaceWhereOperators({ organizationId: 1 }, options);

      // The array the caller handed in is untouched...
      expect(requiredFilters).to.deep.equal(['organizationId']);

      // ...so a later query that omits the filter is still rejected.
      expect(() => replaceWhereOperators({}, options)).to.throw(
        /Filter organizationId is missing/
      );
    });
  });

  describe('argsToFindOptions', function () {
    it('preserves null as the public attribute-validation opt-out', function () {
      const findOptions = argsToFindOptions(
        { where: { secret: 1 } },
        null,
        {},
        [],
        []
      );

      expect(findOptions.where).to.deep.equal({ secret: 1 });
    });

    it('drops a where key that is not filterable', function () {
      // Silently dropping rather than throwing is the existing contract. The
      // risk to guard against is the opposite -- the key being passed through
      // into the query.
      const findOptions = argsToFindOptions(
        { secret: 'x' },
        ['allowed'],
        {},
        [],
        []
      );

      expect(findOptions.where).to.be.undefined;
    });

    it('keeps a where key that is filterable', function () {
      const findOptions = argsToFindOptions(
        { allowed: 'x' },
        ['allowed'],
        {},
        [],
        []
      );

      expect(findOptions.where).to.deep.equal({ allowed: 'x' });
    });
  });

  describe('operator keys', function () {
    // Regression: on sequelize 4+ the operator map yields Symbols. The model
    // and attribute checks called .toLowerCase() on the key, so any nested
    // object beneath an operator threw a TypeError. Symbols come only from
    // that fixed map, so skipping them does not widen the filterable surface.
    it('handles a nested object under an operator key', function () {
      expect(() =>
        replaceWhereOperators(
          { lt: { allowed: 1 } },
          { filterableAttributes: ['allowed'] }
        )
      ).to.not.throw();
    });

    it('still rejects an unknown attribute beneath an operator key', function () {
      expect(() =>
        replaceWhereOperators(
          { lt: { secret: 1 } },
          { filterableAttributes: ['allowed'] }
        )
      ).to.throw(/Unknown attribute: secret/);
    });

    it('maps graphql-friendly operator names to sequelize operators', function () {
      const result = replaceWhereOperators(
        { allowed: { gt: 1 } },
        { filterableAttributes: ['allowed'] }
      );

      const [seqMajVer] = Sequelize.version.split('.');
      const expected =
        Number(seqMajVer) <= 3 ? { allowed: { $gt: 1 } } : { allowed: { [Sequelize.Op.gt]: 1 } };

      expect(result).to.deep.equal(expected);
    });
  });
});
