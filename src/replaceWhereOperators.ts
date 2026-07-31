import sequelizeOps from './sequelizeOps.js';

export type WhereKey = string | symbol;
export type WhereExpression = Record<WhereKey, unknown>;

export interface ReplaceWhereOptions {
  filterableAttributes?: readonly string[];
  filterableAttributesFields?: Readonly<Record<string, string>>;
  allowedModels?: readonly string[];
  requiredFilters?: readonly string[];
  validateAttributes?: boolean;
}

/**
 * Check whether a value is an expression object that can be traversed safely.
 *
 * @param value candidate expression value
 * @return whether the value is a plain object
 */
function isPlainObject(value: unknown): value is WhereExpression {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * Replace a key deeply in an object
 * @param expression expression to translate
 * @param keyMap GraphQL-friendly keys mapped to Sequelize keys
 * @param filterableAttributes attributes permitted at the filtering boundary
 * @param filterableAttributesFields physical field names for permitted attributes
 * @param allowedModels associated models permitted in nested filters
 * @return the translated expression
 */
function replaceKeyDeep(
  expression: WhereExpression,
  keyMap: Readonly<Record<string, WhereKey>>,
  filterableAttributes: readonly string[] | null,
  filterableAttributesFields: Readonly<Record<string, string>>,
  allowedModels: readonly string[]
): WhereExpression {
  const result: WhereExpression = {};

  return getOwnKeys(expression)
    .reduce((memo, key) => {
      // determine which key we are going to use
      const targetKey =
        typeof key === 'string' && keyMap[key] ? keyMap[key] : key;
      const value = expression[key];

      // On sequelize 4+ operator keys map to Symbols rather than strings (see
      // sequelizeOps). A Symbol is never a model name and never an attribute
      // name, so the checks below apply to string keys only. Symbols can only
      // originate from the fixed operator map, so skipping them does not
      // widen what a caller can filter on -- any key that is not a known
      // operator stays a string and is still validated.
      const isStringKey = typeof targetKey === 'string';

      // A null filterableAttributes means validation was explicitly disabled
      // by the caller (see replaceWhereOperators). An empty array still
      // validates, and rejects everything.
      const validateField = (target: string): void => {
        if (
          filterableAttributes !== null &&
          !filterableAttributes.includes(target)
        ) {
          throw new Error(`Unknown attribute: ${String(target)}`);
        }
      };

      if (Array.isArray(value)) {
        if (isStringKey) {
          validateField(targetKey);
        }

        // recurse if an array
        memo[targetKey] = value.map((entry: unknown) => {
          if (isPlainObject(entry)) {
            return replaceKeyDeep(
              entry,
              keyMap,
              filterableAttributes,
              filterableAttributesFields,
              allowedModels
            );
          }
          return entry;
        });
      } else if (isPlainObject(value)) {
        // On sequelize 4+ operator keys map to Symbols rather than strings
        const isModel =
          isStringKey &&
          allowedModels.some(
            (model) => model.toLowerCase() === targetKey.toLowerCase()
          );

        if (isModel) {
          Object.keys(value).forEach((column) => {
            validateField(column);
            memo[`$${String(key)}.${filterableAttributesFields[column]}$`] =
              value[column];
          });
        } else {
          if (isStringKey) {
            validateField(targetKey);
          }
          memo[targetKey] = replaceKeyDeep(
            value,
            keyMap,
            filterableAttributes,
            filterableAttributesFields,
            allowedModels
          );
        }
      } else {
        // Scalar value. This path was previously unvalidated, so while
        // `{ secret: { eq: 1 } }` was correctly rejected, the simpler and far
        // more natural `{ secret: 1 }` filtered on an attribute the model
        // never marked filterable. Validate it the same as any other
        // attribute reference.
        if (isStringKey) {
          validateField(targetKey);
        }

        // assign the new value
        memo[targetKey] = value;
      }

      // return the modified object
      return memo;
    }, result);
}

/**
 * Return the GraphQL-friendly name for a known Sequelize operator key.
 *
 * @param key candidate operator key
 * @return the matching operator name, when known
 */
function getOperatorName(key: WhereKey): string | undefined {
  return Object.keys(sequelizeOps).find(
    (name) => key === name || key === sequelizeOps[name]
  );
}

/**
 * Return every own string and symbol key on an expression object.
 *
 * @param expression expression object to inspect
 * @return the object's own keys
 */
function getOwnKeys(expression: WhereExpression): WhereKey[] {
  return [
    ...Object.getOwnPropertySymbols(expression),
    ...Object.keys(expression)
  ];
}

/**
 * Determine whether a required field's value is a positive predicate.
 *
 * @param value value supplied for the required field
 * @return whether the value guarantees the required filter
 */
function requiredPredicateGuaranteesFilter(value: unknown): boolean {
  if (Array.isArray(value)) {
    return true;
  }

  if (isPlainObject(value)) {
    return expressionGuaranteesFilter(value, null, true);
  }

  return true;
}

/**
 * Determine whether every branch beneath an OR guarantees a required filter.
 *
 * Object-form OR values treat each entry as its own branch, matching Sequelize.
 *
 * @param value branches beneath the OR operator
 * @param requiredFilter required attribute name
 * @param fieldExpression whether this is a field operator expression
 * @return whether every branch guarantees the required filter
 */
function orExpressionGuaranteesFilter(
  value: unknown,
  requiredFilter: string | null,
  fieldExpression: boolean
): boolean {
  if (Array.isArray(value)) {
    return (
      value.length > 0 &&
      value.every((branch) =>
        expressionGuaranteesFilter(
          branch,
          requiredFilter,
          fieldExpression
        )
      )
    );
  }

  if (!isPlainObject(value)) {
    return false;
  }

  const keys = getOwnKeys(value);

  return (
    keys.length > 0 &&
    keys.every((key) =>
      expressionEntryGuaranteesFilter(
        key,
        value[key],
        requiredFilter,
        fieldExpression
      )
    )
  );
}

/**
 * Determine whether one expression entry guarantees a required filter.
 *
 * @param key expression key
 * @param value value stored beneath the key
 * @param requiredFilter required attribute name
 * @param fieldExpression whether this is a field operator expression
 * @return whether this conjunct guarantees the required filter
 */
function expressionEntryGuaranteesFilter(
  key: WhereKey,
  value: unknown,
  requiredFilter: string | null,
  fieldExpression: boolean
): boolean {
  const operatorName = getOperatorName(key);

  if (operatorName === 'not') {
    return false;
  }

  if (operatorName === 'or') {
    return orExpressionGuaranteesFilter(
      value,
      requiredFilter,
      fieldExpression
    );
  }

  if (operatorName === 'and') {
    return expressionGuaranteesFilter(
      value,
      requiredFilter,
      fieldExpression
    );
  }

  if (fieldExpression) {
    return operatorName !== undefined &&
      ['eq', 'in', 'is'].includes(operatorName);
  }

  if (operatorName) {
    return false;
  }

  if (key === requiredFilter) {
    return requiredPredicateGuaranteesFilter(value);
  }

  return false;
}

/**
 * Determine whether an expression guarantees a required positive filter.
 *
 * Ordinary object keys and array entries are conjunctions, so any conjunct can
 * establish the guarantee. Every branch of an OR must establish it, while a
 * predicate beneath NOT can never do so.
 *
 * @param expression where or field expression to inspect
 * @param requiredFilter required attribute name
 * @param fieldExpression whether this is a field operator expression
 * @return whether every result is constrained by the filter
 */
function expressionGuaranteesFilter(
  expression: unknown,
  requiredFilter: string | null,
  fieldExpression: boolean
): boolean {
  if (Array.isArray(expression)) {
    return expression.some((entry) =>
      expressionGuaranteesFilter(
        entry,
        requiredFilter,
        fieldExpression
      )
    );
  }

  if (!isPlainObject(expression)) {
    return false;
  }

  return getOwnKeys(expression)
    .some((key) =>
      expressionEntryGuaranteesFilter(
        key,
        expression[key],
        requiredFilter,
        fieldExpression
      )
    );
}

/**
 * Determine whether a where expression guarantees a required positive filter.
 *
 * @param where where expression to inspect
 * @param requiredFilter required attribute name
 * @return whether every result is constrained by the filter
 */
function whereGuaranteesFilter(
  where: WhereExpression,
  requiredFilter: string
): boolean {
  return expressionGuaranteesFilter(where, requiredFilter, false);
}

/**
 * Validate required-filter configuration supplied across typed and JavaScript callers.
 *
 * Array.from intentionally materializes sparse entries so holes fail validation
 * exactly like explicit undefined values.
 *
 * @param value candidate required-filter list
 * @return whether every entry is a non-empty string
 */
function isRequiredFilterList(value: unknown): value is readonly string[] {
  return Array.isArray(value) &&
    Array.from(value).every(
      (requiredFilter: unknown) =>
        typeof requiredFilter === 'string' &&
        requiredFilter.trim().length > 0
    );
}

/**
 * Replace the where arguments object and return the sequelize compatible version.
 *
 * BREAKING (1.0.0): the validation parameters moved from positional arguments
 * into an options object, and attribute validation is now on by default.
 *
 * Validation is opt-out rather than opt-in deliberately. A caller that forgets
 * to pass its filterable set gets validation against an empty list, which
 * rejects everything -- the safe direction. Turning it off requires saying so
 * explicitly via `validateAttributes: false`.
 *
 * @param where arguments object in GraphQL Safe format meaning no leading "$" chars.
 * @param options validation context; see above.
 * @return Sequelize-compatible where expression
 */
export function replaceWhereOperators(
  where: WhereExpression,
  {
    filterableAttributes = [],
    filterableAttributesFields = {},
    allowedModels = [],
    requiredFilters = [],
    validateAttributes = true
  }: ReplaceWhereOptions = {}
): WhereExpression {
  if (!isRequiredFilterList(requiredFilters)) {
    throw new Error('requiredFilters must contain non-empty strings.');
  }

  const result = replaceKeyDeep(
    where,
    sequelizeOps,
    validateAttributes ? filterableAttributes : null,
    filterableAttributesFields,
    allowedModels
  );

  requiredFilters.forEach((requiredFilter) => {
    if (!whereGuaranteesFilter(where, requiredFilter)) {
      throw new Error(`Filter ${requiredFilter} is missing.`);
    }
  });

  return result;
}
