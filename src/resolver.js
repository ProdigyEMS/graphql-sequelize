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

function resolverFactory(
  targetMaybeThunk,
  models,
  requiredFilters,
  options = {}
) {
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
    const associations = Object.keys(targetMaybeThunk.associations);

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
        .reduce((curr, next) => [...curr, ...next]),
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
        const firstOrder = order.splice(0, 1)[0].split('.');
        return [...firstOrder, ...order].map((field) => {
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
