import { GraphQLList, GraphQLNonNull } from 'graphql';
import _ from 'lodash';
import argsToFindOptions from './argsToFindOptions';
import { isConnection, handleConnection, nodeType } from './relay';
import assert from 'assert';
import Promise from 'bluebird';

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
 * BREAKING (1.0.0): `models` and `requiredFilters` moved from positional
 * parameters 2 and 3 into `options`, restoring the upstream
 * resolver(target, options) shape.
 *
 * The positional form was a footgun: a legacy two-argument call such as
 * resolver(User, { before }) silently bound its options object to `models`
 * and ran with no options at all, failing at runtime rather than at the
 * call site.
 *
 * Both values default to empty and fail closed -- no models means no
 * cross-model filterable attributes, no required filters means none are
 * enforced. Neither default widens what a caller is able to filter on.
 * They are destructured out of `options` so they cannot leak into the
 * sequelize find options built further down.
 */
function resolverFactory(targetMaybeThunk, rawOptions = {}) {
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
    findOptions.include = associations;
    if (args.orderBy && Array.isArray(args.orderBy)) {
      findOptions.order = args.orderBy.map((order) => {
        // Destructure rather than splice: splice mutates the caller's
        // orderBy entry, so resolving the same args object twice saw an
        // already-emptied array and threw on undefined.split.
        const [first, ...rest] = order;
        const firstOrder = String(first).split('.');
        return [...firstOrder, ...rest].map((field) => {
          if (
            !associations.includes(field) &&
            !filterableAttributes.includes(field) &&
            !['ASC', 'DESC'].includes(field)
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
          whereQueryVarsToValues(args.where, info.variableValues);
          whereQueryVarsToValues(findOptions.where, info.variableValues);
        }

        if (list && !findOptions.order) {
          findOptions.order = [[model.primaryKeyAttribute, 'ASC']];
        }

        if (association) {
          if (source[association.as] !== undefined) {
            // The user did a manual include
            const result = source[association.as];
            if (options.handleConnection && isConnection(info.returnType)) {
              return handleConnection(result, args);
            }

            return result;
          } else {
            return source[association.accessors.get](findOptions).then(function(
              result
            ) {
              if (options.handleConnection && isConnection(info.returnType)) {
                return handleConnection(result, args);
              }
              return result;
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

        findOptions.group = targetFields;

        return model[list ? 'findAll' : 'findOne'](findOptions);
      })
      .then(function(result) {
        return options.after(result, args, context, info);
      });
  };
}

resolverFactory.contextToOptions = {};

module.exports = resolverFactory;
