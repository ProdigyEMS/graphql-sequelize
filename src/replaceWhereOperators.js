import sequelizeOps from './sequelizeOps';

/**
 * Replace a key deeply in an object
 * @param obj
 * @param keyMap
 * @returns {Object}
 */
function replaceKeyDeep(
  obj,
  keyMap,
  filterableAttributes,
  filterableAttributesFields,
  allowedModels
) {
  const result = Object.getOwnPropertySymbols(obj)
    .concat(Object.keys(obj))
    .reduce((memo, key) => {
      // determine which key we are going to use
      let targetKey = keyMap[key] ? keyMap[key] : key;

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
      const validateField = (target) => {
        if (
          filterableAttributes !== null &&
          !filterableAttributes.includes(target)
        ) {
          throw new Error(`Unknown attribute: ${String(target)}`);
        }
      };

      if (Array.isArray(obj[key])) {
        if (isStringKey) {
          validateField(targetKey);
        }

        // recurse if an array
        memo[targetKey] = obj[key].map((val) => {
          if (Object.prototype.toString.call(val) === '[object Object]') {
            return replaceKeyDeep(
              val,
              keyMap,
              filterableAttributes,
              filterableAttributesFields,
              allowedModels
            );
          }
          return val;
        });
      } else if (
        Object.prototype.toString.call(obj[key]) === '[object Object]'
      ) {
        // On sequelize 4+ operator keys map to Symbols rather than strings
        const isModel =
          isStringKey &&
          allowedModels.find(
            (model) => model.toLowerCase() === targetKey.toLowerCase()
          );

        if (isModel) {
          Object.keys(obj[key]).forEach((column) => {
            validateField(column);
            memo[`$${key}.${filterableAttributesFields[column]}$`] =
              obj[key][column];
          });
        } else {
          if (isStringKey) {
            validateField(targetKey);
          }
          memo[targetKey] = replaceKeyDeep(
            obj[key],
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
        memo[targetKey] = obj[key];
      }

      // return the modified object
      return memo;
    }, {});

  return result;
}

/**
 * Return the GraphQL-friendly name for a known Sequelize operator key.
 *
 * @param {string|symbol} key Candidate operator key.
 * @returns {string|undefined} The matching operator name, when known.
 */
function getOperatorName(key) {
  return Object.keys(sequelizeOps).find(
    (name) => key === name || key === sequelizeOps[name]
  );
}

/**
 * Return every own string and symbol key on an expression object.
 *
 * @param {Object} expression Expression object to inspect.
 * @returns {Array<string|symbol>} The object's own keys.
 */
function getOwnKeys(expression) {
  return Object.getOwnPropertySymbols(expression).concat(
    Object.keys(expression)
  );
}

/**
 * Determine whether a required field's value is a positive predicate.
 *
 * @param {*} value Value supplied for the required field.
 * @returns {boolean} Whether the value guarantees the required filter.
 */
function requiredPredicateGuaranteesFilter(value) {
  if (Array.isArray(value)) {
    return true;
  }

  if (Object.prototype.toString.call(value) === '[object Object]') {
    return expressionGuaranteesFilter(value, null, true);
  }

  return true;
}

/**
 * Determine whether every branch beneath an OR guarantees a required filter.
 *
 * Object-form OR values treat each entry as its own branch, matching Sequelize.
 *
 * @param {*} value Branches beneath the OR operator.
 * @param {string|null} requiredFilter Required attribute name.
 * @param {boolean} fieldExpression Whether this is a field operator expression.
 * @returns {boolean} Whether every branch guarantees the required filter.
 */
function orExpressionGuaranteesFilter(
  value,
  requiredFilter,
  fieldExpression
) {
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

  if (Object.prototype.toString.call(value) !== '[object Object]') {
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
 * @param {string|symbol} key Expression key.
 * @param {*} value Value stored beneath the key.
 * @param {string|null} requiredFilter Required attribute name.
 * @param {boolean} fieldExpression Whether this is a field operator expression.
 * @returns {boolean} Whether this conjunct guarantees the required filter.
 */
function expressionEntryGuaranteesFilter(
  key,
  value,
  requiredFilter,
  fieldExpression
) {
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
    return ['eq', 'in', 'is'].includes(operatorName);
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
 * @param {*} expression Where or field expression to inspect.
 * @param {string|null} requiredFilter Required attribute name.
 * @param {boolean} fieldExpression Whether this is a field operator expression.
 * @returns {boolean} Whether every result is constrained by the filter.
 */
function expressionGuaranteesFilter(
  expression,
  requiredFilter,
  fieldExpression
) {
  if (Array.isArray(expression)) {
    return expression.some((entry) =>
      expressionGuaranteesFilter(
        entry,
        requiredFilter,
        fieldExpression
      )
    );
  }

  if (Object.prototype.toString.call(expression) !== '[object Object]') {
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
 * @param {*} where Where expression to inspect.
 * @param {string} requiredFilter Required attribute name.
 * @returns {boolean} Whether every result is constrained by the filter.
 */
function whereGuaranteesFilter(where, requiredFilter) {
  return expressionGuaranteesFilter(where, requiredFilter, false);
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
 * @returns {Object}
 */
export function replaceWhereOperators(
  where,
  {
    filterableAttributes = [],
    filterableAttributesFields = {},
    allowedModels = [],
    requiredFilters = [],
    validateAttributes = true
  } = {}
) {
  if (
    !Array.isArray(requiredFilters) ||
    Array.from(requiredFilters).some(
      (requiredFilter) =>
        typeof requiredFilter !== 'string' ||
        requiredFilter.trim().length === 0
    )
  ) {
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
