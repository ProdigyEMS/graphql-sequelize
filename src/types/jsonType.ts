import {
  GraphQLScalarType,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLString,
  Kind
} from 'graphql';
import type {ValueNode} from 'graphql';

/**
 * Create a resolver for a GraphQL variable embedded in a JSON literal.
 *
 * GraphQL variable names are single property names, so a direct property read
 * preserves the existing lodash accessor behavior without treating the name as
 * a nested object path.
 *
 * @param propertyName GraphQL variable name
 * @return a function that reads the variable from runtime values
 */
function createVariableValueAccessor(
  propertyName: string
): (variableValues: unknown) => unknown {
  return (variableValues: unknown): unknown => {
    if (variableValues === null || variableValues === undefined) {
      return undefined;
    }

    return (Object(variableValues) as Record<string, unknown>)[propertyName];
  };
}

/**
 * Convert a GraphQL value literal into its JSON representation.
 *
 * @param ast GraphQL value literal
 * @return parsed JSON-compatible value, variable accessor, or null
 */
function parseJsonLiteral(
  ast: ValueNode,
  variableValues: Parameters<typeof GraphQLInt.parseLiteral>[1] =
    undefined as Parameters<typeof GraphQLInt.parseLiteral>[1]
): unknown {
  switch (ast.kind) {
      case Kind.INT:
        return GraphQLInt.parseLiteral(ast, variableValues);
      case Kind.FLOAT:
        return GraphQLFloat.parseLiteral(ast, variableValues);
      case Kind.BOOLEAN:
        return GraphQLBoolean.parseLiteral(ast, variableValues);
      case Kind.STRING:
        return GraphQLString.parseLiteral(ast, variableValues);
      case Kind.ENUM:
        return String(ast.value);
      case Kind.LIST:
        return ast.values.map((astItem) => JSONType.parseLiteral(astItem, variableValues));
      case Kind.OBJECT: {
        const objectValue: Record<string, unknown> = {};
        ast.fields.forEach((field) => {
          objectValue[field.name.value] = JSONType.parseLiteral(field.value, variableValues);
        });

        return objectValue;
      }
      case Kind.VARIABLE:
      /*
      this way converted query variables would be easily
      converted to actual values in the resolver.js by just
      passing the query variables object in to function below.
      We can`t convert them just in here because query variables
      are not accessible from GraphQLScalarType's parseLiteral method
      */
        return createVariableValueAccessor(ast.name.value);
      default:
        return null;
  }
}


const JSONType: GraphQLScalarType<unknown, unknown> = new GraphQLScalarType<unknown, unknown>({
  name: 'SequelizeJSON',
  description: 'The `JSON` scalar type represents raw JSON as values.',
  serialize: (value: unknown): unknown => value,
  parseValue: (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value,
  parseLiteral: parseJsonLiteral
});


export default JSONType;
