import type {
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldConfigMap,
  GraphQLFieldResolver,
  GraphQLResolveInfo,
  GraphQLScalarType,
  GraphQLType
} from 'graphql';
import { GraphQLObjectType, GraphQLString } from 'graphql';
import type { FindOptions, Model, ModelStatic } from 'sequelize';
import { DataTypes } from 'sequelize';
import type {
  ConnectionResult,
  SimplifiedAST as RootSimplifiedAST,
  SimplifiedASTCollection as RootSimplifiedASTCollection
} from '../..';
import generatedAttributeFields from '../../lib/attributeFields.js';
import type { AttributeFieldsOptions as GeneratedAttributeFieldsOptions } from '../../lib/attributeFields.js';
import generatedDefaultArgs from '../../lib/defaultArgs.js';
import generatedDefaultListArgs from '../../lib/defaultListArgs.js';
import generatedSimplifyAST from '../../lib/simplifyAST.js';
import type {
  SimplifiedAST as GeneratedSimplifiedAST,
  SimplifiedASTCollection as GeneratedSimplifiedASTCollection
} from '../../lib/simplifyAST.js';
import * as generatedTypeMapper from '../../lib/typeMapper.js';

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
declare const graphqlTypeCache: Record<string, GraphQLType>;

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
const generatedOptions: GeneratedAttributeFieldsOptions = {
  cache: graphqlTypeCache,
  exclude: (attributeName) => attributeName === 'secret',
  only: ['id', 'email'],
  map: (attributeName) => `mapped_${attributeName}`,
  globalId: true,
  allowNull: true,
  commentToDescription: true
};
const generatedRecordOptions: GeneratedAttributeFieldsOptions = {
  map: { id: 'mappedId' }
};
const generatedFields: GraphQLFieldConfigMap<Model, unknown> =
  generatedAttributeFields(User, generatedOptions);
const generatedRecordFields: GraphQLFieldConfigMap<Model, unknown> =
  generatedAttributeFields(User, generatedRecordOptions);
const generatedModelArgs: GraphQLFieldConfigArgumentMap =
  generatedDefaultArgs(User);
const generatedListArgs: GraphQLFieldConfigArgumentMap =
  generatedDefaultListArgs();
const generatedSingleSimplified: GeneratedSimplifiedAST = generatedSimplifyAST(
  info.fieldNodes[0],
  info
);
const generatedCollection: GeneratedSimplifiedASTCollection =
  generatedSimplifyAST(info.fieldNodes, info);
const generatedCollectionFields: Record<string, GeneratedSimplifiedAST> | undefined =
  generatedCollection.fields;
// @ts-expect-error AST collections do not expose node arguments.
void generatedCollection.args;
const generatedEmptyCollection: GeneratedSimplifiedASTCollection =
  generatedSimplifyAST([], info);
const generatedEmptyCollectionFields: Record<string, GeneratedSimplifiedAST> | undefined =
  generatedEmptyCollection.fields;
// @ts-expect-error Empty AST collections do not expose node arguments.
void generatedEmptyCollection.args;
const rootSingleSimplified: RootSimplifiedAST = simplifyAST(
  info.fieldNodes[0],
  info
);
const rootCollection: RootSimplifiedASTCollection =
  simplifyAST(info.fieldNodes, info);
const rootCollectionFields: Record<string, RootSimplifiedAST> | undefined =
  rootCollection.fields;
// @ts-expect-error Root AST collections do not expose node arguments.
void rootCollection.args;
const rootEmptyCollection: RootSimplifiedASTCollection = simplifyAST([], info);
const rootEmptyCollectionFields: Record<string, RootSimplifiedAST> | undefined =
  rootEmptyCollection.fields;
// @ts-expect-error Empty root AST collections do not expose node arguments.
void rootEmptyCollection.args;
const mappedType = typeMapper.toGraphQL(
  User.getAttributes().id.type,
  sequelize.constructor
);
const generatedMappedType = generatedTypeMapper.toGraphQL(
  new DataTypes.INTEGER(),
  DataTypes
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
void generatedFields;
void generatedRecordFields;
void generatedModelArgs;
void generatedListArgs;
void generatedSingleSimplified;
void generatedCollectionFields;
void generatedEmptyCollectionFields;
void rootSingleSimplified;
void rootCollectionFields;
void rootEmptyCollectionFields;
void mappedType;
void generatedMappedType;
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
