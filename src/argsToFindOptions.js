import { replaceWhereOperators } from "./replaceWhereOperators";

export default function argsToFindOptions(
  args,
  filterableAttributes,
  filterableAttributesFields,
  allowedModels,
  requiredAttributes
) {
  var result = {};

  if (args) {
    Object.keys(args).forEach(function(key) {
      if (typeof args[key] !== "undefined") {
        if (key === "limit") {
          result.limit = parseInt(args[key], 10);
        } else if (key === "offset") {
          result.offset = parseInt(args[key], 10);
        } else if (key === "order") {
          // The ordering column is client-supplied and was previously applied
          // without any check, so a caller could sort by any column in the
          // table regardless of whether the model marked it filterable.
          // Ordering by a column leaks information about it even when the
          // column itself is never selected, so it is validated against the
          // same set as `where`.
          const descending = args[key].indexOf("reverse:") === 0;
          const orderAttribute = descending
            ? args[key].substring(8)
            : args[key];

          if (
            Array.isArray(filterableAttributes) &&
            !filterableAttributes.includes(orderAttribute)
          ) {
            throw new Error(`Unknown order by: ${orderAttribute}`);
          }

          result.order = [[orderAttribute, descending ? "DESC" : "ASC"]];
        } else if (key === "where") {
          // setup where
          // args.where is client-supplied, so attribute validation stays on.
          result.where = replaceWhereOperators(args.where, {
            filterableAttributes,
            filterableAttributesFields,
            allowedModels,
            requiredFilters: requiredAttributes
          });
        } else if (~filterableAttributes.indexOf(key)) {
          result.where = result.where || {};
          result.where[key] = args[key];
        }
      }
    });
  }

  return result;
}
