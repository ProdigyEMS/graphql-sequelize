import {
  GraphQLInt,
  GraphQLString,
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLEnumType,
  GraphQLList,
} from 'graphql';
import type {GraphQLOutputType} from 'graphql';

import DateType from './types/dateType.js';
import JSONType from './types/jsonType.js';

interface SequelizeDataType {
  readonly key?: string;
  toSql(): string;
}

interface SequelizeArrayDataType extends SequelizeDataType {
  readonly type: SequelizeDataType;
}

interface SequelizeEnumDataType extends SequelizeDataType {
  readonly values: readonly string[];
}

interface SequelizeVirtualDataType extends SequelizeDataType {
  readonly returnType?: SequelizeDataType;
}

type SequelizeDataTypeConstructor = abstract new (...args: never[]) => SequelizeDataType;

/**
 * Check whether an unknown value is a Sequelize datatype instance.
 *
 * @param value value to inspect
 * @return whether the value exposes the datatype SQL contract
 */
function isSequelizeDataTypeInstance(value: unknown): value is SequelizeDataType {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'toSql' in value &&
    typeof value.toSql === 'function'
  );
}

/**
 * Narrow Sequelize ARRAY's runtime-only element datatype.
 *
 * Sequelize's public declarations omit `.type`, although its ARRAY constructor
 * populates that property at runtime.
 *
 * @param sequelizeType Sequelize datatype instance
 * @return whether the ARRAY element datatype is available
 */
function isSequelizeArrayDataType(
  sequelizeType: SequelizeDataType
): sequelizeType is SequelizeArrayDataType {
  return 'type' in sequelizeType &&
    isSequelizeDataTypeInstance(sequelizeType.type);
}

/**
 * Check a Sequelize datatype instance against one of its runtime constructors.
 *
 * Keeping this check boolean prevents structurally identical constructors from
 * incorrectly narrowing later branches to `never`.
 *
 * @param sequelizeType Sequelize datatype instance
 * @param dataTypeConstructor Sequelize datatype constructor
 * @return whether the value is an instance of the constructor
 */
function isSequelizeDataType(
  sequelizeType: SequelizeDataType,
  dataTypeConstructor: SequelizeDataTypeConstructor
): boolean {
  return sequelizeType instanceof dataTypeConstructor;
}

interface SequelizeDataTypes {
  readonly BOOLEAN: SequelizeDataTypeConstructor;
  readonly ENUM: SequelizeDataTypeConstructor;
  readonly FLOAT: SequelizeDataTypeConstructor;
  readonly REAL: SequelizeDataTypeConstructor;
  readonly CHAR: SequelizeDataTypeConstructor;
  readonly DECIMAL: SequelizeDataTypeConstructor;
  readonly DOUBLE: SequelizeDataTypeConstructor;
  readonly INTEGER: SequelizeDataTypeConstructor;
  readonly BIGINT: SequelizeDataTypeConstructor;
  readonly STRING: SequelizeDataTypeConstructor;
  readonly TEXT: SequelizeDataTypeConstructor;
  readonly UUID: SequelizeDataTypeConstructor;
  readonly UUIDV4: SequelizeDataTypeConstructor;
  readonly DATE: SequelizeDataTypeConstructor;
  readonly DATEONLY: SequelizeDataTypeConstructor;
  readonly TIME: SequelizeDataTypeConstructor;
  readonly ARRAY: SequelizeDataTypeConstructor;
  readonly VIRTUAL: SequelizeDataTypeConstructor;
  readonly JSON: SequelizeDataTypeConstructor;
  readonly JSONB: SequelizeDataTypeConstructor;
  readonly CITEXT: SequelizeDataTypeConstructor;
  readonly INET: SequelizeDataTypeConstructor;
}

const sequelizeDataTypeConstructorNames: ReadonlyArray<
  keyof SequelizeDataTypes
> = [
  'BOOLEAN',
  'ENUM',
  'FLOAT',
  'REAL',
  'CHAR',
  'DECIMAL',
  'DOUBLE',
  'INTEGER',
  'BIGINT',
  'STRING',
  'TEXT',
  'UUID',
  'UUIDV4',
  'DATE',
  'DATEONLY',
  'TIME',
  'ARRAY',
  'VIRTUAL',
  'JSON',
  'JSONB',
  'CITEXT',
  'INET'
];

/**
 * Narrow a legacy public mapper argument to Sequelize's datatype registry.
 *
 * @param value value supplied by a package consumer
 * @return whether all constructors used by the mapper are available
 */
function isSequelizeDataTypes(value: unknown): value is SequelizeDataTypes {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return false;
  }

  const dataTypes = value as Record<string, unknown>;

  return sequelizeDataTypeConstructorNames.every(
    (constructorName) => typeof dataTypes[constructorName] === 'function'
  );
}

export type CustomTypeMapper = (
  sequelizeType: unknown
) => GraphQLOutputType | null | undefined;

let customTypeMapper: CustomTypeMapper | null | undefined;

/**
 * A function to set a custom mapping of types
 * @param mapFunc custom type mapper, or null to restore default mapping
 * @return nothing
 */
export function mapType(mapFunc: CustomTypeMapper | null | undefined): void {
  customTypeMapper = mapFunc;
}

/**
 * Checks the type of the sequelize data type and
 * returns the corresponding type in GraphQL
 * @param sequelizeType Sequelize data type instance
 * @param sequelizeTypes Sequelize data type constructors
 * @return GraphQL type declaration
 */
export function toGraphQL(
  sequelizeType: unknown,
  sequelizeTypes: unknown
): GraphQLOutputType {
  if (customTypeMapper) {
    const customType = customTypeMapper(sequelizeType);

    if (customType) return customType;
  }

  if (!isSequelizeDataTypeInstance(sequelizeType)) {
    throw new TypeError('Expected a Sequelize data type instance.');
  }

  if (!isSequelizeDataTypes(sequelizeTypes)) {
    throw new TypeError('Expected the Sequelize data type registry.');
  }

  return mapToGraphQL(sequelizeType, sequelizeTypes);
}

/**
 * Map validated Sequelize datatype inputs to GraphQL output types.
 *
 * @param sequelizeType validated Sequelize datatype instance
 * @param sequelizeTypes validated Sequelize datatype constructors
 * @return GraphQL type declaration
 */
function mapToGraphQL(
  sequelizeType: SequelizeDataType,
  sequelizeTypes: SequelizeDataTypes
): GraphQLOutputType {
  const {
    BOOLEAN,
    ENUM,
    FLOAT,
    REAL,
    CHAR,
    DECIMAL,
    DOUBLE,
    INTEGER,
    BIGINT,
    STRING,
    TEXT,
    UUID,
    UUIDV4,
    DATE,
    DATEONLY,
    TIME,
    ARRAY,
    VIRTUAL,
    JSON,
    JSONB,
    CITEXT,
    INET,
  } = sequelizeTypes;

  // Map of special characters
  const specialCharsMap = new Map([
    ['¼', 'frac14'],
    ['½', 'frac12'],
    ['¾', 'frac34']
  ]);

  if (isSequelizeDataType(sequelizeType, BOOLEAN)) return GraphQLBoolean;

  if (isSequelizeDataType(sequelizeType, FLOAT) ||
      isSequelizeDataType(sequelizeType, REAL) ||
      isSequelizeDataType(sequelizeType, DOUBLE)) return GraphQLFloat;

  if (isSequelizeDataType(sequelizeType, DATE)) {
    return DateType;
  }

  if (isSequelizeDataType(sequelizeType, CHAR) ||
      isSequelizeDataType(sequelizeType, STRING) ||
      isSequelizeDataType(sequelizeType, TEXT) ||
      isSequelizeDataType(sequelizeType, UUID) ||
      isSequelizeDataType(sequelizeType, UUIDV4) ||
      isSequelizeDataType(sequelizeType, DATEONLY) ||
      isSequelizeDataType(sequelizeType, TIME) ||
      isSequelizeDataType(sequelizeType, BIGINT) ||
      isSequelizeDataType(sequelizeType, DECIMAL) ||
      isSequelizeDataType(sequelizeType, CITEXT) ||
      isSequelizeDataType(sequelizeType, INET)) {
    return GraphQLString;
  }

  if (isSequelizeDataType(sequelizeType, INTEGER)) {
    return GraphQLInt;
  }

  if (isSequelizeDataType(sequelizeType, ARRAY)) {
    if (!isSequelizeArrayDataType(sequelizeType)) {
      throw new Error(`Unable to convert ${sequelizeType.key || sequelizeType.toSql()} to a GraphQL type`);
    }

    const elementType = toGraphQL(sequelizeType.type, sequelizeTypes);
    return new GraphQLList(elementType);
  }

  if (isSequelizeDataType(sequelizeType, ENUM)) {
    const enumType = sequelizeType as SequelizeEnumDataType;
    const enumValues = Object.fromEntries(
      enumType.values.map((value) => [
        sanitizeEnumValue(value),
        {value}
      ])
    );

    return new GraphQLEnumType({
      name: 'tempEnumName',
      values: enumValues
    });
  }

  if (isSequelizeDataType(sequelizeType, VIRTUAL)) {
    const virtualType = sequelizeType as SequelizeVirtualDataType;
    const returnType = virtualType.returnType
      ? toGraphQL(virtualType.returnType, sequelizeTypes)
      : GraphQLString;
    return returnType;
  }

  if (isSequelizeDataType(sequelizeType, JSONB) ||
      isSequelizeDataType(sequelizeType, JSON)) {
    return JSONType;
  }

  throw new Error(`Unable to convert ${sequelizeType.key || sequelizeType.toSql()} to a GraphQL type`);

  /**
   * Convert a Sequelize enum value into a valid GraphQL enum name.
   *
   * @param value raw Sequelize enum value
   * @return sanitized GraphQL enum value name
   */
  function sanitizeEnumValue(value: string): string {
    return value
      .trim()
      .replace(/([^_a-zA-Z0-9])/g, (_match, character: string) => specialCharsMap.get(character) || ' ')
      .split(' ')
      .map((part, index) => index ? upperFirst(part) : part)
      .join('')
      .replace(/(^\d)/, '_$1');
  }

  /**
   * Uppercase the first character of a sanitized enum segment.
   *
   * @param value sanitized enum segment
   * @return segment with its first character uppercased
   */
  function upperFirst(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
