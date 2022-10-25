import sequelizeOps from "./sequelizeOps";

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
  associations,
  requiredFilters,
  filtersValidator
) {
  return Object.getOwnPropertySymbols(obj)
    .concat(Object.keys(obj))
    .reduce((memo, key) => {
      // determine which key we are going to use
      let targetKey = keyMap[key] ? keyMap[key] : key;

      if (Array.isArray(obj[key])) {
        // recurse if an array
        memo[targetKey] = obj[key].map((val) => {
          if (Object.prototype.toString.call(val) === "[object Object]") {
            return replaceKeyDeep(
              val,
              keyMap,
              filterableAttributes,
              filterableAttributesFields,
              associations,
              requiredFilters,
              filtersValidator
            );
          }
          return val;
        });
      } else if (
        Object.prototype.toString.call(obj[key]) === "[object Object]"
      ) {
        const isModel = associations.find(
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
            memo[
              `$${key}.${filterableAttributesFields[column]}$`
            ] = replaceKeyDeep(
              obj[key][column],
              keyMap,
              filterableAttributes,
              filterableAttributesFields,
              associations,
              requiredFilters,
              filtersValidator
            );
          });
        } else {
          validateField(targetKey);
          memo[targetKey] = replaceKeyDeep(
            obj[key],
            keyMap,
            filterableAttributes,
            filterableAttributesFields,
            associations,
            requiredFilters,
            filtersValidator
          );
        }
      } else {
        requiredFilters = requiredFilters.filter(
          (filter) => filter !== targetKey
        );
        filtersValidator && filtersValidator(targetKey, obj[key][targetKey]);
        // assign the new value
        memo[targetKey] = obj[key];
      }

      if (requiredFilters.length) {
        throw new Error(`Filters: ${requiredFilters.toString()} are missing.`);
      }

      // return the modified object
      return memo;
    }, {});
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
  associations,
  requiredFilters,
  filtersValidator
) {
  return replaceKeyDeep(
    where,
    sequelizeOps,
    filterableAttributes,
    filterableAttributesFields,
    associations,
    requiredFilters,
    filtersValidator
  );
}
