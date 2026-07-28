'use strict';

import { expect } from 'chai';
import { replaceWhereOperators } from '../../src/replaceWhereOperators';
import argsToFindOptions from '../../src/argsToFindOptions';
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
  });

  describe('argsToFindOptions', function () {
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
