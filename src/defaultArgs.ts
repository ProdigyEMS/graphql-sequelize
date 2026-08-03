import {isInputType} from 'graphql';
import type {GraphQLFieldConfigArgumentMap} from 'graphql';
import type {Model, ModelStatic} from 'sequelize';

import * as typeMapper from './typeMapper.js';
import JSONType from './types/jsonType.js';

/**
 * Create the default arguments for resolving one Sequelize model record.
 *
 * @param model Sequelize model constructor
 * @return primary-key and JSON where arguments
 */
export default function defaultArgs(
  model: ModelStatic<Model>
): GraphQLFieldConfigArgumentMap {
  const result: GraphQLFieldConfigArgumentMap = {};
  const keys = model.primaryKeyAttributes;

  if (keys) {
    keys.forEach((key) => {
      const attribute = model.rawAttributes[key];
      if (attribute) {
        const sequelizeTypes = model.sequelize!.constructor as unknown as
          Parameters<typeof typeMapper.toGraphQL>[1];
        const graphqlType = typeMapper.toGraphQL(
          attribute.type as unknown as Parameters<typeof typeMapper.toGraphQL>[0],
          sequelizeTypes
        );

        if (!isInputType(graphqlType)) {
          throw new TypeError(
            `Primary key attribute "${key}" on model "${model.name}" must map to a GraphQL input type.`
          );
        }

        result[key] = {
          type: graphqlType
        };
      }
    });
  }

  result.where = {
    type: JSONType,
    description: 'A JSON object conforming to the shape specified in http://docs.sequelizejs.com/en/latest/docs/querying/'
  };

  return result;
}
