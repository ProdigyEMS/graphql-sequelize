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
  requiredFilters,
  recursive = false
) {
  const result = Object.getOwnPropertySymbols(obj)
    .concat(Object.keys(obj))
    .reduce((memo, key) => {
      // determine which key we are going to use
      let targetKey = keyMap[key] ? keyMap[key] : key;
      requiredFilters = requiredFilters.filter(
        (filter) => filter !== targetKey
      );

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
              requiredFilters,
              true
            );
          }
          return val;
        });
      } else if (
        Object.prototype.toString.call(obj[key]) === '[object Object]'
      ) {
        const isModel = allowedModels.find(
          (model) => model.toLowerCase() === targetKey.toLowerCase()
        );
        const validateField = (target) => {
          if (!filterableAttributes.includes(target)) {
            throw new Error(`Unknown attribute: ${target}`);
          }
        };

        if (isModel) {
          Object.keys(obj[key]).forEach((column) => {
            validateField(column);
            memo[`$${key}.${filterableAttributesFields[column]}$`] =
              obj[key][column];
          });
        } else {
          validateField(targetKey);
          memo[targetKey] = replaceKeyDeep(
            obj[key],
            keyMap,
            filterableAttributes,
            filterableAttributesFields,
            allowedModels,
            requiredFilters,
            true
          );
        }
      } else {
        // assign the new value
        memo[targetKey] = obj[key];
      }

      // return the modified object
      return memo;
    }, {});

  if (!recursive && requiredFilters.length) {
    throw new Error(`Filter ${requiredFilters[0]} is missing.`);
  }

  return result;
}

/**
 * Replace the where arguments object and return the sequelize compatible version.
 * @param where arguments object in GraphQL Safe format meaning no leading "$" chars.
 * @returns {Object}
 */
export function replaceWhereOperators(
  where,
  filterableAttributes,
  filterableAttributesFields,
  allowedModels,
  requiredFilters
) {
  return replaceKeyDeep(
    where,
    sequelizeOps,
    filterableAttributes,
    filterableAttributesFields,
    allowedModels,
    requiredFilters
  );
}
