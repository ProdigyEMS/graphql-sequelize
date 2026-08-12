import {
  GraphQLScalarType,
  Kind
} from 'graphql';
import type {ValueNode} from 'graphql';

/**
 * Convert a GraphQL date literal without reading fields absent from its AST kind.
 *
 * @param ast GraphQL value literal
 * @return parsed date, including an invalid Date for unsupported literal kinds
 */
function parseDateLiteral(ast: ValueNode): Date {
  switch (ast.kind) {
      case Kind.INT:
      case Kind.FLOAT:
      case Kind.STRING:
      case Kind.ENUM:
        return new Date(ast.value);
      case Kind.BOOLEAN:
        return new Date(Number(ast.value));
      default:
        return new Date(Number.NaN);
  }
}

/**
 * A special custom Scalar type for Dates that converts to a ISO formatted string
 * @param {String} options.name:
 * @param {String} options.description:
 * @param {Date} options.serialize(d)
 * @param {String} parseValue(value)
 * @param {Object} parseLiteral(ast)
 */
export default new GraphQLScalarType<unknown, unknown>({
  name: 'Date',
  description: 'A special custom Scalar type for Dates that converts to a ISO formatted string ',
  /**
   * serialize
   * @param  {Date} d Date obj
   * @return {String} Serialised date object
   */
  serialize(d: unknown): unknown {
    if (!d) {
      return null;
    }

    if (d instanceof Date) {
      return d.toISOString();
    }
    return d;
  },
  /**
   * parseValue
   * @param  {String} value date string
   * @return {Date}   Date object
   */
  parseValue(value: unknown): Date | null {
    try {
      if (!value) {
        return null;
      }
      return new Date(value as string | number);
    } catch {
      return null;
    }
  },
  parseLiteral: parseDateLiteral
});
