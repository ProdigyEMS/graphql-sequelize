import type {FindOptions} from 'sequelize';

import {
  replaceWhereOperators
} from './replaceWhereOperators.js';
import type {
  ReplaceWhereOptions,
  WhereExpression
} from './replaceWhereOperators.js';

export interface FindArguments {
  readonly [key: string]: unknown;
  readonly limit?: number | string;
  readonly offset?: number | string;
  readonly order?: string;
  readonly where?: WhereExpression | null;
}

/**
 * Translate GraphQL resolver arguments into Sequelize find options.
 *
 * @param args resolver arguments, including filterable scalar shorthand
 * @param filterableAttributes attributes permitted for filtering and ordering
 * @param filterableAttributesFields physical field names for permitted attributes
 * @param allowedModels associated models permitted in nested filters
 * @param requiredAttributes attributes every query must constrain
 * @return translated Sequelize find options
 */
export default function argsToFindOptions(
  args?: FindArguments | null,
  filterableAttributes?: readonly string[] | null,
  filterableAttributesFields: Readonly<Record<string, string>> = {},
  allowedModels: readonly string[] = [],
  requiredAttributes?: readonly string[]
): FindOptions {
  const result: FindOptions = {};
  let translatedWhere: WhereExpression | undefined;
  const whereOptions: ReplaceWhereOptions = {
    // The public positional API retains null as an explicit validation opt-out,
    // while ReplaceWhereOptions represents that choice with a boolean flag.
    filterableAttributes: filterableAttributes ?? undefined,
    filterableAttributesFields,
    allowedModels,
    requiredFilters: requiredAttributes,
    validateAttributes: filterableAttributes !== null
  };

  if (
    typeof requiredAttributes !== 'undefined' &&
    (!Array.isArray(requiredAttributes) || requiredAttributes.length > 0) &&
    (!args || args.where === null || typeof args.where === 'undefined')
  ) {
    replaceWhereOperators({}, whereOptions);
  }

  if (args) {
    Object.keys(args).forEach((key) => {
      const value = args[key];

      if (typeof value !== 'undefined') {
        if (key === 'limit') {
          result.limit = parseInt(value as string, 10);
        } else if (key === 'offset') {
          result.offset = parseInt(value as string, 10);
        } else if (key === 'order') {
          // The ordering column is client-supplied and was previously applied
          // without any check, so a caller could sort by any column in the
          // table regardless of whether the model marked it filterable.
          // Ordering by a column leaks information about it even when the
          // column itself is never selected, so it is validated against the
          // same set as `where`.
          const order = value as string;
          const descending = order.indexOf('reverse:') === 0;
          const orderAttribute = descending
            ? order.substring(8)
            : order;

          if (
            Array.isArray(filterableAttributes) &&
            !filterableAttributes.includes(orderAttribute)
          ) {
            throw new Error(`Unknown order by: ${orderAttribute}`);
          }

          result.order = [[orderAttribute, descending ? 'DESC' : 'ASC']];
        } else if (key === 'where') {
          // setup where
          // args.where is client-supplied, so attribute validation stays on.
          translatedWhere = replaceWhereOperators(
            value as WhereExpression,
            whereOptions
          );
          result.where = translatedWhere as FindOptions['where'];
        } else if (
          filterableAttributes === null ||
          (Array.isArray(filterableAttributes) &&
            filterableAttributes.includes(key))
        ) {
          translatedWhere = translatedWhere ||
            Object.create(null) as WhereExpression;
          translatedWhere[key] = value;
          result.where = translatedWhere as FindOptions['where'];
        } else if (typeof filterableAttributes === 'undefined') {
          throw new Error(`Unknown attribute: ${key}`);
        }
      }
    });
  }

  return result;
}
