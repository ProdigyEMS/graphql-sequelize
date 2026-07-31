import {GraphQLInt, GraphQLString} from 'graphql';
import type {GraphQLFieldConfigArgumentMap} from 'graphql';

import JSONType from './types/jsonType.js';

/**
 * Create the default arguments for resolving a list of Sequelize records.
 *
 * @return pagination, ordering, and JSON where arguments
 */
export default function defaultListArgs(): GraphQLFieldConfigArgumentMap {
  return {
    limit: {
      type: GraphQLInt
    },
    order: {
      type: GraphQLString
    },
    where: {
      type: JSONType,
      description: 'A JSON object conforming the the shape specified in http://docs.sequelizejs.com/en/latest/docs/querying/'
    },
    offset: {
      type: GraphQLInt
    }
  };
}
