import type {
  ASTNode,
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldConfigMap,
  GraphQLFieldResolver,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLScalarType,
  GraphQLType
} from 'graphql';
import type {
  Association,
  FindOptions,
  Model,
  ModelStatic,
  Sequelize
} from 'sequelize';

type MaybePromise<T> = T | PromiseLike<T>;
export type ResolverArguments = Record<string, unknown>;
type ConcreteResolverTarget =
  | ModelStatic<Model>
  | Association<Model, Model>;

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

export interface ResolverOptions<
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

export const resolver: ResolverFactory;

export function argsToFindOptions(
  args?: ResolverArguments | null,
  filterableAttributes?: readonly string[] | null,
  filterableAttributesFields?: Record<string, string>,
  allowedModels?: readonly string[],
  requiredAttributes?: readonly string[]
): FindOptions;

export function defaultListArgs(): GraphQLFieldConfigArgumentMap;

export function defaultArgs(
  model: ModelStatic<Model>
): GraphQLFieldConfigArgumentMap;

export const typeMapper: {
  mapType(
    mapper: (sequelizeType: unknown) => GraphQLType | null | undefined
  ): void;
  toGraphQL(
    sequelizeType: unknown,
    sequelizeTypes: unknown
  ): GraphQLOutputType;
};

export interface AttributeFieldsOptions {
  cache?: Record<string, GraphQLType>;
  exclude?: readonly string[] | ((attributeName: string) => boolean);
  only?: readonly string[] | ((attributeName: string) => boolean);
  map?: Record<string, string> | ((attributeName: string) => string);
  globalId?: boolean;
  allowNull?: boolean;
  commentToDescription?: boolean;
}

export function attributeFields(
  model: ModelStatic<Model>,
  options?: AttributeFieldsOptions
): GraphQLFieldConfigMap<Model, unknown>;

export interface SimplifiedAST {
  fields: Record<string, SimplifiedAST>;
  args: Record<string, unknown>;
  key?: string;
  readonly $parent?: SimplifiedAST;
}

export function simplifyAST(
  ast: ASTNode | ReadonlyArray<ASTNode>,
  info?: Partial<GraphQLResolveInfo>,
  parent?: SimplifiedAST
): SimplifiedAST;

export type ConnectionWhere = Record<string, unknown>;

export interface ConnectionEdge<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments
> {
  cursor: string;
  node: TNode;
  source: TSource;
  sourceArgs: TArgs;
}

export interface ConnectionPageInfo {
  startCursor: string | null;
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

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

export type ConnectionBefore<
  TArgs = ResolverArguments,
  TContext = unknown
> = (
  findOptions: FindOptions,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => MaybePromise<FindOptions>;

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

export type ConnectionWhereBuilder = (
  key: string,
  value: unknown,
  currentWhere: ConnectionWhere
) => ConnectionWhere;

export interface ConnectionResolverOptions<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> {
  target: ResolverTarget<TSource, TContext, TArgs>;
  orderBy?: unknown;
  before?: ConnectionBefore<TArgs, TContext>;
  after?: ConnectionAfter<TNode, TSource, TArgs, TContext, TOutput>;
  where?: ConnectionWhereBuilder;
  ignoreArgs?: GraphQLFieldConfigArgumentMap;
}

export interface ConnectionOptions<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> {
  name?: string;
  nodeType: GraphQLOutputType;
  target: ResolverTarget<TSource, TContext, TArgs>;
  orderBy?: unknown;
  before?: ConnectionBefore<TArgs, TContext>;
  after?: ConnectionAfter<TNode, TSource, TArgs, TContext, TOutput>;
  connectionFields?: unknown;
  edgeFields?: unknown;
  where?: ConnectionWhereBuilder;
}

export interface ConnectionResolver<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> {
  resolveEdge: (...args: unknown[]) => unknown;
  resolveConnection: GraphQLFieldResolver<
    TSource,
    TContext,
    TArgs,
    MaybePromise<TOutput>
  >;
}

export interface ConnectionDefinition<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
> extends ConnectionResolver<TNode, TSource, TArgs, TContext, TOutput> {
  connectionType: GraphQLObjectType;
  edgeType: GraphQLObjectType;
  nodeType: GraphQLOutputType;
  connectionArgs: GraphQLFieldConfigArgumentMap;
  resolve: ConnectionResolver<
    TNode,
    TSource,
    TArgs,
    TContext,
    TOutput
  >['resolveConnection'];
}

export function createConnectionResolver<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
>(
  options: ConnectionResolverOptions<
    TNode,
    TSource,
    TArgs,
    TContext,
    TOutput
  >
): ConnectionResolver<TNode, TSource, TArgs, TContext, TOutput>;

export function createConnection<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
>(
  options: ConnectionOptions<TNode, TSource, TArgs, TContext, TOutput>
): ConnectionDefinition<TNode, TSource, TArgs, TContext, TOutput>;

export const sequelizeConnection: typeof createConnection;

interface NodeTypeMapper {
  mapTypes(types: Record<string, unknown>): void;
  item(type: string): unknown;
}

export interface NodeInterfaceDefinition {
  nodeTypeMapper: NodeTypeMapper;
  nodeInterface: GraphQLInterfaceType;
  nodeField: unknown;
}

export function createNodeInterface(
  sequelize: Sequelize
): NodeInterfaceDefinition;

export const relay: {
  NodeTypeMapper: new () => NodeTypeMapper;
  idFetcher: (...args: unknown[]) => unknown;
  typeResolver: (...args: unknown[]) => unknown;
  isConnection: (type: { name?: string }) => boolean;
  handleConnection: (values: ReadonlyArray<unknown>, args: object) => unknown;
  createNodeInterface: typeof createNodeInterface;
  sequelizeNodeInterface: typeof createNodeInterface;
  nodeType: (connectionType: GraphQLObjectType) => GraphQLOutputType;
  createConnectionResolver: typeof createConnectionResolver;
  createConnection: typeof createConnection;
  sequelizeConnection: typeof createConnection;
};

export const JSONType: GraphQLScalarType;
export const DateType: GraphQLScalarType;
