import type {
  GraphQLFieldConfig,
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldResolver,
  GraphQLEnumType,
  GraphQLInterfaceType,
  GraphQLNamedOutputType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLResolveInfo,
  ThunkObjMap
} from 'graphql';
import type {
  Association,
  FindOptions,
  Model,
  ModelStatic,
  Sequelize
} from 'sequelize';

export type {AttributeFieldsOptions} from './attributeFields.js';
export type {
  SimplifiedAST,
  SimplifiedASTCollection
} from './simplifyAST.js';

/** A value that may be returned immediately or through a promise-like object. */
export type MaybePromise<T> = T | PromiseLike<T>;

/** GraphQL resolver arguments keyed by their schema names. */
export type ResolverArguments = Record<string, unknown>;

/** Pagination arguments accepted by graphql-relay across supported versions. */
export interface RelayConnectionArguments {
  before?: string | null;
  after?: string | null;
  first?: number | null;
  last?: number | null;
}

/** One edge returned by graphql-relay's in-memory connection helper. */
export interface RelayArrayConnectionEdge<TNode = unknown> {
  node: TNode;
  cursor: string;
}

/** In-memory connection result shared by supported graphql-relay versions. */
export interface RelayArrayConnection<TNode = unknown> {
  edges: Array<RelayArrayConnectionEdge<TNode>>;
  pageInfo: ConnectionPageInfo;
}

type ConcreteResolverTarget =
  | ModelStatic<Model>
  | Association<Model, Model>;

/** A Sequelize model, association, or resolver-time target thunk. */
export type ResolverTarget<
  TSource = unknown,
  TContext = unknown,
  TArgs = ResolverArguments
> =
  | ConcreteResolverTarget
  | ((
      source: TSource,
      args: TArgs,
      context: TContext,
      info: GraphQLResolveInfo
    ) => MaybePromise<ConcreteResolverTarget>);

/** Options accepted by a model or association resolver. */
export interface ResolverOptions<
  // Retained for source-compatible generic ordering with ResolverTarget.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TSource = unknown,
  TContext = unknown,
  TArgs = ResolverArguments
> {
  models?: Record<string, ModelStatic<Model>>;
  requiredFilters?: readonly string[];
  list?: boolean;
  handleConnection?: boolean;
  operation?: 'update';
  contextToOptions?: Record<string, string>;
  before?: (
    findOptions: FindOptions,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo
  ) => MaybePromise<FindOptions>;
  after?: (
    result: unknown,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo
  ) => MaybePromise<unknown>;
  include?: never;
}

/** Callable resolver factory with process-wide context option mappings. */
export interface ResolverFactory {
  <
    TSource = unknown,
    TContext = unknown,
    TArgs = ResolverArguments
  >(
    target: ResolverTarget<TSource, TContext, TArgs>,
    options?: ResolverOptions<TSource, TContext, TArgs>
  ): GraphQLFieldResolver<
    TSource,
    TContext,
    TArgs,
    Promise<unknown>
  >;
  contextToOptions: Record<string, string>;
}

/** Application-defined filters generated from connection arguments. */
export type ConnectionWhere = Record<string, unknown>;

/** A decoded positional cursor. */
export interface ConnectionCursor {
  id: unknown;
  index: number;
}

/** A Relay edge augmented with the source and source arguments. */
export interface ConnectionEdge<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments
> {
  cursor: string;
  node: TNode;
  source: TSource | undefined;
  sourceArgs: TArgs | Record<string, never>;
}

/** Pagination metadata returned by a Sequelize connection. */
export interface ConnectionPageInfo {
  startCursor: string | null;
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** The default result assembled by a Sequelize connection resolver. */
export interface ConnectionResult<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments
> {
  source: TSource;
  args: TArgs;
  where: ConnectionWhere;
  edges?: Array<ConnectionEdge<TNode, TSource, TArgs>>;
  pageInfo?: ConnectionPageInfo;
  fullCount?: number | null;
}

/** Hook invoked before a connection query is executed. */
export type ConnectionBefore<
  TArgs = ResolverArguments,
  TContext = unknown
> = (
  findOptions: FindOptions,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => MaybePromise<FindOptions>;

/** Hook invoked after a connection result has been assembled. */
export type ConnectionAfter<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> = (
  result: ConnectionResult<TNode, TSource, TArgs>,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => MaybePromise<TOutput>;

/** Convert one GraphQL argument into a fragment of a Sequelize where clause. */
export type ConnectionWhereBuilder = (
  key: string,
  value: unknown,
  currentWhere: ConnectionWhere
) => ConnectionWhere;

/** Valid node output types accepted by graphql-relay connection definitions. */
export type ConnectionNodeType =
  | GraphQLNamedOutputType
  | GraphQLNonNull<GraphQLNamedOutputType>;

/** Custom fields added to generated connection and edge object types. */
export type ConnectionFields<
  TSource = unknown,
  TContext = unknown
> = ThunkObjMap<
  GraphQLFieldConfig<TSource, TContext>
>;

interface ConnectionResolverOptionsBase<
  // Retained for source-compatible generic ordering in exported option types.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown
> {
  target: ResolverTarget<TSource, TContext, TArgs>;
  orderBy?: GraphQLEnumType | string;
  before?: ConnectionBefore<TArgs, TContext>;
  where?: ConnectionWhereBuilder;
  ignoreArgs?: GraphQLFieldConfigArgumentMap;
}

/** Resolver options whose output is the default ConnectionResult. */
export type DefaultConnectionResolverOptions<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown
> = ConnectionResolverOptionsBase<TNode, TSource, TArgs, TContext> & {
  after?: undefined;
};

/** Resolver options with a required output-transforming hook. */
export type TransformedConnectionResolverOptions<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> = ConnectionResolverOptionsBase<TNode, TSource, TArgs, TContext> & {
  after: ConnectionAfter<TNode, TSource, TArgs, TContext, TOutput>;
};

/** Options accepted by the lower-level connection resolver implementation. */
export type ConnectionResolverOptions<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> =
  | DefaultConnectionResolverOptions<TNode, TSource, TArgs, TContext>
  | TransformedConnectionResolverOptions<
      TNode,
      TSource,
      TArgs,
      TContext,
      TOutput
    >;

interface ConnectionOptionsBase<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> {
  name?: string;
  nodeType: ConnectionNodeType;
  target: ResolverTarget<TSource, TContext, TArgs>;
  orderBy?: GraphQLEnumType;
  before?: ConnectionBefore<TArgs, TContext>;
  connectionFields?: ConnectionFields<TOutput, TContext>;
  edgeFields?: ConnectionFields<
    ConnectionEdge<TNode, TSource, TArgs>,
    TContext
  >;
  where?: ConnectionWhereBuilder;
}

/** Connection options whose output is the default ConnectionResult. */
export type DefaultConnectionOptions<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown
> = ConnectionOptionsBase<
  TNode,
  TSource,
  TArgs,
  TContext,
  ConnectionResult<TNode, TSource, TArgs>
> & {
  after?: undefined;
};

/** Connection options with a required output-transforming hook. */
export type TransformedConnectionOptions<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> = ConnectionOptionsBase<TNode, TSource, TArgs, TContext, TOutput> & {
  after: ConnectionAfter<TNode, TSource, TArgs, TContext, TOutput>;
};

/** Options accepted by the connection definition implementation. */
export type ConnectionOptions<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> =
  | DefaultConnectionOptions<TNode, TSource, TArgs, TContext>
  | TransformedConnectionOptions<TNode, TSource, TArgs, TContext, TOutput>;

/** Public resolver pair returned by createConnectionResolver. */
export interface ConnectionResolver<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> {
  resolveEdge(
    item: TNode,
    index?: number,
    queriedCursor?: ConnectionCursor | null,
    sourceArgs?: TArgs,
    source?: TSource
  ): ConnectionEdge<TNode, TSource, TArgs>;
  resolveConnection: GraphQLFieldResolver<
    TSource,
    TContext,
    TArgs,
    MaybePromise<TOutput>
  >;
}

/** GraphQL types and resolvers returned by createConnection. */
export interface ConnectionDefinition<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> extends ConnectionResolver<TNode, TSource, TArgs, TContext, TOutput> {
  connectionType: GraphQLObjectType;
  edgeType: GraphQLObjectType;
  nodeType: ConnectionNodeType;
  connectionArgs: GraphQLFieldConfigArgumentMap;
  resolve: ConnectionResolver<
    TNode,
    TSource,
    TArgs,
    TContext,
    TOutput
  >['resolveConnection'];
}

/** Value returned by an application-defined node fetcher. */
export type NodeResolverResult =
  | RelayNodeValue
  | null
  | undefined;

/** Custom node lookup associated with a Relay node type. */
export type NodeResolver<TContext = unknown> = (
  globalId: string,
  context: TContext,
  info: GraphQLResolveInfo
) => MaybePromise<NodeResolverResult>;

/** Canonical node type mapping stored by NodeTypeMapper. */
export interface NodeTypeMapping<TContext = unknown> {
  type: string | GraphQLObjectType;
  resolve?: NodeResolver<TContext>;
}

/** Direct GraphQL types are normalized into NodeTypeMapping objects. */
export type NodeTypeMappingInput<TContext = unknown> =
  | NodeTypeMapping<TContext>
  | GraphQLObjectType
  | string;

/** Mutable registry used by Relay's node ID and type resolvers. */
export interface NodeTypeMapperContract<TContext = unknown> {
  mapTypes(types: Record<string, NodeTypeMappingInput<TContext>>): void;
  item(type: string): NodeTypeMapping<TContext> | undefined;
}

/** GraphQL Relay node fields and their shared type mapper. */
export interface NodeInterfaceDefinition<TContext = unknown> {
  nodeTypeMapper: NodeTypeMapperContract<TContext>;
  nodeInterface: GraphQLInterfaceType;
  nodeField: GraphQLFieldConfig<unknown, TContext>;
  nodesField?: GraphQLFieldConfig<unknown, TContext>;
}

/** Runtime object or callable object supported by Relay node type resolution. */
export type RelayNodeValue =
  | object
  | ((...args: never[]) => unknown);

/** Typed node ID fetcher returned by idFetcher. */
export type NodeIdFetcher<TContext = unknown> = (
  globalId: string,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<unknown>;

/** Typed node type resolver returned by typeResolver. */
export type NodeTypeResolver = (value: RelayNodeValue) => string | null;

/** Sequelize input accepted by createNodeInterface. */
export type NodeInterfaceSequelize = Sequelize;
