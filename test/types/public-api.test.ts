import type {
  GraphQLFieldResolver,
  GraphQLResolveInfo,
  GraphQLScalarType
} from 'graphql';
import { GraphQLObjectType, GraphQLString } from 'graphql';
import type { FindOptions, Model, ModelStatic } from 'sequelize';
import type { ConnectionResult } from '../..';

import {
  argsToFindOptions,
  resolver,
  defaultListArgs,
  defaultArgs,
  typeMapper,
  attributeFields,
  simplifyAST,
  relay,
  sequelizeConnection,
  createConnection,
  createConnectionResolver,
  createNodeInterface,
  JSONType,
  DateType
} from '../..';

interface ResolverContext {
  organizationId: number;
}

interface ConnectionArgs {
  first?: number;
  status?: string;
}

declare const User: ModelStatic<Model>;
declare const info: GraphQLResolveInfo;

const sequelize = User.sequelize;
if (!sequelize) {
  throw new Error('The model fixture requires a Sequelize instance.');
}

const before = (findOptions: FindOptions): FindOptions => findOptions;
const after = (result: unknown): unknown => result;

const preferredResolver: GraphQLFieldResolver<unknown, ResolverContext> =
  resolver(User, {
    models: { User },
    requiredFilters: ['organizationId'],
    before,
    after,
    contextToOptions: {
      organizationId: 'organizationId'
    }
  });

const findOptions: FindOptions = argsToFindOptions(
  { limit: 1 },
  ['id'],
  {},
  [],
  []
);
const listArgs = defaultListArgs();
const modelArgs = defaultArgs(User);
const fields = attributeFields(User, { exclude: ['secret'] });
const simplified = simplifyAST(info.fieldNodes, info);
const mappedType = typeMapper.toGraphQL(
  User.getAttributes().id.type,
  sequelize.constructor
);
const userType = new GraphQLObjectType({
  name: 'PublicApiTypeUser',
  fields: {
    id: {
      type: GraphQLString
    }
  }
});
const connectionBefore = async (
  findOptions: FindOptions,
  args: ConnectionArgs,
  context: ResolverContext,
  resolveInfo: GraphQLResolveInfo
): Promise<FindOptions> => {
  void args;
  void context;
  void resolveInfo;

  return findOptions;
};
const connectionAfter = async (
  result: ConnectionResult<unknown, unknown, ConnectionArgs>,
  args: ConnectionArgs,
  context: ResolverContext,
  resolveInfo: GraphQLResolveInfo
): Promise<ConnectionResult<unknown, unknown, ConnectionArgs>> => {
  void args;
  void context;
  void resolveInfo;

  return result;
};
const connectionWhere = (
  key: string,
  value: unknown,
  currentWhere: Record<string, unknown>
): Record<string, unknown> => ({
  ...currentWhere,
  [key]: value
});
const connection = sequelizeConnection({
  name: 'PublicApiUser',
  nodeType: userType,
  target: User,
  before: connectionBefore,
  after: connectionAfter,
  where: connectionWhere
});
const sameConnection = createConnection({
  name: 'PublicApiUser',
  nodeType: userType,
  target: User,
  before: connectionBefore,
  after: connectionAfter,
  where: connectionWhere
});
const connectionResolver = createConnectionResolver({
  target: User,
  before: connectionBefore,
  after: connectionAfter,
  where: connectionWhere
});
const nodeInterface = createNodeInterface(sequelize);
const relayConnection = relay.createConnection({
  name: 'PublicApiUser',
  nodeType: userType,
  target: User
});
const jsonScalar: GraphQLScalarType = JSONType;
const dateScalar: GraphQLScalarType = DateType;

void preferredResolver;
void findOptions;
void listArgs;
void modelArgs;
void fields;
void simplified;
void mappedType;
void connection;
void sameConnection;
void connectionResolver;
void nodeInterface;
void relayConnection;
void jsonScalar;
void dateScalar;

// @ts-expect-error models must be keyed by model name.
resolver(User, { models: [User] });

// @ts-expect-error requiredFilters must be an array of attribute names.
resolver(User, { requiredFilters: 'organizationId' });

// @ts-expect-error positional models and required filters are no longer accepted.
resolver(User, { User }, ['organizationId'], { before, after });

// @ts-expect-error resolver options do not accept unknown properties.
resolver(User, { unsupported: true });

// @ts-expect-error createConnection requires a GraphQL node type.
createConnection({ target: User });

// @ts-expect-error sequelizeConnection requires a GraphQL node type.
sequelizeConnection({ target: User });
