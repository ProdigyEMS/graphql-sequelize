import {Kind} from 'graphql';
import type {
  ASTNode,
  FragmentDefinitionNode,
  GraphQLResolveInfo,
  ObjectValueNode,
  SelectionNode,
  ValueNode
} from 'graphql';

import normalizeVariableValues from './normalizeVariableValues.js';

/** A recursively simplified GraphQL selection tree. */
export interface SimplifiedAST {
  fields: Record<string, SimplifiedAST>;
  args: Record<string, unknown>;
  key?: string;
  readonly $parent?: SimplifiedAST;
}

/** A merged root returned for an AST node collection. */
export interface SimplifiedASTCollection {
  fields?: Record<string, SimplifiedAST>;
}

type SimplifyInfo = Partial<GraphQLResolveInfo>;

/**
 * Create an empty simplified AST node.
 *
 * @return a simplified AST node with no fields or arguments
 */
function createSimplifiedAST(): SimplifiedAST {
  return {
    fields: {},
    args: {}
  };
}

/**
 * Create the legacy placeholder populated while sibling selections are merged.
 *
 * The placeholder intentionally starts without `fields` or `args`. In
 * particular, simplifying an array historically returns a root with only
 * `fields`, because deep merging deliberately ignores `args`.
 *
 * @return an initially empty simplified AST placeholder
 */
function createPlaceholder(): SimplifiedAST {
  return {} as SimplifiedAST;
}

/**
 * Create the legacy root returned for an empty AST collection.
 *
 * @return an empty AST collection without fabricated node properties
 */
function createCollection(): SimplifiedASTCollection {
  return {};
}

/**
 * Expose an object's string-keyed properties for the legacy merge algorithm.
 *
 * @param value object whose enumerable properties will be merged
 * @return the same object viewed as a string-keyed record
 */
function objectRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Read an own dictionary value without consulting Object.prototype.
 *
 * @param record dictionary to read
 * @param key property name to read
 * @return the own value, or undefined when the key is inherited or absent
 */
function getOwnValue<T>(
  record: Readonly<Record<string, T>>,
  key: string
): T | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }

  return record[key];
}

/**
 * Define an own enumerable dictionary entry without invoking legacy setters.
 *
 * @param record dictionary receiving the value
 * @param key property name to define
 * @param value property value
 * @return nothing
 */
function defineOwnValue<T>(
  record: Record<string, T>,
  key: string,
  value: T
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

/**
 * Merge two objects while preserving the simplifier's field semantics.
 *
 * `fields` and `args` are intentionally special at every recursive level. This
 * includes field maps, where those names can also be GraphQL response keys.
 * Reads and writes stay on own data properties so legal response keys cannot
 * reach inherited objects or invoke Object.prototype's `__proto__` setter.
 *
 * @param target object receiving merged values
 * @param source object to merge into the target
 * @return the mutated target object
 */
function deepMerge<T extends object>(target: T, source: object): T {
  const targetRecord = objectRecord(target);
  const sourceRecord = objectRecord(source);

  Object.keys(sourceRecord).forEach((key) => {
    if (key === 'fields' || key === 'args') {
      return;
    }

    const targetValue = getOwnValue(targetRecord, key);
    const sourceValue = getOwnValue(sourceRecord, key);

    if (
      targetValue &&
      sourceValue &&
      typeof targetValue === 'object' &&
      typeof sourceValue === 'object'
    ) {
      defineOwnValue(
        targetRecord,
        key,
        deepMerge(targetValue, sourceValue)
      );
    } else {
      defineOwnValue(targetRecord, key, sourceValue);
    }
  });

  const targetFields = getOwnValue(targetRecord, 'fields');
  const sourceFields = getOwnValue(sourceRecord, 'fields');

  if (targetFields && sourceFields) {
    defineOwnValue(
      targetRecord,
      'fields',
      deepMerge(targetFields as object, sourceFields as object)
    );
  } else if (targetFields || sourceFields) {
    defineOwnValue(targetRecord, 'fields', targetFields || sourceFields);
  }

  return target;
}

/**
 * Check whether resolver information contains named fragments.
 *
 * @param info resolver information available to the simplifier
 * @return whether at least one fragment is available
 */
function hasFragments(info: SimplifyInfo): boolean {
  return Boolean(info.fragments && Object.keys(info.fragments).length > 0);
}

/**
 * Find the fragment referenced by a fragment spread.
 *
 * @param info resolver information containing fragment definitions
 * @param ast GraphQL AST node that may refer to a fragment
 * @return the matching fragment definition, when present
 */
function getFragment(
  info: SimplifyInfo,
  ast: ASTNode
): FragmentDefinitionNode | undefined {
  if (
    !hasFragments(info) ||
    ast.kind !== Kind.FRAGMENT_SPREAD
  ) {
    return undefined;
  }

  return info.fragments
    ? getOwnValue(info.fragments, ast.name.value)
    : undefined;
}

/**
 * Read selections from AST nodes that support selection sets.
 *
 * @param ast GraphQL AST node to inspect
 * @return the node's selections, when it has a selection set
 */
function getSelections(ast: ASTNode): ReadonlyArray<SelectionNode> | undefined {
  switch (ast.kind) {
      case Kind.FIELD:
      case Kind.FRAGMENT_DEFINITION:
      case Kind.INLINE_FRAGMENT:
      case Kind.OPERATION_DEFINITION:
        return ast.selectionSet?.selections;
      default:
        return undefined;
  }
}

/**
 * Simplify an input object while preserving legacy scalar coercion behavior.
 *
 * @param objectValue GraphQL object value node to simplify
 * @return simplified object fields keyed by input name
 */
function simplifyObjectValue(
  objectValue: ObjectValueNode
): Record<string, unknown> {
  return objectValue.fields.reduce<Record<string, unknown>>((memo, field) => {
    let simplifiedValue: unknown;

    switch (field.value.kind) {
        case Kind.INT:
          simplifiedValue = parseInt(field.value.value, 10);
          break;
        case Kind.FLOAT:
          simplifiedValue = parseFloat(field.value.value);
          break;
        case Kind.OBJECT:
          simplifiedValue = simplifyObjectValue(field.value);
          break;
        case Kind.BOOLEAN:
        case Kind.ENUM:
        case Kind.STRING:
          simplifiedValue = field.value.value;
          break;
        case Kind.LIST:
        case Kind.NULL:
        case Kind.VARIABLE:
          simplifiedValue = undefined;
          break;
    }

    defineOwnValue(memo, field.name.value, simplifiedValue);

    return memo;
  }, {});
}

/**
 * Simplify a GraphQL argument value.
 *
 * @param value GraphQL value node to simplify
 * @param info resolver information used to resolve variables
 * @return the simplified argument value
 */
function simplifyValue(value: ValueNode, info: SimplifyInfo): unknown {
  switch (value.kind) {
      case Kind.LIST:
        return value.values.map((item) => simplifyValue(item, info));
      case Kind.BOOLEAN:
      case Kind.ENUM:
      case Kind.FLOAT:
      case Kind.INT:
      case Kind.STRING:
        return value.value;
      case Kind.OBJECT:
        return simplifyObjectValue(value);
      case Kind.VARIABLE: {
        const variableValues = normalizeVariableValues(info.variableValues);

        return getOwnValue(variableValues, value.name.value);
      }
      case Kind.NULL:
        return undefined;
  }
}

/**
 * Convert GraphQL AST selections into a recursively keyed object.
 *
 * @param ast GraphQL AST node collection to simplify
 * @param info partial resolver information containing fragments and variables
 * @param parent parent selection used to expose non-enumerable navigation
 * @return the merged root for the AST collection
 */
function simplifyAST(
  ast: ReadonlyArray<ASTNode>,
  info?: SimplifyInfo,
  parent?: SimplifiedAST
): SimplifiedASTCollection;
/**
 * Convert one GraphQL AST node into a recursively keyed object.
 *
 * @param ast GraphQL AST node to simplify
 * @param info partial resolver information containing fragments and variables
 * @param parent parent selection used to expose non-enumerable navigation
 * @return the simplified GraphQL selection tree
 */
function simplifyAST(
  ast: ASTNode,
  info?: SimplifyInfo,
  parent?: SimplifiedAST
): SimplifiedAST;
/**
 * Convert a GraphQL AST node or collection into its matching simplified shape.
 *
 * @param ast GraphQL AST node or node collection to simplify
 * @param info partial resolver information containing fragments and variables
 * @param parent parent selection used to expose non-enumerable navigation
 * @return a simplified node or merged collection root
 */
function simplifyAST(
  ast: ASTNode | ReadonlyArray<ASTNode>,
  info?: SimplifyInfo,
  parent?: SimplifiedAST
): SimplifiedAST | SimplifiedASTCollection;
function simplifyAST(
  ast: ASTNode | ReadonlyArray<ASTNode>,
  info?: SimplifyInfo,
  parent?: SimplifiedAST
): SimplifiedAST | SimplifiedASTCollection {
  const resolveInfo = info || {};

  if (Array.isArray(ast)) {
    return ast.reduce<SimplifiedASTCollection>(
      (simpleAST, node) => deepMerge(
        simpleAST,
        simplifyAST(node, resolveInfo)
      ),
      createCollection()
    );
  }

  const astNode = ast as ASTNode;
  const fragment = getFragment(resolveInfo, astNode);
  if (fragment) {
    return simplifyAST(fragment, resolveInfo);
  }

  const selections = getSelections(astNode);
  if (!selections) {
    return createSimplifiedAST();
  }

  return selections.reduce<SimplifiedAST>((simpleAST, selection) => {
    if (
      selection.kind === Kind.FRAGMENT_SPREAD ||
      selection.kind === Kind.INLINE_FRAGMENT
    ) {
      return deepMerge(
        simpleAST,
        simplifyAST(selection, resolveInfo)
      );
    }

    const name = selection.name.value;
    const alias = selection.alias?.value;
    const key = alias || name;

    let field = getOwnValue(simpleAST.fields, key) || createPlaceholder();
    defineOwnValue(simpleAST.fields, key, field);
    field = deepMerge(
      field,
      simplifyAST(selection, resolveInfo, field)
    );
    defineOwnValue(simpleAST.fields, key, field);

    if (alias) {
      field.key = name;
    }

    // GraphQL 17 omits `arguments` for fields without arguments, while older
    // releases supplied an empty array.
    field.args = (selection.arguments || []).reduce<Record<string, unknown>>(
      (args, argument) => {
        defineOwnValue(
          args,
          argument.name.value,
          simplifyValue(argument.value, resolveInfo)
        );

        return args;
      },
      {}
    );

    if (parent) {
      Object.defineProperty(
        field,
        '$parent',
        {value: parent, enumerable: false}
      );
    }

    return simpleAST;
  }, createSimplifiedAST());
}

export default simplifyAST;
