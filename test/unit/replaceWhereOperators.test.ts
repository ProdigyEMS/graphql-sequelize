import { describe, expect, it } from 'vitest';
import {replaceWhereOperators} from '../../src/replaceWhereOperators.js';
import Sequelize, {Op} from 'sequelize';

const sequelizeVersion = (
  Sequelize as unknown as { readonly version: string }
).version;
const [seqMajVer] = sequelizeVersion.split('.');
const sequelizeMajorVersion = Number(seqMajVer);

describe('replaceWhereOperators', () => {
  it('should take an Object of grapqhl-friendly keys and replace with the correct sequelize operators', ()=> {

    const before = {
      and: 1,
      or: '1',
      gt: [{and: '1', or: '1'}, {between: '1', overlap: '1'}],
      gte: 1,
      lt: {
        and: {
          test: [{or: '1'}]
        }
      },
      lte: 1,
      ne: 1,
      between: 1,
      notBetween: 1,
      in: 1,
      notIn: 1,
      notLike: 1,
      iLike: 1,
      notILike: 1,
      like: 1,
      overlap: 1,
      contains: 1,
      contained: 1,
      any: 1,
      col: 1
    };

    let after;
    if (sequelizeMajorVersion <= 3) {
      after = {
        $and: 1,
        $or: '1',
        $gt: [{$and: '1', $or: '1'}, {$between: '1', $overlap: '1'}],
        $gte: 1,
        $lt: {
          $and: {
            test: [{$or: '1'}]
          }
        },
        $lte: 1,
        $ne: 1,
        $between: 1,
        $notBetween: 1,
        $in: 1,
        $notIn: 1,
        $notLike: 1,
        $iLike: 1,
        $notILike: 1,
        $like: 1,
        $overlap: 1,
        $contains: 1,
        $contained: 1,
        $any: 1,
        $col: 1
      };
    } else {
      after = {
        [Op.and]: 1,
        [Op.or]: '1',
        [Op.gt]: [
          {
            [Op.and]: '1',
            [Op.or]: '1'
          },
          {
            [Op.between]: '1',
            [Op.overlap]: '1'
          }
        ],
        [Op.gte]: 1,
        [Op.lt]: {
          [Op.and]: {
            test: [{[Op.or]: '1'}]
          }
        },
        [Op.lte]: 1,
        [Op.ne]: 1,
        [Op.between]: 1,
        [Op.notBetween]: 1,
        [Op.in]: 1,
        [Op.notIn]: 1,
        [Op.notLike]: 1,
        [Op.iLike]: 1,
        [Op.notILike]: 1,
        [Op.like]: 1,
        [Op.overlap]: 1,
        [Op.contains]: 1,
        [Op.contained]: 1,
        [Op.any]: 1,
        [Op.col]: 1
      };

    }
    expect(replaceWhereOperators(before, { validateAttributes: false })).to.deep.equal(after);
  });

  it('should not mutate argument', () => {
    const before = {
      prop1: {gt: 12},
      prop2: {or: [{eq: 3}, {eq: 4}]}
    };
    function proxify<T extends object>(target: T): T {
      return new Proxy(target, {
        get(proxyTarget, property, receiver) {
          const value: unknown = Reflect.get(proxyTarget, property, receiver);

          return typeof value === 'object' && value !== null
            ? proxify(value)
            : value;
        },
        set() {
          expect.fail('It tryes to change argument');
        }
      });
    }
    let after;
    if (sequelizeMajorVersion <= 3) {
      after = {
        prop1: {$gt: 12},
        prop2: {$or: [{$eq: 3}, {$eq: 4}]}
      };
    } else {
      after = {
        prop1: {[Op.gt]: 12},
        prop2: {[Op.or]: [{[Op.eq]: 3}, {[Op.eq]: 4}]}
      };
    }
    expect(replaceWhereOperators(proxify(before), { filterableAttributes: ['prop1', 'prop2'] })).to.deep.equal(after);
  });
});
