/**
 * Return runtime GraphQL variable values across GraphQL 16 and 17.
 *
 * GraphQL 16 exposes coerced values directly. GraphQL 17 wraps them alongside
 * their source metadata.
 *
 * @param {Object|null|undefined} variableValues resolver variable values
 * @return {Object} the coerced values keyed by variable name
 */
export default function normalizeVariableValues(variableValues) {
  if (
    variableValues &&
    Object.prototype.hasOwnProperty.call(variableValues, 'sources') &&
    Object.prototype.hasOwnProperty.call(variableValues, 'coerced')
  ) {
    return variableValues.coerced;
  }

  return variableValues || {};
}
