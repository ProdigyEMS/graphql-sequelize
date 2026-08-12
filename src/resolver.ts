import { GraphQLList, GraphQLNonNull } from 'graphql';
import { Op, Utils } from 'sequelize';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  GraphQLFieldMap,
  GraphQLOutputType,
  GraphQLResolveInfo
} from 'graphql';
import type {
  Association,
  CountOptions,
  FindAttributeOptions,
  FindOptions,
  Model,
  ModelAttributeColumnOptions,
  ModelStatic,
  ProjectionAlias,
  UpdateOptions
} from 'sequelize';

import argsToFindOptions from './argsToFindOptions.js';
import type {
  MaybePromise,
  ResolverArguments,
  ResolverFactory,
  ResolverOptions,
  ResolverTarget
} from './contracts.js';
import { isConnection, handleConnection, nodeType } from './relay.js';
import normalizeVariableValues from './normalizeVariableValues.js';
import assert from 'assert';

type ConcreteResolverTarget =
  | ModelStatic<Model>
  | Association<Model, Model>;

interface AssociationWithAccessor extends Association<Model, Model> {
  readonly accessors: {
    readonly get: string;
  };
}

interface ResolverAttribute extends ModelAttributeColumnOptions {
  readonly field: string;
  readonly fieldName: string;
  readonly filterable?: boolean;
  readonly type: ModelAttributeColumnOptions['type'] & {
    readonly key?: string;
  };
}

interface ResolverInfo<TSource> extends GraphQLResolveInfo {
  readonly source: TSource;
  readonly target: ConcreteResolverTarget;
  readonly type: GraphQLOutputType;
}

interface GraphQLTypeShape {
  readonly ofType?: GraphQLTypeShape;
  readonly type?: GraphQLTypeShape;
  getFields?: () => GraphQLFieldMap<unknown, unknown>;
}

interface AssociationSource {
  readonly [key: string]: unknown;
}

/**
 * Narrow bridge to Sequelize v6's intentionally untyped query generator.
 *
 * Sequelize exposes QueryInterface.queryGenerator as unknown even though
 * Model.update uses its dialect-specific whereQuery implementation internally.
 */
interface SequelizeV6WhereQueryGenerator {
  whereQuery(
    where: unknown,
    options: { readonly model: ModelStatic<Model> }
  ): string;
}

type AssociationGetter = (options: FindOptions) => Promise<unknown>;
type QueryVariableResolver = (
  values: Readonly<Record<string, unknown>>
) => unknown;
type PrimaryKeyValue = string | number | bigint | Date | null | undefined;

enum WhereTraversalContext {
  Root,
  LogicalOperand,
  AttributeValue,
  AttributeLogicalOperand,
  ComparisonValue,
}

const UPDATE_MODEL_ERROR = 'Update operation requires a model target.';
const UPDATE_DATA_ERROR = 'No data provided to perform an update.';
const UPDATE_DATA_SHAPE_ERROR = 'Update data must be a plain object.';
const UPDATE_WHERE_ERROR = 'No where filter provided to perform an update.';
const UPDATE_JOIN_ERROR = 'Joined updates are not supported.';
const PRIMARY_KEY_REQUIRED_ERROR =
  'List and Relay resolvers require a model primary key.';

/**
 * View a runtime value as the property dictionary used by legacy filters.
 *
 * @param value value whose own keys are traversed
 * @return property dictionary preserving string and symbol keys
 */
function propertyRecord(value: unknown): Record<PropertyKey, unknown> {
  return value as Record<PropertyKey, unknown>;
}

/**
 * Resolve functions embedded in a Sequelize where tree against GraphQL values.
 *
 * @param object where-tree object to mutate
 * @param values normalized GraphQL variable values
 * @return nothing
 */
function whereQueryVarsToValues(
  object: unknown,
  values: Readonly<Record<string, unknown>>
): void {
  const record = propertyRecord(object);

  [
    ...Object.getOwnPropertyNames(object),
    ...Object.getOwnPropertySymbols(object),
  ].forEach((key) => {
    const value = record[key];

    if (typeof value === 'function') {
      record[key] = (value as QueryVariableResolver)(values);

      return;
    }

    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function')
    ) {
      whereQueryVarsToValues(value, values);
    }
  });
}

/**
 * Check whether a value provides a non-array object property surface.
 *
 * @param value runtime value to inspect
 * @return whether string and symbol properties can be read safely
 */
function isPropertyObject(value: unknown): value is object {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check whether a resolver target is a Sequelize model constructor.
 *
 * @param target target value to inspect
 * @return whether the target exposes the model methods used by this resolver
 */
function checkIsModel(target: unknown): target is ModelStatic<Model> {
  if (
    !target ||
    (typeof target !== 'object' && typeof target !== 'function')
  ) {
    return false;
  }

  const targetRecord = propertyRecord(target);
  const requiredMethods = [
    'count',
    'findAll',
    'findOne',
    'getAttributes',
    'getTableName',
    'update'
  ];
  const sequelize = targetRecord.sequelize;

  return typeof targetRecord.name === 'string' &&
    targetRecord.name.length > 0 &&
    isPropertyObject(targetRecord.options) &&
    isPropertyObject(targetRecord.rawAttributes) &&
    isPropertyObject(sequelize) &&
    typeof propertyRecord(sequelize).col === 'function' &&
    requiredMethods.every(
      (method) => typeof targetRecord[method] === 'function'
    );
}

/**
 * Check whether a resolver target is a Sequelize association.
 *
 * @param target target value to inspect
 * @return whether the target exposes a valid association shape
 */
function checkIsAssociation(
  target: unknown
): target is Association<Model, Model> {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const targetRecord = propertyRecord(target);
  const accessors = targetRecord.accessors;
  const source = targetRecord.source;
  const getterName = accessors && typeof accessors === 'object'
    ? propertyRecord(accessors).get
    : undefined;
  const sourcePrototype = checkIsModel(source)
    ? propertyRecord(source).prototype
    : undefined;

  return typeof targetRecord.associationType === 'string' &&
    targetRecord.associationType.length > 0 &&
    typeof targetRecord.as === 'string' &&
    targetRecord.as.length > 0 &&
    checkIsModel(targetRecord.target) &&
    checkIsModel(source) &&
    Boolean(accessors) &&
    typeof accessors === 'object' &&
    typeof getterName === 'string' &&
    getterName.length > 0 &&
    Boolean(sourcePrototype) &&
    (typeof sourcePrototype === 'object' ||
      typeof sourcePrototype === 'function') &&
    typeof propertyRecord(sourcePrototype)[getterName] === 'function';
}

/**
 * Check the complete runtime surface accepted as a resolver target.
 *
 * @param target resolved target value
 * @return whether the value is a usable model or association
 */
function checkIsResolverTarget(
  target: unknown
): target is ConcreteResolverTarget {
  return checkIsModel(target) || checkIsAssociation(target);
}

/**
 * Read a model's normalized runtime attribute metadata.
 *
 * Sequelize's public types describe definition-time attributes, while
 * getAttributes() also supplies fieldName and the library's filterable flag.
 *
 * @param model model whose attributes should be read
 * @return normalized attributes keyed by model attribute name
 */
function getResolverAttributes(
  model: ModelStatic<Model>
): Record<string, ResolverAttribute> {
  return model.getAttributes() as Record<string, ResolverAttribute>;
}

/**
 * Read the model attribute referenced by a Sequelize projection entry.
 *
 * @param projection string attribute or aliased projection
 * @return model attribute name when the projection names one directly
 */
function getProjectionAttributeName(
  projection: string | ProjectionAlias
): string | undefined {
  if (typeof projection === 'string') {
    return projection;
  }

  const [source] = projection;

  return typeof source === 'string' ? source : undefined;
}

/**
 * Derive physical model fields selected by a Sequelize attribute projection.
 *
 * The original projection is passed unchanged to Sequelize. This normalized
 * list exists only for the resolver's GROUP BY clause.
 *
 * @param projection Sequelize array or include/exclude projection
 * @param attributes normalized model attributes
 * @return selected non-virtual physical field names
 */
function getProjectedFields(
  projection: FindAttributeOptions,
  attributes: Readonly<Record<string, ResolverAttribute>>
): string[] {
  let selectedAttributes: Array<string | undefined>;

  if (Array.isArray(projection)) {
    selectedAttributes = projection.map(getProjectionAttributeName);
  } else {
    const excluded = new Set(projection.exclude || []);
    selectedAttributes = Object.keys(attributes).filter(
      (attributeName) => !excluded.has(attributeName)
    );
    selectedAttributes.push(
      ...(projection.include || []).map(getProjectionAttributeName)
    );
  }

  return [...new Set(selectedAttributes)]
    .map((attributeName) => attributeName
      ? attributes[attributeName]
      : undefined)
    .filter((attribute): attribute is ResolverAttribute => Boolean(attribute))
    .filter((attribute) => attribute.type.key !== 'VIRTUAL')
    .map((attribute) => attribute.field);
}

/**
 * Read a physical field mapping without consulting Object.prototype.
 *
 * @param fieldMap resolver-owned attribute-to-field dictionary
 * @param attributeName public model attribute name
 * @return mapped physical field when the dictionary owns a string value
 */
function getOwnFieldMapping(
  fieldMap: Readonly<Record<string, string>>,
  attributeName: string
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(fieldMap, attributeName)) {
    return undefined;
  }

  const field = fieldMap[attributeName];

  return typeof field === 'string' ? field : undefined;
}

/**
 * Read a dynamic option value from the GraphQL context.
 *
 * @param context GraphQL context value
 * @param key context property name
 * @return property value
 */
function getContextValue(context: unknown, key: string): unknown {
  return propertyRecord(context)[key];
}

/**
 * Determine whether include options are absent or an empty include array.
 *
 * @param include Sequelize include option
 * @return whether grouping can safely be applied
 */
function hasNoIncludes(include: FindOptions['include']): boolean {
  return !include || propertyRecord(include).length === 0;
}

/**
 * Check whether GraphQL supplied at least one query variable.
 *
 * @param variableValues GraphQL 16 values or GraphQL 17 wrapper
 * @return whether the value has enumerable variable metadata
 */
function hasVariableValues(variableValues: unknown): boolean {
  return Object.keys(Object(variableValues)).length > 0;
}

/**
 * Check whether a value is a plain object suitable for model update values.
 *
 * @param value candidate update data
 * @return whether the value has Object.prototype or a null prototype
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Validate update data and return its own attribute keys.
 *
 * @param data candidate update values
 * @param model resolved Sequelize model
 * @return validated own attribute keys
 */
function validateUpdateData(
  data: unknown,
  model: ModelStatic<Model>
): string[] {
  if (data === null || typeof data === 'undefined') {
    throw new Error(UPDATE_DATA_ERROR);
  }

  if (!isPlainObject(data)) {
    throw new Error(UPDATE_DATA_SHAPE_ERROR);
  }

  const fields = Object.keys(data);
  if (fields.length === 0) {
    throw new Error(UPDATE_DATA_ERROR);
  }

  fields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(model.rawAttributes, field)) {
      throw new Error(`Unknown update attribute: ${field}`);
    }
  });

  return fields;
}

/**
 * Check every physical array slot as a meaningful where-tree entry.
 *
 * Array.prototype.every skips sparse slots, which would otherwise let a
 * logical array containing no predicates pass the structural safety guard.
 *
 * @param entries logical where operands
 * @param context semantic position shared by every operand
 * @return whether the array is non-empty, dense, and entirely meaningful
 */
function hasMeaningfulWhereArray(
  entries: readonly unknown[],
  context: WhereTraversalContext
): boolean {
  return entries.length > 0 && Array.from(entries.keys()).every((index) =>
    Object.prototype.hasOwnProperty.call(entries, index) &&
    hasMeaningfulWhere(entries[index], context)
  );
}

/**
 * Check whether a where value contains at least one actual predicate.
 *
 * @param where Sequelize where expression
 * @param context semantic position of the value in the where tree
 * @return whether the expression constrains an update
 */
function hasMeaningfulWhere(
  where: unknown,
  context = WhereTraversalContext.Root
): boolean {
  if (where instanceof Utils.SequelizeMethod) {
    return true;
  }

  if (context === WhereTraversalContext.LogicalOperand) {
    if (Array.isArray(where)) {
      return hasMeaningfulWhereArray(
        where,
        WhereTraversalContext.Root
      );
    }

    return hasMeaningfulWhere(where, WhereTraversalContext.Root);
  }

  if (context === WhereTraversalContext.AttributeLogicalOperand) {
    if (Array.isArray(where)) {
      return hasMeaningfulWhereArray(
        where,
        WhereTraversalContext.AttributeValue
      );
    }

    return hasMeaningfulWhere(
      where,
      WhereTraversalContext.AttributeValue
    );
  }

  if (context === WhereTraversalContext.ComparisonValue) {
    if (typeof where === 'undefined') {
      return false;
    }

    if (where === null || typeof where !== 'object') {
      return true;
    }

    if (Array.isArray(where) || !isPlainObject(where)) {
      return true;
    }

    const comparisonKeys = [
      ...Object.getOwnPropertyNames(where),
      ...Object.getOwnPropertySymbols(where)
    ];

    return comparisonKeys.length > 0 && comparisonKeys.some((key) =>
      hasMeaningfulWhere(
        propertyRecord(where)[key],
        WhereTraversalContext.ComparisonValue
      )
    );
  }

  if (context === WhereTraversalContext.AttributeValue) {
    if (typeof where === 'undefined') {
      return false;
    }

    if (where === null || typeof where !== 'object') {
      return true;
    }

    if (Array.isArray(where) || !isPlainObject(where)) {
      return true;
    }

    const attributeKeys = [
      ...Object.getOwnPropertyNames(where),
      ...Object.getOwnPropertySymbols(where)
    ];

    return attributeKeys.length > 0 && attributeKeys.some((key) =>
      hasMeaningfulWhere(
        propertyRecord(where)[key],
        key === Op.and || key === Op.or || key === Op.not
          ? WhereTraversalContext.AttributeLogicalOperand
          : WhereTraversalContext.ComparisonValue
      )
    );
  }

  if (Array.isArray(where)) {
    return hasMeaningfulWhereArray(
      where,
      WhereTraversalContext.Root
    );
  }

  if (!isPlainObject(where)) {
    return false;
  }

  const whereKeys = [
    ...Object.getOwnPropertyNames(where),
    ...Object.getOwnPropertySymbols(where)
  ];

  return whereKeys.length > 0 && whereKeys.some((key) =>
    hasMeaningfulWhere(
      propertyRecord(where)[key],
      key === Op.and || key === Op.or || key === Op.not
        ? WhereTraversalContext.LogicalOperand
        : WhereTraversalContext.AttributeValue
    )
  );
}

/**
 * Check that Sequelize will normalize a where value into an actual SQL clause.
 *
 * This deliberately delegates to the same dialect query generator used by
 * Model.update without executing a probe query. The preceding structural guard
 * preserves stable rejection for invalid logical operands that Sequelize may
 * normalize to an always-false expression instead of rejecting.
 *
 * @param where resolver update predicate
 * @param model resolved model whose dialect and attributes normalize the where
 * @return whether Sequelize produces a non-empty WHERE clause
 */
function hasEffectiveUpdateWhere(
  where: unknown,
  model: ModelStatic<Model>
): boolean {
  if (!hasMeaningfulWhere(where)) {
    return false;
  }

  try {
    const sequelize = model.sequelize;
    if (!sequelize) {
      return false;
    }

    const queryInterface = sequelize.getQueryInterface();
    const queryGenerator = queryInterface.queryGenerator as
      SequelizeV6WhereQueryGenerator;
    if (typeof queryGenerator.whereQuery !== 'function') {
      return false;
    }

    const whereClause = queryGenerator.whereQuery(where, { model }).trim();

    return /^WHERE\s+\S/u.test(whereClause);
  } catch {
    // Malformed where values must fail closed with the public stable error.
    return false;
  }
}

/**
 * Check whether a where tree references an associated model field.
 *
 * @param value where-tree value
 * @return whether the tree needs a SQL join
 */
function hasJoinedReference(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = propertyRecord(value);
  const keys = [
    ...Object.getOwnPropertyNames(value),
    ...Object.getOwnPropertySymbols(value)
  ];

  return keys.some((key) => {
    if (typeof key === 'string' && /^\$[^.]+\./.test(key)) {
      return true;
    }

    return hasJoinedReference(record[key]);
  });
}

/**
 * Build Sequelize update options without read-only query properties.
 *
 * @param findOptions resolver find options returned by the before hook
 * @param fields validated model attributes being updated
 * @return options accepted by Model.update
 */
function createUpdateOptions(
  findOptions: FindOptions,
  fields: readonly string[],
  model: ModelStatic<Model>
): UpdateOptions {
  if (!hasEffectiveUpdateWhere(findOptions.where, model)) {
    throw new Error(UPDATE_WHERE_ERROR);
  }

  if (!hasNoIncludes(findOptions.include) ||
      hasJoinedReference(findOptions.where)) {
    throw new Error(UPDATE_JOIN_ERROR);
  }

  const updateOptions = {...findOptions};
  const updateOptionsRecord = propertyRecord(updateOptions);
  [
    'attributes',
    'group',
    'include',
    'limit',
    'offset',
    'order'
  ].forEach((key) => Reflect.deleteProperty(updateOptionsRecord, key));
  updateOptionsRecord.fields = [...fields];

  return updateOptions as UpdateOptions;
}

/**
 * Capture an exact post-update identity for every selected row.
 *
 * The update itself must ignore read pagination, while the read-after-write
 * still applies it. Capturing the complete identifier set also lets that read
 * find rows when the update changes a field used by the original predicate.
 *
 * @param findOptions resolved read options containing the update predicate
 * @param model model being updated
 * @param data validated update values
 * @return a predicate matching exactly the rows selected before the update
 */
async function captureUpdateResultWhere(
  findOptions: FindOptions,
  model: ModelStatic<Model>,
  data: Record<string, unknown>
): Promise<FindOptions['where'] | undefined> {
  const primaryKeys = model.primaryKeyAttributes;
  const automaticallyChangedAttributes = new Set<string>();
  if (model.options.timestamps !== false && model.options.updatedAt !== false) {
    automaticallyChangedAttributes.add(
      typeof model.options.updatedAt === 'string'
        ? model.options.updatedAt
        : 'updatedAt'
    );
  }
  if (model.options.version) {
    automaticallyChangedAttributes.add(
      typeof model.options.version === 'string'
        ? model.options.version
        : 'version'
    );
  }
  const identityAttributes = primaryKeys.length > 0
    ? primaryKeys
    : Object.entries(getResolverAttributes(model))
      .filter(([attributeName, attribute]) =>
        attribute.type.key !== 'VIRTUAL' &&
        !automaticallyChangedAttributes.has(attributeName)
      )
      .map(([attributeName]) => attributeName);
  if (identityAttributes.length === 0) {
    return undefined;
  }

  const targetOptions = {...findOptions};
  const targetOptionsRecord = propertyRecord(targetOptions);
  targetOptionsRecord.attributes = [...identityAttributes];
  targetOptionsRecord.raw = true;
  ['group', 'limit', 'offset', 'order'].forEach((key) =>
    Reflect.deleteProperty(targetOptionsRecord, key)
  );

  const targets = await model.findAll(targetOptions);
  const identifiers = targets.map((target) => {
    const targetRecord = propertyRecord(target);

    return Object.fromEntries(
      identityAttributes.map((attributeName) => [
        attributeName,
        Object.prototype.hasOwnProperty.call(data, attributeName)
          ? data[attributeName]
          : targetRecord[attributeName]
      ])
    );
  });

  return { [Op.or]: identifiers } as FindOptions['where'];
}

/**
 * Build count options from the resolved read options.
 *
 * Count queries must share filters, joins, transactions, logging, paranoid
 * settings, and dialect/custom options with the read they describe. Projection,
 * pagination, and ordering only shape the returned rows and are not compatible
 * with the aggregate count query.
 *
 * @param findOptions resolver find options returned by the before hook
 * @return independent options for Model.count
 */
function createCountOptions(findOptions: FindOptions): CountOptions {
  const countOptions = {...findOptions};
  const countOptionsRecord = propertyRecord(countOptions);
  ['attributes', 'limit', 'offset', 'order'].forEach((key) =>
    Reflect.deleteProperty(countOptionsRecord, key)
  );
  countOptionsRecord.distinct = true;

  return countOptions as CountOptions;
}

/** Field exposed to resolver after hooks for the current model read. */
interface ResolverCountContext {
  readonly count: () => Promise<unknown>;
}

type ResolverContextMetadataKey = keyof ResolverCountContext;
type ResolverContextMetadata = Record<ResolverContextMetadataKey, unknown>;

/** Resolver metadata scoped to one after-hook invocation. */
interface ResolverInvocationContext {
  readonly context: object;
  readonly metadata: ResolverContextMetadata;
}

/** Getter and setter installed for one resolver metadata property. */
interface ResolverContextAccessor {
  readonly get: () => unknown;
  readonly set: (value: unknown) => void;
}

/** Persistent metadata state for one shared GraphQL context object. */
interface ResolverSharedContextState {
  readonly accessors: Partial<
    Record<ResolverContextMetadataKey, ResolverContextAccessor>
  >;
  readonly fallback: ResolverContextMetadata;
}

const RESOLVER_CONTEXT_METADATA_KEYS = [
  'count',
] as const satisfies readonly ResolverContextMetadataKey[];
const resolverInvocationStorage =
  new AsyncLocalStorage<ResolverInvocationContext>();
const resolverSharedContextStates =
  new WeakMap<object, ResolverSharedContextState>();

/**
 * Create one metadata accessor for an original GraphQL context object.
 *
 * Reads inside an after hook use that invocation's async-local values. Reads
 * outside a hook use the most recently prepared or assigned shared values.
 * Assignments update both stores so v1's shared-context persistence remains
 * observable after sequential resolver calls.
 *
 * @param context original GraphQL context object
 * @param state persistent state for the original context
 * @param key metadata property exposed by the resolver
 * @return getter and setter installed on the original context
 */
function createResolverContextAccessor(
  context: object,
  state: ResolverSharedContextState,
  key: ResolverContextMetadataKey
): ResolverContextAccessor {
  return {
    get(): unknown {
      const invocation = resolverInvocationStorage.getStore();
      if (invocation?.context === context) {
        return invocation.metadata[key];
      }

      return state.fallback[key];
    },
    set(value: unknown): void {
      const invocation = resolverInvocationStorage.getStore();
      if (invocation?.context === context) {
        invocation.metadata[key] = value;
      }
      state.fallback[key] = value;
    },
  };
}

/**
 * Get or create persistent accessor state for a GraphQL context object.
 *
 * @param context original GraphQL context object
 * @param countContext current resolver metadata
 * @return persistent metadata state for the context
 */
function getResolverSharedContextState(
  context: object,
  countContext: ResolverCountContext
): ResolverSharedContextState {
  const existingState = resolverSharedContextStates.get(context);
  if (existingState) {
    return existingState;
  }

  const state: ResolverSharedContextState = {
    accessors: {},
    fallback: {...countContext},
  };
  RESOLVER_CONTEXT_METADATA_KEYS.forEach((key) => {
    state.accessors[key] = createResolverContextAccessor(
      context,
      state,
      key
    );
  });
  resolverSharedContextStates.set(context, state);

  return state;
}

/**
 * Install resolver metadata accessors without wrapping the original context.
 *
 * Configurable properties are replaced with accessors and safely reinstalled
 * if a hook later replaces or deletes them. A non-configurable property cannot
 * provide async-local isolation, so it keeps native shared-property behavior;
 * writable properties still receive the latest sequential resolver value and
 * read-only properties remain untouched without a defineProperty failure.
 *
 * @param context original GraphQL context value
 * @param countContext resolver-local count field
 * @return async-local invocation state, or undefined for primitive contexts
 */
function prepareResolverContext<TContext>(
  context: TContext,
  countContext: ResolverCountContext
): ResolverInvocationContext | undefined {
  if (
    !context ||
    (typeof context !== 'object' && typeof context !== 'function')
  ) {
    return undefined;
  }

  const contextObject = context as object;
  const state = getResolverSharedContextState(contextObject, countContext);
  const metadata: ResolverContextMetadata = {...countContext};

  RESOLVER_CONTEXT_METADATA_KEYS.forEach((key) => {
    state.fallback[key] = metadata[key];
    const accessor = state.accessors[key]!;
    const descriptor = Reflect.getOwnPropertyDescriptor(contextObject, key);
    const accessorIsInstalled =
      descriptor?.configurable === true &&
      descriptor.enumerable === true &&
      descriptor.get === accessor.get &&
      descriptor.set === accessor.set;

    if (accessorIsInstalled) {
      return;
    }

    if (descriptor && !descriptor.configurable) {
      Reflect.set(contextObject, key, metadata[key], contextObject);

      return;
    }

    if (!descriptor && !Reflect.isExtensible(contextObject)) {
      Reflect.set(contextObject, key, metadata[key], contextObject);

      return;
    }

    Reflect.defineProperty(contextObject, key, {
      configurable: true,
      enumerable: true,
      get: accessor.get,
      set: accessor.set,
    });
  });

  return { context: contextObject, metadata };
}

/**
 * Order an eager-loaded association array by the target model's primary key.
 *
 * A join emitted for an `include` carries no ORDER BY, so the rows arrive in
 * whatever order the database felt like producing. The query path does not
 * have this problem -- it defaults to `[[primaryKeyAttribute, 'ASC']]` for any
 * list -- but the preloaded path returned the array untouched, so the two
 * disagreed.
 *
 * That is worse than untidy for a Relay connection. Cursors are positional:
 * page one and page two are two separate round trips, and on postgres the same
 * unordered join genuinely does come back in different orders between them, so
 * the cursor from page one indexes into a different sequence on page two and
 * the caller silently sees a duplicated or skipped row. sqlite and mysql
 * happen to return insertion order here, which is why this only ever surfaced
 * as an intermittent postgres failure -- but nothing guarantees it on mssql,
 * the dialect the consuming service actually runs.
 *
 * Sorts a copy: the array belongs to the parent instance, and reordering it in
 * place would be visible to anything else holding that instance.
 *
 * @param row preloaded association row
 * @param primaryKey model primary-key attribute
 * @return primary-key value when the row exposes Sequelize's get method
 */
function getPrimaryKeyValue(
  row: unknown,
  primaryKey: string
): PrimaryKeyValue {
  if (
    !row ||
    (typeof row !== 'object' && typeof row !== 'function') ||
    !('get' in row) ||
    typeof row.get !== 'function'
  ) {
    return undefined;
  }

  return row.get(primaryKey) as PrimaryKeyValue;
}

/**
 * Order preloaded association rows by the target model's primary key.
 *
 * @param rows the preloaded association rows
 * @param model the Sequelize model the rows belong to
 * @return rows ordered by primary key ascending
 */
function orderByPrimaryKey(
  rows: unknown,
  model: ModelStatic<Model>
): unknown {
  const primaryKey = model && model.primaryKeyAttribute;
  if (!Array.isArray(rows) || !primaryKey) {
    return rows;
  }

  // Primary keys are not always numeric (uuid, string), so compare with the
  // relational operators rather than subtracting.
  return [...rows as readonly unknown[]].sort((a, b) => {
    const left = getPrimaryKeyValue(a, primaryKey);
    const right = getPrimaryKeyValue(b, primaryKey);

    if (left === right) return 0;
    if (left === undefined || left === null) return -1;
    if (right === undefined || right === null) return 1;

    return left < right ? -1 : 1;
  });
}

/**
 * Whether the named association is exposed as a Relay connection on the given
 * GraphQL type.
 *
 * Used to decide whether an association is safe to eager-load; see the
 * findOptions.include assignment for why connections must be excluded.
 *
 * @param graphqlType the type currently being resolved
 * @param associationName the Sequelize association alias
 * @return true when the field resolves to a connection
 */
function resolvesToConnection(
  graphqlType: GraphQLOutputType,
  associationName: string
): boolean {
  let namedType: GraphQLTypeShape | undefined =
    graphqlType as GraphQLTypeShape;
  while (namedType && (namedType.ofType || namedType.type)) {
    namedType = namedType.ofType || namedType.type;
  }

  if (!namedType || typeof namedType.getFields !== 'function') {
    return false;
  }

  const field = namedType.getFields()[associationName];
  if (!field || !field.type) {
    return false;
  }

  let fieldType = field.type as GraphQLTypeShape;
  while (fieldType.ofType) {
    fieldType = fieldType.ofType;
  }

  return isConnection(fieldType);
}

/**
 * Apply the resolver's normal connection transformation to association rows.
 *
 * @param result association rows
 * @param args resolver arguments
 * @param options resolver options
 * @param info GraphQL resolve information
 * @return raw rows or a Relay connection
 */
function transformAssociationResult<TSource, TContext, TArgs>(
  result: unknown,
  args: TArgs,
  options: ResolverOptions<TSource, TContext, TArgs>,
  info: GraphQLResolveInfo
): unknown {
  if (options.handleConnection && isConnection(info.returnType)) {
    return handleConnection(result, args);
  }

  return result;
}

/**
 * `models` and `requiredFilters` belong in the options object, preserving the
 * upstream resolver(target, options) shape.
 *
 * Positional arguments are rejected explicitly. JavaScript otherwise ignores
 * arguments beyond this function's signature, which can silently disable
 * required filters and hooks during a migration.
 *
 * Both values default to empty and fail closed -- no models means no
 * cross-model filterable attributes, no required filters means none are
 * enforced. Neither default widens what a caller is able to filter on.
 * They are destructured out of `options` so they cannot leak into the
 * sequelize find options built further down.
 */
const resolverFactory: ResolverFactory = function resolverFactory<
  TSource = unknown,
  TContext = unknown,
  TArgs = ResolverArguments
>(
  targetMaybeThunk: ResolverTarget<TSource, TContext, TArgs>,
  rawOptions: ResolverOptions<TSource, TContext, TArgs> = {}
) {
  assert(
    arguments.length <= 2,
    'resolver() accepts at most two arguments. Use resolver(target, { models, requiredFilters, ...options }).'
  );

  const { models = {}, requiredFilters = [], ...options } = rawOptions;
  assert(
    typeof targetMaybeThunk === 'function' ||
      checkIsResolverTarget(targetMaybeThunk),
    'resolverFactory should be called with a model, an association or a function (which resolves to a model or an association)'
  );
  assert(
    options.operation !== 'update' || !checkIsAssociation(targetMaybeThunk),
    UPDATE_MODEL_ERROR
  );

  const contextToOptions = Object.assign(
    {},
    resolverFactory.contextToOptions,
    options.contextToOptions
  );

  assert(
    options.include === undefined,
    'Include support has been removed in favor of dataloader batching'
  );
  if (options.before === undefined) {
    options.before = (findOptions: FindOptions) => findOptions;
  }
  if (options.after === undefined) {
    options.after = (result: unknown) => result;
  }
  if (options.handleConnection === undefined) options.handleConnection = true;
  const before = options.before;
  const after = options.after;

  return async function(
    source: TSource,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo
  ): Promise<unknown> {
    const sourceRecord = source as unknown as AssociationSource;
    const targetThunk = targetMaybeThunk as (
      source: TSource,
      args: TArgs,
      context: TContext,
      info: GraphQLResolveInfo
    ) => MaybePromise<ConcreteResolverTarget>;
    const target =
      typeof targetMaybeThunk === 'function' &&
      !checkIsModel(targetMaybeThunk)
        ? await Promise.resolve(targetThunk(source, args, context, info))
        : targetMaybeThunk as ConcreteResolverTarget;
    const isModel = checkIsModel(target);
    const isAssociation = checkIsAssociation(target);
    assert(
      checkIsResolverTarget(target),
      'Resolver target must resolve to a model or an association.'
    );
    assert(
      options.operation !== 'update' || isModel,
      UPDATE_MODEL_ERROR
    );
    const association = isAssociation
      ? target as AssociationWithAccessor
      : undefined;
    const model = (
      (isAssociation && target.target) ||
      (isModel && target)
    ) as ModelStatic<Model>;
    let type = info.returnType;
    const list =
      options.list ||
      type instanceof GraphQLList ||
      (type instanceof GraphQLNonNull && type.ofType instanceof GraphQLList);
    const argsRecord = propertyRecord(args);
    const modelAttributes = getResolverAttributes(model);
    const targetName = model.name;

    const attributes = Object.entries(modelAttributes)
      .filter(([, attr]) => !!attr.filterable)
      .map(([key]) => key);
    // Derive names exclusively from the resolved model. A target thunk's own
    // name describes the JavaScript function, not the model it returns, and
    // can be empty or absent.
    const associations = Object.keys(model.associations || {});

    const filterableAttributesFields = Object.create(null) as Record<
      string,
      string
    >;
    const filterableAttributes = [
      ...attributes,
      ...Object.entries(models)
        .filter(
          ([key]) => associations.includes(key) || key === targetName
        )
        .map(([, model]) =>
          Object.entries(getResolverAttributes(model))
            .filter(([, attr]) => !!attr.filterable)
            .map(([key, attr]) => {
              filterableAttributesFields[key] = attr.field;
              return key;
            })
        )
        // Initial value is required: without it this throws "Reduce of empty
        // array with no initial value" whenever no entry in `models` matches
        // the association filter above, which includes the case where no
        // models were supplied at all.
        .reduce((curr, next) => [...curr, ...next], []),
    ];

    const targetAttributes: FindAttributeOptions =
      (model.options.defaultScope && model.options.defaultScope.attributes) ||
      Object.keys(modelAttributes);
    const targetFields = getProjectedFields(
      targetAttributes,
      modelAttributes
    );
    const findOptions = argsToFindOptions(
      argsRecord,
      filterableAttributes,
      filterableAttributesFields,
      [...associations, targetName],
      requiredFilters
    );

    const resolverInfo: ResolverInfo<TSource> = {
      ...info,
      type,
      source,
      target,
    };

    const resolverContext = (context || {}) as TContext;
    let afterInvocationContext: ResolverInvocationContext | undefined;

    if (isConnection(type)) {
      type = nodeType(type) as GraphQLOutputType;
    }

    if ('ofType' in type) {
      type = type.ofType;
    }

    findOptions.attributes = targetAttributes;
    findOptions.logging = findOptions.logging ||
      getContextValue(resolverContext, 'logging') as FindOptions['logging'];
    const extendedFindOptions = findOptions as FindOptions & {
      graphqlContext?: TContext;
      [key: string]: unknown;
    };
    extendedFindOptions.graphqlContext = resolverContext;
    // Eager-load associations to avoid N+1, but never one that is resolved as
    // a Relay connection.
    //
    // Those two behaviours contradict each other. Including an association
    // here means source[association.as] is already populated by the time the
    // child resolver runs, and the branch further down returns that preloaded
    // array verbatim on the assumption the caller asked for it deliberately.
    // A connection's `first`/`last` limit is applied to findOptions, which
    // that path never uses -- so `tasks(first: 3)` returned every task.
    //
    // Connections are therefore left out and resolve themselves through the
    // association getter, which does honour the limit. Plain nested objects
    // still get eager-loaded exactly as before.
    findOptions.include = options.operation === 'update'
      ? []
      : associations.filter(
        (associationName) => !resolvesToConnection(type, associationName)
      );
    if (argsRecord.orderBy && Array.isArray(argsRecord.orderBy)) {
      findOptions.order = argsRecord.orderBy.map((order) => {
        // Destructure rather than splice: splice mutates the caller's
        // orderBy entry, so resolving the same args object twice saw an
        // already-emptied array and threw on undefined.split.
        const [first, ...rest] = order as readonly [unknown, ...string[]];

        // An order attribute may be a function, which the connection layer
        // resolves against (source, args, context, info) before building the
        // query -- see orderByAttribute in relay.js. There is no column name
        // to validate at this point, so pass the entry through untouched and
        // let that layer deal with it. Stringifying it here produced
        // nonsense like "Unknown order by: spy".
        if (typeof first === 'function') {
          return order as readonly unknown[];
        }

        const firstOrder = String(first).split('.');
        return [...firstOrder, ...rest].map((field) => {
          // Direction modifiers can carry a null-ordering suffix, e.g.
          // 'ASC NULLS LAST'. Validate the direction keyword itself.
          const [direction] = String(field).split(' ');
          if (
            !associations.includes(field) &&
            !filterableAttributes.includes(field) &&
            !['ASC', 'DESC'].includes(direction)
          ) {
            throw new Error(`Unknown order by: ${field}`);
          }

          return getOwnFieldMapping(filterableAttributesFields, field) || field;
        });
      }) as FindOptions['order'];
    }

    Object.entries(contextToOptions).forEach(([key, as]) => {
      extendedFindOptions[as] = getContextValue(resolverContext, key);
    });

    return Promise.resolve(
      before(findOptions, args, resolverContext, resolverInfo)
    )
      .then(async function(findOptions) {
        if (
          argsRecord.where &&
          hasVariableValues(resolverInfo.variableValues)
        ) {
          const variableValues = normalizeVariableValues(
            resolverInfo.variableValues
          );

          whereQueryVarsToValues(argsRecord.where, variableValues);
          whereQueryVarsToValues(findOptions.where, variableValues);
        }

        const primaryKey = model.primaryKeyAttribute;
        if (isConnection(resolverInfo.returnType) && !primaryKey) {
          throw new Error(PRIMARY_KEY_REQUIRED_ERROR);
        }

        if (list && !findOptions.order) {
          if (!primaryKey) {
            throw new Error(PRIMARY_KEY_REQUIRED_ERROR);
          }

          findOptions.order = [[primaryKey, 'ASC']];
        }

        if (
          !list &&
          !primaryKey &&
          !findOptions.order &&
          model.sequelize?.getDialect() === 'mssql'
        ) {
          const fallbackOrderAttribute = Object.keys(modelAttributes).find(
            (attributeName) =>
              modelAttributes[attributeName].type.key !== 'VIRTUAL' &&
              targetFields.includes(modelAttributes[attributeName].field)
          );

          if (fallbackOrderAttribute) {
            // Sequelize v6's MSSQL limit implementation always emits ORDER BY
            // model.primaryKeyField. removeAttribute('id') clears the public
            // primary-key attributes but leaves that internal field as `id`,
            // so findOne otherwise queries a column that no longer exists.
            // An explicitly projected physical attribute satisfies SQL
            // Server's OFFSET/FETCH requirement without inventing a key.
            findOptions.order = [[fallbackOrderAttribute, 'ASC']];
          }
        }

        if (options.operation === 'update') {
          const fields = validateUpdateData(argsRecord.data, model);
          const updateOptions = createUpdateOptions(
            findOptions,
            fields,
            model
          );
          const updateResultWhere = await captureUpdateResultWhere(
            findOptions,
            model,
            argsRecord.data as Record<string, unknown>
          );

          await model.update(
            argsRecord.data as Record<string, unknown>,
            updateOptions
          );

          if (updateResultWhere) {
            findOptions.where = updateResultWhere;
          }
        }

        if (association) {
          // Sequelize's MSSQL query generator omits LIMIT/OFFSET entirely when
          // limit is zero, turning an empty-page request into an unbounded
          // query. Resolve the dialect-independent result before calling the
          // association getter, while leaving the outer `after` callback in
          // the promise chain.
          if (findOptions.limit === 0) {
            return transformAssociationResult(
              [],
              args,
              options,
              resolverInfo
            );
          }

          // A preloaded association can only be used verbatim when this
          // resolver has no constraints of its own to apply. If it does -- a
          // limit from first/last, or a where built from args -- returning the
          // preloaded array silently ignores them, which is how
          // `tasks(first: 3)` came back with every task. In that case go
          // through the association getter so findOptions is actually honoured.
          // args.order/args.orderBy rather than findOptions.order: a default
          // order is applied to every list a few lines above, so testing the
          // findOptions value would treat every list as constrained and
          // disable eager loading entirely. Only an order the caller actually
          // asked for counts, since the eager-loaded rows arrive in whatever
          // order the join produced.
          const hasUnappliedConstraints = Boolean(
            findOptions.limit !== undefined ||
              findOptions.where ||
              findOptions.offset !== undefined ||
              argsRecord.order ||
              argsRecord.orderBy
          );

          if (
            sourceRecord[association.as] !== undefined &&
            !hasUnappliedConstraints
          ) {
            // The user did a manual include.
            //
            // Apply the same primary-key ordering the query path defaults to
            // for lists, so a preloaded array and a fetched one agree. Relay
            // cursors are positional and this array is about to be sliced by
            // one, so an unordered join is not merely inconsistent -- it makes
            // pagination return the wrong rows. See orderByPrimaryKey.
            const result = orderByPrimaryKey(
              sourceRecord[association.as],
              model
            );

            return transformAssociationResult(
              result,
              args,
              options,
              resolverInfo
            );
          } else {
            const getAssociation = sourceRecord[
              association.accessors.get
            ] as AssociationGetter;

            return getAssociation.call(source, findOptions).then(
              function(result: unknown) {
                return transformAssociationResult(
                  result,
                  args,
                  options,
                  resolverInfo
                );
              }
            );
          }
        }

        const countOptions = createCountOptions(findOptions);
        const countContext: ResolverCountContext = {
          count: () => model.count(countOptions),
        };

        // Accessors preserve historical shared-context fields while selecting
        // resolver-local metadata inside the current after hook. This keeps
        // concurrent siblings isolated without changing context identity.
        afterInvocationContext = prepareResolverContext(
          resolverContext,
          countContext
        );

        // Group only when nothing is being joined in.
        //
        // The group exists to collapse duplicate parent rows, but it can only
        // list the target model's own columns. Postgres enforces the SQL
        // standard here and rejects the query outright -- `column
        // "project.id" must appear in the GROUP BY clause or be used in an
        // aggregate function` -- because the include's columns are selected
        // but not grouped. sqlite and MySQL happen to tolerate it, which is
        // why this only ever surfaced on postgres.
        //
        // Without an include there is no fan-out to collapse, so the group is
        // only needed in the case where it is also legal.
        //
        // Columns are qualified with the model alias: bare names collide with
        // the joined table's once an include is present, giving
        // "ambiguous column name: id".
        if (hasNoIncludes(findOptions.include)) {
          findOptions.group = targetFields.map((field) =>
            model.sequelize!.col(`${model.name}.${field}`)
          );
        }

        return list
          ? model.findAll(findOptions)
          : model.findOne(findOptions);
      })
      .then(function(result: unknown) {
        if (!afterInvocationContext) {
          return after(result, args, resolverContext, resolverInfo);
        }

        return resolverInvocationStorage.run(
          afterInvocationContext,
          () => after(result, args, resolverContext, resolverInfo)
        );
      });
  };
};

resolverFactory.contextToOptions = {};

export default resolverFactory;
