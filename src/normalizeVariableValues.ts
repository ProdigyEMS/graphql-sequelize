type GraphQL16VariableValues = Record<string, unknown>;

interface GraphQL17VariableValues {
  readonly sources: Readonly<Record<string, unknown>>;
  readonly coerced: Readonly<Record<string, unknown>>;
}

type GraphQLVariableValues =
  | GraphQL16VariableValues
  | GraphQL17VariableValues
  | null
  | undefined;

/**
 * Check whether resolver variable values use GraphQL 17's wrapped shape.
 *
 * @param variableValues resolver variable values
 * @return whether source metadata and coerced values are both present
 */
function isGraphQL17VariableValues(
  variableValues: GraphQLVariableValues
): variableValues is GraphQL17VariableValues {
  return Boolean(
    variableValues &&
    Object.prototype.hasOwnProperty.call(variableValues, 'sources') &&
    Object.prototype.hasOwnProperty.call(variableValues, 'coerced')
  );
}

/**
 * Return runtime GraphQL variable values across GraphQL 16 and 17.
 *
 * GraphQL 16 exposes coerced values directly. GraphQL 17 wraps them alongside
 * their source metadata.
 *
 * @param variableValues resolver variable values
 * @return the coerced values keyed by variable name
 */
export default function normalizeVariableValues(
  variableValues: GraphQLVariableValues
): Record<string, unknown> {
  if (
    isGraphQL17VariableValues(variableValues)
  ) {
    return variableValues.coerced as Record<string, unknown>;
  }

  return variableValues || {};
}
