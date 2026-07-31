import { GraphQLList, GraphQLNonNull } from 'graphql';
import _ from 'lodash';
import argsToFindOptions from './argsToFindOptions';
import { isConnection, handleConnection, nodeType } from './relay';
import normalizeVariableValues from './normalizeVariableValues';
import assert from 'assert';

function whereQueryVarsToValues(o, vals) {
  [
    ...Object.getOwnPropertyNames(o),
    ...Object.getOwnPropertySymbols(o),
  ].forEach((k) => {
    if (_.isFunction(o[k])) {
      o[k] = o[k](vals);
      return;
    }
    if (_.isObject(o[k])) {
      whereQueryVarsToValues(o[k], vals);
    }
  });
}

function checkIsModel(target) {
  return !!target.getTableName;
}

function checkIsAssociation(target) {
  return !!target.associationType;
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
 * @param {Array} rows the preloaded association rows
 * @param {Object} model the sequelize model the rows belong to
 * @return {Array} rows ordered by primary key ascending
 */
function orderByPrimaryKey(rows, model) {
  const primaryKey = model && model.primaryKeyAttribute;
  if (!Array.isArray(rows) || !primaryKey) {
    return rows;
  }

  // Primary keys are not always numeric (uuid, string), so compare with the
  // relational operators rather than subtracting.
  return [...rows].sort((a, b) => {
    const left = a && a.get ? a.get(primaryKey) : undefined;
    const right = b && b.get ? b.get(primaryKey) : undefined;

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
 * @param {Object} graphqlType the type currently being resolved
 * @param {String} associationName the sequelize association alias
 * @return {Boolean} true when the field resolves to a connection
 */
function resolvesToConnection(graphqlType, associationName) {
  let namedType = graphqlType;
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

  let fieldType = field.type;
  while (fieldType.ofType) {
    fieldType = fieldType.ofType;
  }

  return isConnection(fieldType);
}

/**
 * Apply the resolver's normal connection transformation to association rows.
 *
 * @param {Array} result association rows
 * @param {Object} args resolver arguments
 * @param {Object} options resolver options
 * @param {Object} info GraphQL resolve information
 * @return {Array|Object} raw rows or a Relay connection
 */
function transformAssociationResult(result, args, options, info) {
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
function resolverFactory(targetMaybeThunk, rawOptions = {}) {
  assert(
    arguments.length <= 2,
    'resolver() accepts at most two arguments. Use resolver(target, { models, requiredFilters, ...options }).'
  );

  const { models = {}, requiredFilters = [], ...options } = rawOptions;
  assert(
    typeof targetMaybeThunk === 'function' ||
      checkIsModel(targetMaybeThunk) ||
      checkIsAssociation(targetMaybeThunk),
    'resolverFactory should be called with a model, an association or a function (which resolves to a model or an association)'
  );

  const contextToOptions = _.assign(
    {},
    resolverFactory.contextToOptions,
    options.contextToOptions
  );

  assert(
    options.include === undefined,
    'Include support has been removed in favor of dataloader batching'
  );
  if (options.before === undefined) options.before = (options) => options;
  if (options.after === undefined) options.after = (result) => result;
  if (options.handleConnection === undefined) options.handleConnection = true;

  return async function(source, args, context, info) {
    let target =
        typeof targetMaybeThunk === 'function' &&
        !checkIsModel(targetMaybeThunk)
          ? await Promise.resolve(targetMaybeThunk(source, args, context, info))
          : targetMaybeThunk,
      isModel = checkIsModel(target),
      isAssociation = checkIsAssociation(target),
      association = isAssociation && target,
      model = (isAssociation && target.target) || (isModel && target),
      type = info.returnType,
      list =
        options.list ||
        type instanceof GraphQLList ||
        (type instanceof GraphQLNonNull && type.ofType instanceof GraphQLList);

    const attributes = Object.entries(model.getAttributes())
      .filter(([, attr]) => !!attr.filterable)
      .map(([key]) => key);
    // targetMaybeThunk is only a Model in the simplest case -- it may also be
    // a thunk or an association (see the assert above), neither of which
    // carries `.associations`. Fall back to the resolved model, then to an
    // empty set, which fails closed by contributing no filterable attributes.
    const associations = Object.keys(
      (targetMaybeThunk && targetMaybeThunk.associations) ||
        (model && model.associations) ||
        {}
    );

    const filterableAttributesFields = {};
    const filterableAttributes = [
      ...attributes,
      ...Object.entries(models)
        .filter(
          ([key]) => associations.includes(key) || key === targetMaybeThunk.name
        )
        .map(([, model]) =>
          Object.entries(model.getAttributes())
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

    let targetAttributes =
        (model.options.defaultScope && model.options.defaultScope.attributes) ||
        Object.keys(model.getAttributes()),
      targetFields = Object.values(model.getAttributes())
        .filter((attr) => targetAttributes.includes(attr.fieldName))
        // VIRTUAL attributes are computed in JS and have no column, so
        // including them produces `GROUP BY ... myVirtual` and the database
        // rejects the statement with an unknown-column error.
        .filter((attr) => !attr.type || attr.type.key !== 'VIRTUAL')
        .map((attr) => attr.field),
      findOptions = argsToFindOptions(
        args,
        filterableAttributes,
        filterableAttributesFields,
        [...associations, targetMaybeThunk.name],
        requiredFilters
      );

    info = {
      ...info,
      type: type,
      source: source,
      target: target,
    };

    context = context || {};

    if (isConnection(type)) {
      type = nodeType(type);
    }

    type = type.ofType || type;

    findOptions.attributes = targetAttributes;
    findOptions.logging = findOptions.logging || context.logging;
    findOptions.graphqlContext = context;
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
    findOptions.include = associations.filter(
      (associationName) => !resolvesToConnection(type, associationName)
    );
    if (args.orderBy && Array.isArray(args.orderBy)) {
      findOptions.order = args.orderBy.map((order) => {
        // Destructure rather than splice: splice mutates the caller's
        // orderBy entry, so resolving the same args object twice saw an
        // already-emptied array and threw on undefined.split.
        const [first, ...rest] = order;

        // An order attribute may be a function, which the connection layer
        // resolves against (source, args, context, info) before building the
        // query -- see orderByAttribute in relay.js. There is no column name
        // to validate at this point, so pass the entry through untouched and
        // let that layer deal with it. Stringifying it here produced
        // nonsense like "Unknown order by: spy".
        if (typeof first === 'function') {
          return order;
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

          return filterableAttributesFields[field] || field;
        });
      });
    }

    _.each(contextToOptions, (as, key) => {
      findOptions[as] = context[key];
    });

    return Promise.resolve(options.before(findOptions, args, context, info))
      .then(async function(findOptions) {
        if (args.where && !_.isEmpty(info.variableValues)) {
          const variableValues = normalizeVariableValues(info.variableValues);

          whereQueryVarsToValues(args.where, variableValues);
          whereQueryVarsToValues(findOptions.where, variableValues);
        }

        if (list && !findOptions.order) {
          findOptions.order = [[model.primaryKeyAttribute, 'ASC']];
        }

        if (association) {
          // Sequelize's MSSQL query generator omits LIMIT/OFFSET entirely when
          // limit is zero, turning an empty-page request into an unbounded
          // query. Resolve the dialect-independent result before calling the
          // association getter, while leaving the outer `after` callback in
          // the promise chain.
          if (findOptions.limit === 0) {
            return transformAssociationResult([], args, options, info);
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
              args.order ||
              args.orderBy
          );

          if (source[association.as] !== undefined && !hasUnappliedConstraints) {
            // The user did a manual include.
            //
            // Apply the same primary-key ordering the query path defaults to
            // for lists, so a preloaded array and a fetched one agree. Relay
            // cursors are positional and this array is about to be sliced by
            // one, so an unordered join is not merely inconsistent -- it makes
            // pagination return the wrong rows. See orderByPrimaryKey.
            const result = orderByPrimaryKey(source[association.as], model);

            return transformAssociationResult(result, args, options, info);
          } else {
            return source[association.accessors.get](findOptions).then(function(
              result
            ) {
              return transformAssociationResult(result, args, options, info);
            });
          }
        }

        if (options.operation === 'update') {
          const dataArr = Object.entries(args.data).map(([key, value]) => {
            return `${key} = ${value}`;
          });
          if (dataArr.length === 0) {
            throw new Error('No data provided to perform an update.');
          }
          const updateData = dataArr.join(', ');
          const joinsArr = Object.entries(
            targetMaybeThunk.options.associations
          ).map(([key, association]) => {
            return `LEFT OUTER JOIN ${
              models[key].tableName
            } AS ${key} ON [${key}].[${association.foreignKey}] = [${
              targetMaybeThunk.name
            }].[${association.sourceKey}]`;
          });
          const updateJoins = joinsArr.length === 0 ? '' : joinsArr.join(',');

          const whereObj = targetMaybeThunk.sequelize
            .getQueryInterface()
            .queryGenerator.getWhereConditions(findOptions.where);

          const sql = `UPDATE ${
            targetMaybeThunk.tableName
          } SET ${updateData} FROM  ${targetMaybeThunk.tableName} AS ${
            targetMaybeThunk.name
          } ${updateJoins} WHERE ${whereObj}`;

          await targetMaybeThunk.sequelize.query(sql);
        }

        Object.assign(context, {
          count: () =>
            model.count({
              where: findOptions.where,
              include: findOptions.include,
              distinct: true,
            }),
        });

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
        if (!findOptions.include || findOptions.include.length === 0) {
          findOptions.group = targetFields.map((field) =>
            model.sequelize.col(`${model.name}.${field}`)
          );
        }

        return model[list ? 'findAll' : 'findOne'](findOptions);
      })
      .then(function(result) {
        return options.after(result, args, context, info);
      });
  };
}

resolverFactory.contextToOptions = {};

module.exports = resolverFactory;
