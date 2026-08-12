import {
  fromGlobalId,
  connectionFromArray,
  nodeDefinitions,
  connectionDefinitions,
  connectionArgs
} from 'graphql-relay';

import { GraphQLEnumType, GraphQLList } from 'graphql';
import type {
  GraphQLFieldConfigArgumentMap,
  GraphQLOutputType,
  GraphQLResolveInfo
} from 'graphql';

import {
  base64,
  unbase64,
} from './base64.js';

import simplifyAST from './simplifyAST.js';

import {Model} from 'sequelize';
import type {
  Association,
  FindAttributeOptions,
  FindOptions,
  ModelStatic,
  Sequelize
} from 'sequelize';
import type {
  ConnectionCursor,
  ConnectionDefinition,
  ConnectionEdge,
  ConnectionOptions,
  ConnectionResolver,
  ConnectionResolverOptions,
  ConnectionResult,
  ConnectionWhere,
  DefaultConnectionOptions,
  DefaultConnectionResolverOptions,
  MaybePromise,
  NodeIdFetcher,
  NodeInterfaceDefinition,
  NodeResolverResult,
  NodeTypeMapperContract,
  NodeTypeMapping,
  NodeTypeMappingInput,
  NodeTypeResolver,
  RelayArrayConnection,
  RelayConnectionArguments,
  ResolverArguments,
  TransformedConnectionOptions,
  TransformedConnectionResolverOptions
} from './contracts.js';
import {replaceWhereOperators} from './replaceWhereOperators.js';
import resolver from './resolver.js';

type ConcreteResolverTarget =
  | ModelStatic<Model>
  | Association<Model, Model>;

type ConnectionArgumentsWithFilters = ResolverArguments & RelayConnectionArguments & {
  orderBy?: unknown;
};

type NormalizedConnectionArguments = Omit<
  RelayConnectionArguments,
  'first' | 'last'
> & {
  first?: number | null;
  last?: number | null;
};

type RelayOrderAttribute<TSource, TContext, TArgs> =
  | string
  | Record<string, unknown>
  | undefined
  | ((
      source: TSource,
      args: TArgs,
      context: TContext,
      info: GraphQLResolveInfo
    ) => unknown);

type RelayOrderEntry<TSource, TContext, TArgs> = readonly [
  RelayOrderAttribute<TSource, TContext, TArgs>,
  string
];

interface GraphQLEnumCompatibility {
  readonly _values: ReadonlyArray<{ readonly value: unknown }>;
  readonly _nameLookup: Record<string, { readonly value: unknown }>;
}

interface RelayResolverInfo<TSource> extends GraphQLResolveInfo {
  readonly source: TSource;
  readonly target: ConcreteResolverTarget;
}

interface LegacyCountTarget {
  readonly associationType?: string;
  readonly manyFromSource: {
    count(source: unknown, options: FindOptions): Promise<number>;
  };
  count(
    sourceOrOptions: unknown,
    options?: FindOptions
  ): Promise<number>;
}

interface RelayNodeMetadata {
  readonly __graphqlType__?: string;
  readonly Model?: ModelStatic<Model>;
  readonly _modelOptions?: {
    readonly name: {
      readonly singular: string;
    };
  };
  readonly constructor?: {
    readonly options?: {
      readonly name: {
        readonly singular: string;
      };
    };
  };
  readonly name?: string;
}

interface QueryGeneratorCompatibility {
  quoteIdentifier(identifier: string): string;
}

interface QueryInterfaceCompatibility {
  readonly queryGenerator?: QueryGeneratorCompatibility;
  readonly QueryGenerator?: QueryGeneratorCompatibility;
}

interface RelayConnectionTypeShape {
  readonly _fields: {
    readonly edges: {
      readonly type: {
        readonly ofType: {
          readonly _fields: {
            readonly node: {
              readonly type: GraphQLOutputType;
            };
          };
        };
      };
    };
  };
}

/** Return the Sequelize model constructor for a current or legacy instance. */
function getModelOfInstance(
  instance: unknown
): ModelStatic<Model> | undefined {
  if (instance instanceof Model) {
    // Sequelize's instance declaration inherits Object.constructor: Function,
    // while the runtime constructor is the ModelStatic that created it.
    return instance.constructor as ModelStatic<Model>;
  }

  if (!isObjectRecord(instance) || typeof instance.Model !== 'function') {
    return undefined;
  }

  // Older Sequelize exposed the model constructor through instance.Model.
  return instance.Model as ModelStatic<Model>;
}

/** Whether a runtime value can safely be read as an object record. */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Whether a value can safely carry Relay's string-keyed type annotation. */
function canCarryNodeMetadata(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    (typeof value === 'object' || typeof value === 'function');
}

/** Read GraphQL connection arguments from an untyped resolver boundary. */
function readConnectionArguments(value: unknown): NormalizedConnectionArguments {
  if (!isObjectRecord(value)) {
    throw new TypeError('Connection arguments must be an object.');
  }

  const { before, after, first, last } = value;
  const normalizedFirst = typeof first === 'string' && /^-?\d+$/u.test(first)
    ? parseInt(first, 10)
    : first;
  const normalizedLast = typeof last === 'string' && /^-?\d+$/u.test(last)
    ? parseInt(last, 10)
    : last;
  if (
    ![before, after].every(
      cursor => cursor === undefined || cursor === null || typeof cursor === 'string'
    ) ||
    ![normalizedFirst, normalizedLast].every(
      count => count === undefined || count === null || typeof count === 'number'
    )
  ) {
    throw new TypeError('Connection arguments have an invalid cursor or count.');
  }

  return {
    before: before === null || typeof before === 'string' ? before : undefined,
    after: after === null || typeof after === 'string' ? after : undefined,
    first: normalizedFirst === null || typeof normalizedFirst === 'number'
      ? normalizedFirst
      : undefined,
    last: normalizedLast === null || typeof normalizedLast === 'number'
      ? normalizedLast
      : undefined
  };
}

/** Whether a configured order attribute has a callable or Sequelize shape. */
function isRelayOrderAttribute<TSource, TContext, TArgs>(
  value: unknown
): value is RelayOrderAttribute<TSource, TContext, TArgs> {
  return typeof value === 'string' ||
    typeof value === 'function' ||
    value === undefined ||
    isObjectRecord(value);
}

/** Read the first configured ordering pair after GraphQL enum coercion. */
function readOrderEntry<TSource, TContext, TArgs>(
  value: unknown
): RelayOrderEntry<TSource, TContext, TArgs> {
  if (!Array.isArray(value) || !Array.isArray(value[0])) {
    throw new TypeError('Connection order must contain an ordering pair.');
  }

  const attribute: unknown = value[0][0];
  const direction: unknown = value[0][1];
  if (
    !isRelayOrderAttribute<TSource, TContext, TArgs>(attribute) ||
    typeof direction !== 'string'
  ) {
    throw new TypeError('Connection order has an invalid attribute or direction.');
  }

  return [attribute, direction];
}

/** Registry that normalizes and stores GraphQL node type mappings. */
export class NodeTypeMapper<TContext = unknown>
implements NodeTypeMapperContract<TContext> {
  private readonly map: Record<string, NodeTypeMapping<TContext>> = {};

  /** Add or replace one or more node type mappings. */
  mapTypes(types: Record<string, NodeTypeMappingInput<TContext>>): void {
    Object.keys(types).forEach((k) => {
      const v = types[k];
      this.map[k] = typeof v === 'object' && 'type' in v
        ? v
        : { type: v };
    });
  }

  /** Return the mapping registered for a GraphQL type name. */
  item(type: string): NodeTypeMapping<TContext> | undefined {
    return this.map[type];
  }
}

/** Build a Relay node ID fetcher backed by Sequelize and custom mappings. */
export function idFetcher<TContext = unknown>(
  sequelize: Sequelize,
  nodeTypeMapper: NodeTypeMapperContract<TContext>
): NodeIdFetcher<TContext> {
  return async (globalId, context, info): Promise<unknown> => {
    const {type, id} = fromGlobalId(globalId);

    const nodeType = nodeTypeMapper.item(type);
    if (nodeType && typeof nodeType.resolve === 'function') {
      const res: NodeResolverResult = await Promise.resolve(
        nodeType.resolve(globalId, context, info)
      );
      if (canCarryNodeMetadata(res)) res.__graphqlType__ = type;

      return res;
    }

    const model = Object.keys(sequelize.models).find(model => model === type);
    if (model) {
      const target = sequelize.models[model];
      // findById was renamed to findByPk in sequelize 5 and removed in 6.
      // peerDependencies still allow >=3.0.0, so support both spellings.
      const legacyTarget = target as typeof target & {
        findById?(identifier: string): Promise<Model | null>;
      };

      return target.findByPk
        ? target.findByPk(id)
        : legacyTarget.findById?.(id);
    }

    if (nodeType) {
      return typeof nodeType.type === 'string' ? info.schema.getType(nodeType.type) : nodeType.type;
    }

    return null;
  };
}

/** Build a GraphQL type resolver backed by a NodeTypeMapper. */
export function typeResolver<TContext = unknown>(
  nodeTypeMapper: NodeTypeMapperContract<TContext>
): NodeTypeResolver {
  return (obj): string | null => {
    // Sequelize 6 instances expose neither `.Model` nor `._modelOptions` --
    // both were removed after v3 -- so the old chain fell through to
    // `obj.name`, which on a model instance is the value of its `name`
    // column. The type lookup then failed and node queries resolved to null.
    // getModelOfInstance handles the modern shape (instance.constructor) and
    // still falls back to `.Model` for older sequelize versions, which the
    // peerDependency range still permits.
    const modelOfInstance = getModelOfInstance(obj);
    // RelayNodeValue deliberately exposes an object boundary so custom node
    // resolvers may return arbitrary domain objects. The metadata view reads
    // only the optional properties supported by the legacy implementation.
    const nodeMetadata = obj as RelayNodeMetadata;

    const type = nodeMetadata.__graphqlType__
               || (modelOfInstance && modelOfInstance.options
                 ? modelOfInstance.options.name?.singular
                 : nodeMetadata._modelOptions
                   ? nodeMetadata._modelOptions.name.singular
                   : nodeMetadata.constructor && nodeMetadata.constructor.options
                     ? nodeMetadata.constructor.options.name.singular
                     : nodeMetadata.name);

    if (!type) {
      throw new Error(`Unable to determine type of ${ typeof obj }. ` +
        `Either specify a resolve function in 'NodeTypeMapper' object, or specify '__graphqlType__' property on object.`);
    }

    const nodeType = nodeTypeMapper.item(type);
    if (nodeType) {
      return typeof nodeType.type === 'string' ? nodeType.type : nodeType.type.name;
    }

    return null;
  };
}

/** Determine whether a GraphQL type follows Relay's connection naming shape. */
export function isConnection(type: unknown): boolean {
  return typeof type === 'object' && type !== null &&
    'name' in type && typeof type.name === 'string' &&
    type.name.endsWith('Connection');
}

/** Slice an in-memory result array with graphql-relay cursor semantics. */
export function handleConnection<TNode>(
  values: ReadonlyArray<TNode>,
  args: RelayConnectionArguments
): RelayArrayConnection<TNode>;
/** Slice an untyped resolver result after validating its array shape. */
export function handleConnection(
  values: unknown,
  args: unknown
): RelayArrayConnection<unknown>;
export function handleConnection(
  values: unknown,
  args: unknown
): RelayArrayConnection<unknown> {
  if (!Array.isArray(values)) {
    throw new TypeError('Connection values must be an array.');
  }

  return connectionFromArray(values, readConnectionArguments(args));
}

/** Create Relay node fields and their shared Sequelize type mapper. */
export function createNodeInterface<TContext = unknown>(
  sequelize: Sequelize
): NodeInterfaceDefinition<TContext> {
  const nodeTypeMapper = new NodeTypeMapper<TContext>();
  // graphql-relay 0.10 declares undefined for an unresolved type, while the
  // legacy public resolver intentionally returns null. GraphQL accepts both at
  // runtime, so keep the v1 result and bridge only that declaration mismatch.
  const nodeObjects = nodeDefinitions<TContext>(
    idFetcher(sequelize, nodeTypeMapper),
    typeResolver(nodeTypeMapper) as unknown as NonNullable<
      Parameters<typeof nodeDefinitions>[1]
    >
  );

  return {
    nodeTypeMapper,
    ...nodeObjects
  };
}

export {createNodeInterface as sequelizeNodeInterface};

/** Read the node output type from a Relay connection type. */
export function nodeType(connectionType: GraphQLOutputType): GraphQLOutputType {
  const relayConnectionType = connectionType as unknown as RelayConnectionTypeShape;

  return relayConnectionType._fields.edges.type.ofType._fields.node.type;
}

/**
 * Build sequelize order terms for dialects that do not accept the SQL
 * NULLS FIRST/LAST suffix.
 *
 * @param {Model} model sequelize model being ordered
 * @param {String|Object} orderAttribute requested order attribute
 * @param {String} orderDirection requested direction and null placement
 * @return {Array} sequelize order terms
 */
function normalizeNullOrdering(
  model: ModelStatic<Model>,
  orderAttribute: unknown,
  orderDirection: string
): NonNullable<FindOptions['order']> {
  // Every supported resolver target is attached to a Sequelize instance;
  // an unattached model already failed at the same dereference in v1.
  const sequelize = model.sequelize!;
  const dialect = sequelize.getDialect();
  const nullOrder = /^(ASC|DESC) NULLS (FIRST|LAST)$/.exec(orderDirection);

  if (
    !['mssql', 'mysql'].includes(dialect) ||
    typeof orderAttribute !== 'string' ||
    !nullOrder
  ) {
    // Sequelize's Order declaration cannot represent the legacy object-valued
    // order attribute, though the dialect query generators accept it.
    return [[orderAttribute, orderDirection]] as NonNullable<FindOptions['order']>;
  }

  const [, direction, nullPlacement] = nullOrder;
  const usesNativeNullOrder =
    (direction === 'ASC' && nullPlacement === 'FIRST') ||
    (direction === 'DESC' && nullPlacement === 'LAST');

  if (usesNativeNullOrder) {
    return [[orderAttribute, direction]];
  }

  // These names are stable Sequelize internals across the supported v3-v6
  // range but are intentionally absent from its public QueryInterface type.
  const queryInterface = sequelize.getQueryInterface() as unknown as
    QueryInterfaceCompatibility;
  const queryGenerator =
    (queryInterface.queryGenerator || queryInterface.QueryGenerator)!;
  const attribute = model.getAttributes()[orderAttribute];
  const columnName = attribute?.field || orderAttribute;
  const qualifiedColumn =
    `${queryGenerator.quoteIdentifier(model.name)}.` +
    `${queryGenerator.quoteIdentifier(columnName)}`;
  const nullRank = nullPlacement === 'FIRST' ? 0 : 1;
  const nonNullRank = nullRank === 0 ? 1 : 0;
  const rankExpression = sequelize.literal(
    `CASE WHEN ${qualifiedColumn} IS NULL THEN ${nullRank} ELSE ${nonNullRank} END`
  );

  return [
    [rankExpression, 'ASC'],
    [orderAttribute, direction]
  ] as NonNullable<FindOptions['order']>;
}

/** Implement the resolver pair shared by the public overloads. */
function createConnectionResolverImplementation<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
>({
  target: targetMaybeThunk,
  before,
  after,
  where,
  orderBy: orderByEnum,
  ignoreArgs
}: ConnectionResolverOptions<
  TNode,
  TSource,
  TArgs,
  TContext,
  TOutput
>): ConnectionResolver<TNode, TSource, TArgs, TContext, TOutput> {
  const beforeHook = before || ((options: FindOptions) => options);
  // Without an after hook, the runtime output is the default ConnectionResult.
  // TOutput remains overrideable for the configured-hook case, so TypeScript
  // cannot prove the default branch's conditional relationship by itself.
  const afterHook = after || ((result: ConnectionResult<TNode, TSource, TArgs>) =>
    result as unknown as TOutput);

  const orderByAttribute = function (
    orderAttr: RelayOrderAttribute<TSource, TContext, TArgs>,
    resolveContext: {
      source: TSource;
      args: TArgs;
      context: TContext;
      info: GraphQLResolveInfo;
    }
  ): unknown {
    const { source, args, context, info } = resolveContext;

    return typeof orderAttr === 'function'
      ? orderAttr(source, args, context, info)
      : orderAttr;
  };

  const orderByDirection = function (
    orderDirection: string,
    args: RelayConnectionArguments
  ): string {
    if (!args.last) {
      return orderDirection;
    }

    const parsedDirection =
      /^(ASC|DESC)(?: NULLS (FIRST|LAST))?$/.exec(orderDirection);
    if (!parsedDirection) {
      return orderDirection;
    }

    const [, direction, nullPlacement] = parsedDirection;
    const reversedDirection = direction === 'ASC' ? 'DESC' : 'ASC';
    if (!nullPlacement) {
      return reversedDirection;
    }

    const reversedNullPlacement =
      nullPlacement === 'FIRST' ? 'LAST' : 'FIRST';

    return `${reversedDirection} NULLS ${reversedNullPlacement}`;
  };

  /**
   * Creates a cursor given a item returned from the Database
   * @param  {Object}   item   sequelize row
   * @param  {Integer}  index  the index of this item within the results, 0 indexed
   * @return {String}          The Base64 encoded cursor string
   */
  const toCursor = function (item: TNode, index: number): string {
    // Object boxes GraphQL scalar nodes without changing the object-node path;
    // this preserves v1 cursors for strings, numbers, and booleans.
    const itemRecord = isObjectRecord(item)
      ? item
      : Object(item) as Record<string, unknown>;
    const model = getModelOfInstance(item);
    const id = model ?
      typeof model.primaryKeyAttribute === 'string'
        ? itemRecord[model.primaryKeyAttribute]
        : null :
      itemRecord[Object.keys(itemRecord)[0]];

    return base64(JSON.stringify([id, index]));
  };

  /**
   * Decode a cursor into its component parts
   * @param  {String} cursor Base64 encoded cursor
   * @return {Object}        Object containing ID and index
   */
  const fromCursor = function (cursor: string): ConnectionCursor {
    const decoded: unknown = JSON.parse(unbase64(cursor));
    if (
      !Array.isArray(decoded) ||
      (decoded[1] !== null && typeof decoded[1] !== 'number')
    ) {
      throw new TypeError('Invalid Relay cursor.');
    }

    const id: unknown = decoded[0];
    // Standalone v1 edges encode an omitted NaN index as JSON null. Preserve
    // those cursor bytes and normalize only that legacy sentinel for paging.
    const index = decoded[1] === null ? 0 : decoded[1];

    return {
      id,
      index
    };
  };

  const argsToWhere = function (args: TArgs): ConnectionWhere {
    const result: ConnectionWhere = {};

    if (where === undefined) return result;

    if (!isObjectRecord(args)) {
      throw new TypeError('Connection arguments must be an object.');
    }

    Object.entries(args).forEach(([key, value]) => {
      if (ignoreArgs && key in ignoreArgs) return;
      Object.assign(result, where(key, value, result));
    });

    // Keys here come from the application's own `where` callback rather than
    // directly from client input, so attribute validation does not apply.
    // Stated explicitly so it cannot happen by omission.
    return replaceWhereOperators(result, { validateAttributes: false });
  };

  const resolveEdge = function (
    item: TNode,
    index?: number,
    queriedCursor?: ConnectionCursor | null,
    sourceArgs?: TArgs,
    source?: TSource
  ): ConnectionEdge<TNode, TSource, TArgs> {
    let startIndex: number | null = null;
    if (queriedCursor) startIndex = Number(queriedCursor.index);
    if (startIndex !== null) {
      startIndex++;
    } else {
      startIndex = 0;
    }

    const edgeIndex = index === undefined ? Number.NaN : index;

    return {
      cursor: toCursor(item, edgeIndex + startIndex),
      node: item,
      source,
      // Legacy callers may omit both metadata arguments. The implementation
      // has always returned an empty object for absent sourceArgs, which the
      // ConnectionEdge union now represents instead of claiming TArgs.
      sourceArgs: sourceArgs || {}
    };
  };

  const connectionResolver = resolver<TSource, TContext, TArgs>(
    targetMaybeThunk,
    {
      handleConnection: false,
      list: true,
      before: function (
        options: FindOptions,
        args: TArgs,
        context: TContext,
        info: GraphQLResolveInfo
      ): MaybePromise<FindOptions> {
        // resolver.ts adds source and target before invoking hooks; its public
        // GraphQL resolver contract cannot express those internal fields.
        const relayInfo = info as RelayResolverInfo<TSource>;
        const target = relayInfo.target;
        const model = 'target' in target ? target.target : target;
        const relayArgs = args as TArgs & ConnectionArgumentsWithFilters;

        if (relayArgs.first || relayArgs.last) {
          options.limit = parseInt(String(relayArgs.first || relayArgs.last), 10);
        }

        // Grab enum type by name if it's a string
        if (typeof orderByEnum === 'string') {
          const schemaOrderByType = info.schema.getType(orderByEnum);
          if (
            schemaOrderByType !== undefined &&
            !(schemaOrderByType instanceof GraphQLEnumType)
          ) {
            throw new TypeError(`Order type ${orderByEnum} must be an enum.`);
          }

          orderByEnum = schemaOrderByType;
        }
        // graphql-relay v1 reads GraphQLEnumType's private value lookup fields;
        // they are runtime-stable but deliberately omitted from graphql-js d.ts.
        const enumCompatibility = orderByEnum as GraphQLEnumCompatibility | undefined;

        let orderBy = relayArgs.orderBy ? relayArgs.orderBy :
          enumCompatibility ? [enumCompatibility._values[0].value] :
            [[model.primaryKeyAttribute, 'ASC']];

        if (enumCompatibility && typeof orderBy === 'string') {
          orderBy = [enumCompatibility._nameLookup[orderBy].value];
        }

        const orderEntry = readOrderEntry<TSource, TContext, TArgs>(orderBy);
        const orderAttribute = orderByAttribute(orderEntry[0], {
          source: relayInfo.source,
          args,
          context,
          info
        });
        const orderDirection = orderByDirection(orderEntry[1], relayArgs);

        options.order = normalizeNullOrdering(
          model,
          orderAttribute,
          orderDirection
        );
        // normalizeNullOrdering always constructs a mutable order-term array;
        // FindOptions also admits readonly/literal forms at its public boundary.
        const mutableOrder = options.order as Array<unknown>;

        if (orderAttribute !== model.primaryKeyAttribute) {
          mutableOrder.push([
            model.primaryKeyAttribute,
            orderByDirection('ASC', relayArgs)
          ]);
        }

        const projection = options.attributes;
        const attributes: Array<unknown> = Array.isArray(projection)
          ? projection
          : [
            ...Object.keys(model.getAttributes()).filter(
              attributeName => !projection?.exclude?.includes(attributeName)
            ),
            ...(projection?.include || [])
          ];
        if (typeof orderAttribute === 'string') {
          attributes.push(orderAttribute);
        }

        // Resolver targets are initialized models, matching the invariant used
        // by normalizeNullOrdering above.
        const sequelize = model.sequelize!;
        const hasFullCountAttribute = attributes.some(
          attribute => Array.isArray(attribute) &&
            attribute.length === 2 && attribute[1] === 'full_count'
        );
        if (options.limit && !hasFullCountAttribute) {
          const dialect = sequelize.getDialect();

          if (dialect === 'postgres') {
            attributes.push([
              sequelize.literal('COUNT(*) OVER()'),
              'full_count'
            ]);
          } else if (dialect === 'mssql' || dialect === 'sqlite') {
            attributes.push([
              sequelize.literal('COUNT(1) OVER()'),
              'full_count'
            ]);
          }
        }

        options.where = argsToWhere(args);

        if (relayArgs.after || relayArgs.before) {
          const cursorValue = relayArgs.after || relayArgs.before;
          if (typeof cursorValue !== 'string') {
            throw new TypeError('Invalid Relay cursor.');
          }

          const cursor = fromCursor(cursorValue);
          const startIndex = Number(cursor.index);

          if (startIndex >= 0) options.offset = startIndex + 1;
        }

        // Ensure the primary key is always the first selected attribute.
        attributes.unshift(model.primaryKeyAttribute);
        // The resolver populated this array from Sequelize's own attribute
        // projection. TypeScript cannot recover ProjectionAlias element types
        // after Array.isArray, so bridge the checked array back to Sequelize.
        options.attributes = [...new Set(attributes)] as FindAttributeOptions;

        return beforeHook(options, args, context, info);
      },
      after: async function (
        rawValues: unknown,
        args: TArgs,
        context: TContext,
        info: GraphQLResolveInfo
      ): Promise<TOutput> {
        if (!Array.isArray(rawValues)) {
          throw new TypeError('Connection resolver results must be an array.');
        }

        // The target resolver's `list: true` contract produces TNode[], but
        // ResolverFactory predates a result generic and exposes it as unknown.
        const values = rawValues as Array<TNode>;
        // See the matching before-hook bridge above.
        const relayInfo = info as RelayResolverInfo<TSource>;
        const {
          source,
          target
        } = relayInfo;
        const relayArgs = args as TArgs & ConnectionArgumentsWithFilters;

        let cursor: ConnectionCursor | null = null;

        if (relayArgs.after || relayArgs.before) {
          const cursorValue = relayArgs.after || relayArgs.before;
          if (typeof cursorValue !== 'string') {
            throw new TypeError('Invalid Relay cursor.');
          }

          cursor = fromCursor(cursorValue);
        }

        const edges = values.map((value, idx) => {
          return resolveEdge(value, idx, cursor, args, source);
        });

        const firstEdge = edges[0];
        const lastEdge = edges[edges.length - 1];
        const firstValue: unknown = values[0];
        const firstValueRecord = isObjectRecord(firstValue)
          ? firstValue
          : undefined;
        const dataValues = firstValueRecord?.dataValues;
        const countContainer = isObjectRecord(dataValues)
          ? dataValues
          : firstValueRecord;
        const rawFullCount = countContainer?.full_count;
        let fullCount: number | null | undefined;

        if (rawFullCount === null || rawFullCount === undefined) {
          fullCount = rawFullCount;
        } else {
          fullCount = rawFullCount
            ? parseInt(String(rawFullCount), 10)
            : Number(rawFullCount);
        }

        if (!firstValueRecord) {
          fullCount = 0;
        }

        const needsFallbackCount =
          (relayArgs.first || relayArgs.last) &&
          (fullCount === null || fullCount === undefined);
        if (needsFallbackCount) {
          // In case of `OVER()` is not available, we need to get the full count from a second query.
          const options = await Promise.resolve(beforeHook({
            where: argsToWhere(args)
          }, args, context, info));
          // The supported Sequelize versions expose count through different
          // Model/Association shapes; runtime feature checks choose the branch.
          const countTarget = target as unknown as LegacyCountTarget;

          if (typeof countTarget.count === 'function') {
            if (countTarget.associationType) {
              fullCount = await countTarget.count(source, options);
            } else {
              fullCount = await countTarget.count(options);
            }
          } else {
            fullCount = await countTarget.manyFromSource.count(source, options);
          }
        }

        let hasNextPage = false;
        let hasPreviousPage = false;
        if (relayArgs.first || relayArgs.last) {
          const count = parseInt(String(relayArgs.first || relayArgs.last), 10);
          let index = cursor ? Number(cursor.index) : null;
          if (index !== null) {
            index++;
          } else {
            index = 0;
          }

          const comparableFullCount = fullCount === null || fullCount === undefined
            ? Number.NaN
            : fullCount;
          hasNextPage = index + 1 + count <= comparableFullCount;
          hasPreviousPage = index - count >= 0;

          if (relayArgs.last) {
            [hasNextPage, hasPreviousPage] = [hasPreviousPage, hasNextPage];
          }
        }

        return afterHook({
          source,
          args,
          where: argsToWhere(args),
          edges,
          pageInfo: {
            startCursor: firstEdge ? firstEdge.cursor : null,
            endCursor: lastEdge ? lastEdge.cursor : null,
            hasNextPage: hasNextPage,
            hasPreviousPage: hasPreviousPage
          },
          fullCount
        }, args, context, info);
      }
    });

  const resolveConnection = (
    source: TSource,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo
  ): MaybePromise<TOutput> => {
    // GraphQL <14 called fieldNodes fieldASTs. Keep reading that optional alias
    // without widening the current GraphQLResolveInfo public contract.
    const legacyInfo = info as GraphQLResolveInfo & {
      readonly fieldASTs?: GraphQLResolveInfo['fieldNodes'];
    };
    const fieldNodes = legacyInfo.fieldASTs || info.fieldNodes;
    if (simplifyAST(fieldNodes[0]!, info).fields.edges) {
      // The configured after hook above guarantees TOutput; ResolverFactory's
      // Task 7 public contract intentionally returns Promise<unknown>.
      return connectionResolver(source, args, context, info) as Promise<TOutput>;
    }

    return afterHook({
      source,
      args,
      where: argsToWhere(args)
    }, args, context, info);
  };

  return {
    resolveEdge,
    resolveConnection
  };
}

/** Create a resolver that returns the default ConnectionResult. */
export function createConnectionResolver<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown
>(
  options: DefaultConnectionResolverOptions<
    TNode,
    TSource,
    TArgs,
    TContext
  >
): ConnectionResolver<
  TNode,
  TSource,
  TArgs,
  TContext,
  ConnectionResult<TNode, TSource, TArgs>
>;
/** Create a resolver whose required after hook transforms the output. */
export function createConnectionResolver<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
>(
  options: TransformedConnectionResolverOptions<
    TNode,
    TSource,
    TArgs,
    TContext,
    TOutput
  >
): ConnectionResolver<TNode, TSource, TArgs, TContext, TOutput>;
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
): ConnectionResolver<TNode, TSource, TArgs, TContext, TOutput> {
  return createConnectionResolverImplementation(options);
}

/** Implement GraphQL connection creation shared by the public overloads. */
function createConnectionImplementation<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
>({
  name,
  nodeType,
  target: targetMaybeThunk,
  orderBy: orderByEnum,
  before,
  after,
  connectionFields,
  edgeFields,
  where
}: ConnectionOptions<
  TNode,
  TSource,
  TArgs,
  TContext,
  TOutput
>): ConnectionDefinition<TNode, TSource, TArgs, TContext, TOutput> {
  const {
    edgeType,
    connectionType
  } = connectionDefinitions({
    name,
    nodeType,
    connectionFields,
    edgeFields
  });

  const $connectionArgs: GraphQLFieldConfigArgumentMap = {
    ...connectionArgs
  };

  if (orderByEnum) {
    $connectionArgs.orderBy = {
      type: new GraphQLList(orderByEnum)
    };
  }

  const {
    resolveEdge,
    resolveConnection
  } = createConnectionResolverImplementation<
    TNode,
    TSource,
    TArgs,
    TContext,
    TOutput
  >({
    orderBy: orderByEnum,
    target: targetMaybeThunk,
    before,
    after,
    where,
    ignoreArgs: $connectionArgs
  });

  return {
    connectionType,
    edgeType,
    nodeType,
    resolveEdge,
    resolveConnection,
    connectionArgs: $connectionArgs,
    resolve: resolveConnection
  };
}

/** Create GraphQL types backed by the default ConnectionResult. */
export function createConnection<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown
>(
  options: DefaultConnectionOptions<TNode, TSource, TArgs, TContext>
): ConnectionDefinition<
  TNode,
  TSource,
  TArgs,
  TContext,
  ConnectionResult<TNode, TSource, TArgs>
>;
/** Create GraphQL types whose required after hook transforms the output. */
export function createConnection<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
>(
  options: TransformedConnectionOptions<
    TNode,
    TSource,
    TArgs,
    TContext,
    TOutput
  >
): ConnectionDefinition<TNode, TSource, TArgs, TContext, TOutput>;
export function createConnection<
  TNode = unknown,
  TSource = unknown,
  TArgs = ResolverArguments,
  TContext = unknown,
  TOutput = ConnectionResult<TNode, TSource, TArgs>
>(
  options: ConnectionOptions<TNode, TSource, TArgs, TContext, TOutput>
): ConnectionDefinition<TNode, TSource, TArgs, TContext, TOutput> {
  return createConnectionImplementation(options);
}

export {createConnection as sequelizeConnection};
