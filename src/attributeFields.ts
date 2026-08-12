import {
  GraphQLEnumType,
  GraphQLList,
  GraphQLNonNull
} from 'graphql';
import type {
  GraphQLFieldConfig,
  GraphQLFieldConfigMap,
  GraphQLNullableType,
  GraphQLOutputType,
  GraphQLType
} from 'graphql';
import {globalIdField} from 'graphql-relay';
import type {Model, ModelStatic} from 'sequelize';

import * as typeMapper from './typeMapper.js';

type AttributePredicate = (attributeName: string) => boolean;
type AttributeSelector = readonly string[] | AttributePredicate;
type AttributeMapper =
  | Readonly<Record<string, string>>
  | ((attributeName: string) => string | null | undefined);
type GraphQLNullableOutputType = Exclude<
  GraphQLOutputType,
  GraphQLNonNull<GraphQLNullableType>
>;
type MutableEnumList = GraphQLList<GraphQLEnumType> & {
  ofType: GraphQLEnumType;
};
type MutableEnumType = GraphQLEnumType & {
  name: string;
};

export interface AttributeFieldsOptions {
  cache?: Record<string, GraphQLType>;
  exclude?: AttributeSelector;
  only?: AttributeSelector;
  map?: AttributeMapper;
  globalId?: boolean;
  allowNull?: boolean;
  commentToDescription?: boolean;
}

/**
 * Determine whether an attribute selector contains or accepts a field name.
 *
 * @param selector configured attribute names or predicate
 * @param attributeName Sequelize attribute name
 * @return whether the selector matches the attribute
 */
function selectorMatches(
  selector: unknown,
  attributeName: string
): boolean | undefined {
  if (typeof selector === 'function') {
    return (selector as AttributePredicate)(attributeName);
  }

  if (Array.isArray(selector)) {
    return selector.includes(attributeName);
  }

  return undefined;
}

/**
 * Resolve the public GraphQL field name for a Sequelize attribute.
 *
 * @param mapper configured field-name map or callback
 * @param attributeName Sequelize attribute name
 * @return mapped field name, falling back to the original name
 */
function mapAttributeName(
  mapper: AttributeMapper,
  attributeName: string
): string {
  if (typeof mapper === 'function') {
    return mapper(attributeName) || attributeName;
  }

  return mapper[attributeName] || attributeName;
}

/**
 * Reuse or name enum types so repeated field-map creation does not introduce
 * duplicate GraphQL enum type names.
 *
 * GraphQL exposes enum names and list members as readonly, but the historical
 * API intentionally mutates these runtime objects while populating its cache.
 *
 * @param field field configuration containing the mapped type
 * @param typeName model-specific enum type name
 * @param cache shared enum cache
 * @return nothing
 */
function cacheEnumType(
  field: GraphQLFieldConfig<Model, unknown>,
  typeName: string,
  cache: Record<string, GraphQLType>
): void {
  const fieldType = field.type;
  const enumList = fieldType instanceof GraphQLList &&
    fieldType.ofType instanceof GraphQLEnumType
    ? fieldType as MutableEnumList
    : undefined;
  const enumType = fieldType instanceof GraphQLEnumType
    ? fieldType
    : enumList?.ofType;

  if (!enumType) {
    return;
  }

  const cachedType = cache[typeName];
  if (cachedType instanceof GraphQLEnumType) {
    if (enumList) {
      enumList.ofType = cachedType;
    } else {
      field.type = cachedType;
    }

    return;
  }

  (enumType as MutableEnumType).name = typeName;
  cache[typeName] = enumType;
}

/**
 * Convert Sequelize model attributes into GraphQL field configurations.
 *
 * @param model Sequelize model constructor
 * @param options field filtering, mapping, and metadata options
 * @return GraphQL fields for the model attributes
 */
export default function attributeFields(
  model: ModelStatic<Model>,
  options: AttributeFieldsOptions = {}
): GraphQLFieldConfigMap<Model, unknown> {
  const cache = options.cache || {};
  const result = Object.keys(model.rawAttributes).reduce<
    GraphQLFieldConfigMap<Model, unknown>
  >((fields, attributeName) => {
    if (options.exclude && selectorMatches(options.exclude, attributeName)) {
      return fields;
    }

    if (options.only && selectorMatches(options.only, attributeName) === false) {
      return fields;
    }

    const attribute = model.rawAttributes[attributeName];
    const fieldName = options.map
      ? mapAttributeName(options.map, attributeName)
      : attributeName;
    const sequelizeTypes = model.sequelize!.constructor as unknown as
      Parameters<typeof typeMapper.toGraphQL>[1];
    const field: GraphQLFieldConfig<Model, unknown> = {
      type: typeMapper.toGraphQL(
        attribute.type as unknown as Parameters<typeof typeMapper.toGraphQL>[0],
        sequelizeTypes
      )
    };

    fields[fieldName] = field;
    cacheEnumType(field, `${model.name}${fieldName}EnumType`, cache);

    if (
      !options.allowNull &&
      (attribute.allowNull === false || attribute.primaryKey === true)
    ) {
      field.type = new GraphQLNonNull(
        field.type as GraphQLNullableOutputType
      );
    }

    if (
      options.commentToDescription &&
      typeof attribute.comment === 'string'
    ) {
      field.description = attribute.comment;
    }

    return fields;
  }, {});

  if (options.globalId) {
    result.id = globalIdField<unknown>(
      model.name,
      (instance: Model): string | number => (
        instance as Model & Record<string, string | number>
      )[model.primaryKeyAttribute]
    );
  }

  return result;
}
