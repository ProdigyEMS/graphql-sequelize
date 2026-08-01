import type {
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldConfigMap,
  GraphQLFieldResolver,
  GraphQLResolveInfo,
  GraphQLScalarType,
  GraphQLType
} from 'graphql';
import { GraphQLObjectType, GraphQLString } from 'graphql';
import type { Association, FindOptions, Model, ModelStatic } from 'sequelize';
import { DataTypes } from 'sequelize';
import type {
  AttributeFieldsOptions as GeneratedAttributeFieldsOptions,
  ConnectionDefinition as GeneratedConnectionDefinition,
  ConnectionEdge as GeneratedConnectionEdge,
  ConnectionResult,
  ConnectionResult as GeneratedConnectionResult,
  ConnectionResolver as GeneratedConnectionResolver,
  ConnectionResolverOptions as GeneratedConnectionResolverOptions,
  NodeInterfaceDefinition as GeneratedNodeInterfaceDefinition,
  NodeTypeMapping as GeneratedNodeTypeMapping,
  ResolverOptions,
  ResolverFactory as GeneratedResolverFactory,
  ResolverOptions as GeneratedResolverOptions,
  ResolverTarget as GeneratedResolverTarget,
  SimplifiedAST as GeneratedSimplifiedAST,
  SimplifiedAST as RootSimplifiedAST,
  SimplifiedASTCollection as GeneratedSimplifiedASTCollection,
  SimplifiedASTCollection as RootSimplifiedASTCollection
} from '@prodigyems/graphql-sequelize';

import {
  argsToFindOptions,
  attributeFields,
  attributeFields as generatedAttributeFields,
  DateType,
  defaultArgs,
  defaultArgs as generatedDefaultArgs,
  defaultListArgs,
  defaultListArgs as generatedDefaultListArgs,
  JSONType,
  relay,
  relay as generatedRelay,
  resolver,
  resolver as generatedResolver,
  sequelizeConnection,
  simplifyAST,
  simplifyAST as generatedSimplifyAST,
  typeMapper,
  typeMapper as generatedTypeMapper,
  createConnection,
  createConnectionResolver,
  createNodeInterface
} from '@prodigyems/graphql-sequelize';

interface ResolverContext {
  organizationId: number;
}

interface ConnectionArgs {
  first?: number;
  status?: string;
}

interface ConnectionSource {
  viewerId: number;
}

interface TransformedConnectionOutput extends GeneratedConnectionResult<
  Model,
  ConnectionSource,
  ConnectionArgs
> {
  extra: string;
}

type CustomTypeMapper = NonNullable<Parameters<typeof typeMapper.mapType>[0]>;
type CustomTypeMapperInput = Parameters<CustomTypeMapper>[0];
type IsUnknown<T> = unknown extends T
  ? [keyof T] extends [never]
    ? true
    : false
  : false;

declare const User: ModelStatic<Model>;
declare const UserTasks: Association<Model, Model>;
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
const generatedResolverFactory: GeneratedResolverFactory = generatedResolver;
const generatedResolverTarget: GeneratedResolverTarget<
  unknown,
  ResolverContext
> = User;
const generatedResolverOptions: GeneratedResolverOptions<
  unknown,
  ResolverContext
> = {
  models: { User },
  requiredFilters: ['organizationId'],
  before,
  after,
  operation: 'update'
};
const generatedPreferredResolver: GraphQLFieldResolver<
  unknown,
  ResolverContext
> = generatedResolver(
  generatedResolverTarget,
  generatedResolverOptions
);
const generatedAssociationResolver: GraphQLFieldResolver<
  Model,
  ResolverContext,
  ConnectionArgs,
  Promise<unknown>
> = generatedResolver<Model, ResolverContext, ConnectionArgs>(
  UserTasks,
  {
    before: (options, args, context, resolveInfo) => {
      void args;
      void context;
      void resolveInfo;

      return options;
    }
  }
);
const options: ResolverOptions = {};
const associationResolverWithCanonicalOptions = resolver(UserTasks, options);
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
const customMapperAcceptsUnknown: IsUnknown<CustomTypeMapperInput> = true;
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
const generatedConnectionOptions: GeneratedConnectionResolverOptions<
  unknown,
  unknown,
  ConnectionArgs,
  ResolverContext
> = {
  target: UserTasks,
  before: connectionBefore,
  after: connectionAfter,
  where: connectionWhere
};
const generatedConnectionResolver: GeneratedConnectionResolver<
  unknown,
  unknown,
  ConnectionArgs,
  ResolverContext
> = generatedRelay.createConnectionResolver<
  unknown,
  unknown,
  ConnectionArgs,
  ResolverContext
>(generatedConnectionOptions);
const generatedConnection: GeneratedConnectionDefinition<
  unknown,
  unknown,
  ConnectionArgs,
  ResolverContext
> = generatedRelay.createConnection<
  unknown,
  unknown,
  ConnectionArgs,
  ResolverContext
>({
  name: 'GeneratedPublicApiUser',
  nodeType: userType,
  target: UserTasks,
  before: connectionBefore,
  after: connectionAfter,
  where: connectionWhere
});
const generatedNodeTypeMapper = new generatedRelay.NodeTypeMapper();
const generatedModelNodeMapping: GeneratedNodeTypeMapping = {
  type: userType,
  resolve: () => User.build()
};
const generatedCallableNode = Object.assign(function generatedCallableNode() {}, {
  value: 'custom value'
});
const generatedCallableNodeMapping: GeneratedNodeTypeMapping = {
  type: userType,
  resolve: () => generatedCallableNode
};
generatedNodeTypeMapper.mapTypes({
  PublicApiTypeUser: userType,
  PublicApiModelUser: generatedModelNodeMapping,
  PublicApiCallableUser: generatedCallableNodeMapping
});
const generatedModelNodeType: string | null = generatedRelay.typeResolver(
  generatedNodeTypeMapper
)(User.build());
const generatedCallableNodeType: string | null = generatedRelay.typeResolver(
  generatedNodeTypeMapper
)(generatedCallableNode);
const typedGeneratedConnection = generatedRelay.createConnection<
  Model,
  ConnectionSource,
  ConnectionArgs,
  ResolverContext
>({
  name: 'GeneratedTypedPublicApiUser',
  nodeType: userType,
  target: UserTasks,
  connectionFields: {
    fullCountText: {
      type: GraphQLString,
      resolve: (
        source: GeneratedConnectionResult<
          Model,
          ConnectionSource,
          ConnectionArgs
        >
      ) => String(source.fullCount)
    }
  },
  edgeFields: {
    viewerId: {
      type: GraphQLString,
      resolve: (
        source: GeneratedConnectionEdge<
          Model,
          ConnectionSource,
          ConnectionArgs
        >
      ) => String(source.source?.viewerId)
    }
  }
});
const generatedStandaloneEdge = typedGeneratedConnection.resolveEdge(
  User.build()
);
const generatedStandaloneSource: ConnectionSource | undefined =
  generatedStandaloneEdge.source;
const generatedStandaloneStatus: string | undefined =
  generatedStandaloneEdge.sourceArgs.status;
const generatedStandaloneArgs: ConnectionArgs | Record<string, never> =
  generatedStandaloneEdge.sourceArgs;
const transformedGeneratedConnection = generatedRelay.createConnection<
  Model,
  ConnectionSource,
  ConnectionArgs,
  ResolverContext,
  TransformedConnectionOutput
>({
  name: 'GeneratedTransformedPublicApiUser',
  nodeType: userType,
  target: UserTasks,
  after: (result) => ({
    ...result,
    extra: 'transformed'
  }),
  connectionFields: {
    extra: {
      type: GraphQLString,
      resolve: (source) => source.extra
    }
  }
});
const generatedNodeInterface: GeneratedNodeInterfaceDefinition<ResolverContext> =
  generatedRelay.createNodeInterface<ResolverContext>(sequelize);
const legacyGeneratedNodeInterface: GeneratedNodeInterfaceDefinition<
  ResolverContext
> = {
  nodeTypeMapper: generatedNodeInterface.nodeTypeMapper,
  nodeInterface: generatedNodeInterface.nodeInterface,
  nodeField: generatedNodeInterface.nodeField
};
const defaultGeneratedConnectionResult: GeneratedConnectionResult = {
  source: undefined,
  args: {},
  where: {}
};
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
void generatedResolverFactory;
void generatedPreferredResolver;
void generatedAssociationResolver;
void generatedConnectionResolver;
void generatedConnection;
void generatedNodeTypeMapper;
void generatedNodeInterface;
void generatedModelNodeType;
void generatedCallableNodeType;
void generatedStandaloneSource;
void generatedStandaloneStatus;
void generatedStandaloneArgs;
void transformedGeneratedConnection;
void legacyGeneratedNodeInterface;
void defaultGeneratedConnectionResult;
void associationResolverWithCanonicalOptions;
void generatedSingleSimplified;
void generatedCollectionFields;
void generatedEmptyCollectionFields;
void rootSingleSimplified;
void rootCollectionFields;
void rootEmptyCollectionFields;
void mappedType;
void generatedMappedType;
void customMapperAcceptsUnknown;
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

// @ts-expect-error generated resolver accepts only target and options.
generatedResolver(User, { models: { User } }, ['organizationId']);

// @ts-expect-error resolver only supports the update operation.
generatedResolver(User, { operation: 'create' });

// Association updates are rejected after runtime target resolution.
const generatedAssociationUpdateResolver = generatedResolver(
  UserTasks,
  { operation: 'update' }
);
void generatedAssociationUpdateResolver;

// @ts-expect-error resolver options do not accept unknown properties.
resolver(User, { unsupported: true });

// @ts-expect-error createConnection requires a GraphQL node type.
createConnection({ target: User });

// @ts-expect-error sequelizeConnection requires a GraphQL node type.
sequelizeConnection({ target: User });

const customResolverWithoutAfter = { target: UserTasks };
generatedRelay.createConnectionResolver<
  Model,
  ConnectionSource,
  ConnectionArgs,
  ResolverContext,
  TransformedConnectionOutput
>(
  // @ts-expect-error A custom resolver output requires an after hook.
  customResolverWithoutAfter
);

const customConnectionWithoutAfter = {
  name: 'GeneratedInvalidCustomOutput',
  nodeType: userType,
  target: UserTasks
};
generatedRelay.createConnection<
  Model,
  ConnectionSource,
  ConnectionArgs,
  ResolverContext,
  TransformedConnectionOutput
>(
  // @ts-expect-error A custom connection output requires an after hook.
  customConnectionWithoutAfter
);
