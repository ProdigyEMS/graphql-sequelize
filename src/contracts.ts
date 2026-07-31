import type {
  GraphQLFieldResolver,
  GraphQLResolveInfo
} from 'graphql';
import type {
  Association,
  FindOptions,
  Model,
  ModelStatic
} from 'sequelize';

/** A value that may be returned immediately or through a promise-like object. */
export type MaybePromise<T> = T | PromiseLike<T>;

/** GraphQL resolver arguments keyed by their schema names. */
export type ResolverArguments = Record<string, unknown>;

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
