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
  allowedModels,
  remainingFilters,
  recursive = false
) {
  const result = Object.getOwnPropertySymbols(obj)
    .concat(Object.keys(obj))
    .reduce((memo, key) => {
      // determine which key we are going to use
      let targetKey = keyMap[key] ? keyMap[key] : key;
      // A Set mutated in place, not a reassigned array. Reassigning rebound
      // only this invocation's local, so a required filter satisfied inside a
      // recursive call never cleared for the caller: a where of
      // `{ and: [{ organizationId: 1 }] }` supplies the filter but still
      // failed the top-level check with "Filter organizationId is missing".
      // Deleting from a shared Set propagates out of the recursion.
      remainingFilters.delete(targetKey);

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
        // recurse if an array
        memo[targetKey] = obj[key].map((val) => {
          if (Object.prototype.toString.call(val) === '[object Object]') {
            return replaceKeyDeep(
              val,
              keyMap,
              filterableAttributes,
              filterableAttributesFields,
              allowedModels,
              remainingFilters,
              true
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
            allowedModels,
            remainingFilters,
            true
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

  if (!recursive && remainingFilters.size) {
    const [missing] = remainingFilters;
    throw new Error(`Filter ${String(missing)} is missing.`);
  }

  return result;
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
  return replaceKeyDeep(
    where,
    sequelizeOps,
    validateAttributes ? filterableAttributes : null,
    filterableAttributesFields,
    allowedModels,
    new Set(requiredFilters)
  );
}
