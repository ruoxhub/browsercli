import generateImport from '@babel/generator';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from './astUtils.js';
import {
  getPropertyKey,
  isSafeMemberReplacement,
  literalNodeFromValue,
  SandboxEvaluator,
} from './SandboxEvaluator.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

export type WrapperDescriptor =
  | {type: 'literal'; node: t.Expression}
  | {type: 'member'; objectName: string; key: string}
  | {type: 'binary'; operator: string}
  | {type: 'logical'; operator: string}
  | {type: 'unary'; operator: string; prefix: boolean}
  | {type: 'call'};

export interface WrapperFolderOptions {
  useSandbox?: boolean;
  sandbox?: Record<string, unknown>;
  evaluateComputedKeys?: boolean;
  timeoutMs?: number;
}

interface RemovableEntry {
  path: NodePath;
  objectName: string;
  propertyEntries: Array<{key: string; path: NodePath}>;
  removable: boolean;
}

type NodePath<T extends t.Node = t.Node> = import('@babel/traverse').NodePath<T>;

export class WrapperFolder {
  private resolvePropertyKey(
    node: t.Node,
    options?: WrapperFolderOptions,
  ): string | null {
    const directKey = getPropertyKey(node);
    if (directKey !== null) {
      return directKey;
    }

    if (!options?.sandbox) {
      return null;
    }

    const code = generate(node, {
      compact: true,
      comments: false,
      jsescOption: {minimal: true},
    }).code;
    const evaluator = new SandboxEvaluator();
    const result = evaluator.evaluateExpression(
      code,
      options.sandbox,
      options.timeoutMs ?? 500,
    );
    if (!result.ok) {
      return null;
    }

    if (typeof result.value === 'string' || typeof result.value === 'number') {
      return String(result.value);
    }

    return null;
  }

  private collectWrapperDescriptor(
    node: t.Node,
    wrapperMap: Record<string, Record<string, WrapperDescriptor>>,
    options?: WrapperFolderOptions,
  ): WrapperDescriptor | null {
    if (
      t.isStringLiteral(node) ||
      t.isNumericLiteral(node) ||
      t.isBooleanLiteral(node) ||
      t.isNullLiteral(node)
    ) {
      return {type: 'literal', node: t.cloneNode(node)};
    }
    if (t.isIdentifier(node, {name: 'undefined'})) {
      return {type: 'literal', node: t.identifier('undefined')};
    }

    if (
      t.isMemberExpression(node) &&
      t.isIdentifier(node.object)
    ) {
      const key = this.resolvePropertyKey(node.property, options);
      if (key !== null) {
        return {type: 'member', objectName: node.object.name, key};
      }
    }

    if (t.isFunctionExpression(node)) {
      const argument = getWrapperReturnArgument(node);
      if (!argument) {
        return null;
      }
      if (
        t.isBinaryExpression(argument) &&
        t.isIdentifier(argument.left) &&
        t.isIdentifier(argument.right)
      ) {
        return {type: 'binary', operator: argument.operator};
      }
      if (
        t.isLogicalExpression(argument) &&
        t.isIdentifier(argument.left) &&
        t.isIdentifier(argument.right)
      ) {
        return {type: 'logical', operator: argument.operator};
      }
      if (
        t.isUnaryExpression(argument) &&
        t.isIdentifier(argument.argument)
      ) {
        return {
          type: 'unary',
          operator: argument.operator,
          prefix: argument.prefix !== false,
        };
      }
      if (t.isCallExpression(argument) && t.isIdentifier(argument.callee)) {
        return {type: 'call'};
      }
      if (
        t.isCallExpression(argument) &&
        t.isMemberExpression(argument.callee) &&
        t.isIdentifier(argument.callee.object)
      ) {
        const key = this.resolvePropertyKey(argument.callee.property, options);
        if (key !== null) {
          return resolveDescriptor(wrapperMap, {
            type: 'member',
            objectName: argument.callee.object.name,
            key,
          });
        }
      }
    }

    return null;
  }

  collectWrapperObjects(
    ast: t.File,
    options?: WrapperFolderOptions,
  ): {
    wrapperMap: Record<string, Record<string, WrapperDescriptor>>;
    removableEntries: RemovableEntry[];
  } {
    const wrapperMap: Record<string, Record<string, WrapperDescriptor>> =
      Object.create(null);
    const removableEntries: RemovableEntry[] = [];

    traverse(ast, {
      'VariableDeclarator|AssignmentExpression': (path: NodePath) => {
        const idPath = path.isVariableDeclarator()
          ? (path.get('id') as NodePath)
          : (path.get('left') as NodePath);
        const valuePath = path.isVariableDeclarator()
          ? (path.get('init') as NodePath)
          : (path.get('right') as NodePath);

        if (!idPath.isIdentifier() || !valuePath.isObjectExpression()) {
          return;
        }

        const name = (idPath.node as t.Identifier).name;
        const collected: Record<string, WrapperDescriptor> =
          wrapperMap[name] || Object.create(null);
        let localChanged = false;
        let supportedPropertyCount = 0;
        let collectedPropertyCount = 0;
        const propertyEntries: Array<{key: string; path: NodePath}> = [];

        (valuePath.get('properties') as NodePath[]).forEach(propertyPath => {
          if (!propertyPath.isObjectProperty()) {
            return;
          }
          supportedPropertyCount += 1;
          const key = this.resolvePropertyKey(
            (propertyPath.node as t.ObjectProperty).key,
            options,
          );
          if (key === null) {
            return;
          }
          const descriptor = this.collectWrapperDescriptor(
            (propertyPath.node as t.ObjectProperty).value,
            wrapperMap,
            options,
          );
          if (descriptor) {
            collected[key] = descriptor;
            localChanged = true;
            collectedPropertyCount += 1;
            propertyEntries.push({key, path: propertyPath});
          }
        });

        if (localChanged) {
          wrapperMap[name] = collected;
          removableEntries.push({
            path,
            objectName: name,
            propertyEntries,
            removable:
              supportedPropertyCount > 0 &&
              supportedPropertyCount === collectedPropertyCount,
          });
        }
      },
    });

    return {wrapperMap, removableEntries};
  }

  applyWrapperObjects(
    ast: t.File,
    wrapperMap: Record<string, Record<string, WrapperDescriptor>>,
    options?: WrapperFolderOptions,
  ): boolean {
    let changed = false;

    traverse(ast, {
      CallExpression: (path: NodePath<t.CallExpression>) => {
        if (
          !(path.get('callee') as NodePath).isMemberExpression() ||
          !(path.get('callee.object') as NodePath).isIdentifier()
        ) {
          return;
        }

        const callee = path.node.callee as t.MemberExpression;
        const objectName = (callee.object as t.Identifier).name;
        const key = this.resolvePropertyKey(callee.property, options);
        const resolved = resolveDescriptor(wrapperMap, {
          type: 'member',
          objectName,
          key: key ?? '',
        });
        if (!resolved) {
          return;
        }

        const args = path.node.arguments.map(arg => t.cloneNode(arg));
        if (resolved.type === 'binary' && args.length >= 2) {
          path.replaceWith(t.binaryExpression(resolved.operator as t.BinaryExpression['operator'], args[0]! as t.Expression, args[1]! as t.Expression));
          changed = true;
        } else if (resolved.type === 'logical' && args.length >= 2) {
          path.replaceWith(t.logicalExpression(resolved.operator as t.LogicalExpression['operator'], args[0]! as t.Expression, args[1]! as t.Expression));
          changed = true;
        } else if (resolved.type === 'unary' && args.length >= 1) {
          path.replaceWith(
            t.unaryExpression(resolved.operator as t.UnaryExpression['operator'], args[0]! as t.Expression, resolved.prefix),
          );
          changed = true;
        } else if (resolved.type === 'call' && args.length >= 1) {
          path.replaceWith(t.callExpression(args[0]! as t.Expression, args.slice(1) as t.Expression[]));
          changed = true;
        }
      },
      MemberExpression: (path: NodePath<t.MemberExpression>) => {
        if (
          !(path.get('object') as NodePath).isIdentifier() ||
          !isSafeMemberReplacement(path)
        ) {
          return;
        }

        const objectName = (path.node.object as t.Identifier).name;
        const key = this.resolvePropertyKey(path.node.property, options);
        if (key === null) {
          return;
        }
        const resolved = resolveDescriptor(wrapperMap, {
          type: 'member',
          objectName,
          key,
        });
        if (!resolved || resolved.type !== 'literal') {
          return;
        }

        path.replaceWith(t.cloneNode(resolved.node));
        changed = true;
      },
    });

    return changed;
  }

  foldWrapperObjects(ast: t.File, options?: WrapperFolderOptions): boolean {
    const {wrapperMap, removableEntries} = this.collectWrapperObjects(
      ast,
      options,
    );
    const applied = this.applyWrapperObjects(ast, wrapperMap, options);
    let changed = applied;

    if (pruneResolvedWrapperProperties(ast, removableEntries, options)) {
      changed = true;
    }

    if (applied) {
      removableEntries.forEach(({path, removable}) => {
        if (removable && removeWrapperOwnerPath(path)) {
          changed = true;
        }
      });
    }

    if (pruneUnusedWrapperOwners(removableEntries)) {
      changed = true;
    }

    return changed;
  }

  inlineDispatchers(ast: t.File): boolean {
    let changed = false;
    const dispatcherMap: Record<
      string,
      Record<string, WrapperDescriptor>
    > = Object.create(null);
    const removableEntries: Array<{path: NodePath; removable: boolean}> = [];

    traverse(ast, {
      VariableDeclarator: (path: NodePath<t.VariableDeclarator>) => {
        if (
          !(path.get('id') as NodePath).isIdentifier() ||
          !(path.get('init') as NodePath).isObjectExpression()
        ) {
          return;
        }
        const name = (path.node.id as t.Identifier).name;
        const collected: Record<string, WrapperDescriptor> =
          dispatcherMap[name] || Object.create(null);
        let localChanged = false;
        let supportedPropertyCount = 0;
        let collectedPropertyCount = 0;

        ((path.get('init') as NodePath).get('properties') as NodePath[]).forEach(
          propertyPath => {
            if (!propertyPath.isObjectProperty()) {
              return;
            }
            supportedPropertyCount += 1;
            const keyNode = (propertyPath.node as t.ObjectProperty).key;
            const key = t.isIdentifier(keyNode)
              ? keyNode.name
              : (keyNode as t.StringLiteral | t.NumericLiteral).value;
            const value = collectDispatcherValue(
              (propertyPath.node as t.ObjectProperty).value,
              dispatcherMap,
            );
            if (value) {
              collected[String(key)] = value;
              localChanged = true;
              collectedPropertyCount += 1;
            }
          },
        );

        if (localChanged) {
          dispatcherMap[name] = collected;
          removableEntries.push({
            path,
            removable:
              supportedPropertyCount > 0 &&
              supportedPropertyCount === collectedPropertyCount,
          });
        }
      },
    });

    traverse(ast, {
      CallExpression: (path: NodePath<t.CallExpression>) => {
        if (!(path.get('callee') as NodePath).isMemberExpression()) {
          return;
        }
        const callee = path.node.callee as t.MemberExpression;
        if (!t.isIdentifier(callee.object)) {
          return;
        }
        const objectName = callee.object.name;
        const key = callee.computed
          ? (callee.property as t.StringLiteral | t.NumericLiteral).value
          : (callee.property as t.Identifier).name;
        const entry =
          dispatcherMap[objectName] && dispatcherMap[objectName][String(key)];
        if (!entry) {
          return;
        }
        const args = path.node.arguments.map(arg => t.cloneNode(arg));
        if (entry.type === 'binary' && args.length >= 2) {
          path.replaceWith(t.binaryExpression(entry.operator as t.BinaryExpression['operator'], args[0]! as t.Expression, args[1]! as t.Expression));
          changed = true;
        } else if (entry.type === 'logical' && args.length >= 2) {
          path.replaceWith(t.logicalExpression(entry.operator as t.LogicalExpression['operator'], args[0]! as t.Expression, args[1]! as t.Expression));
          changed = true;
        } else if (entry.type === 'call' && args.length >= 1) {
          path.replaceWith(t.callExpression(args[0]! as t.Expression, args.slice(1) as t.Expression[]));
          changed = true;
        }
      },
      MemberExpression: (path: NodePath<t.MemberExpression>) => {
        if (!(path.get('object') as NodePath).isIdentifier()) {
          return;
        }
        const objectName = (path.node.object as t.Identifier).name;
        const key = path.node.computed
          ? (path.node.property as t.StringLiteral | t.NumericLiteral).value
          : (path.node.property as t.Identifier).name;
        const entry =
          dispatcherMap[objectName] && dispatcherMap[objectName][String(key)];
        if (!entry) {
          return;
        }
        if (entry.type === 'literal') {
          path.replaceWith(t.cloneNode(entry.node));
          changed = true;
        }
      },
    });

    if (changed) {
      removableEntries.forEach(({path, removable}) => {
        if (removable && !(path as {removed?: boolean}).removed) {
          path.remove();
        }
      });
    }

    return changed;
  }
}

function collectDispatcherValue(
  node: t.Node,
  dispatcherMap: Record<string, Record<string, WrapperDescriptor>>,
): WrapperDescriptor | null {
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node)
  ) {
    return {type: 'literal', node: t.cloneNode(node)};
  }
  if (
    t.isMemberExpression(node) &&
    t.isIdentifier(node.object) &&
    !node.computed &&
    t.isIdentifier(node.property)
  ) {
    return {
      type: 'member',
      objectName: node.object.name,
      key: node.property.name,
    };
  }
  if (
    t.isFunctionExpression(node) &&
    node.body.body.length === 1 &&
    t.isReturnStatement(node.body.body[0]!)
  ) {
    const arg = node.body.body[0]!.argument;
    if (!arg) {
      return null;
    }
    if (
      t.isBinaryExpression(arg) &&
      t.isIdentifier(arg.left) &&
      t.isIdentifier(arg.right)
    ) {
      return {type: 'binary', operator: arg.operator};
    }
    if (
      t.isLogicalExpression(arg) &&
      t.isIdentifier(arg.left) &&
      t.isIdentifier(arg.right)
    ) {
      return {type: 'logical', operator: arg.operator};
    }
    if (t.isCallExpression(arg) && t.isIdentifier(arg.callee)) {
      return {type: 'call'};
    }
    if (
      t.isCallExpression(arg) &&
      t.isMemberExpression(arg.callee) &&
      t.isIdentifier(arg.callee.object) &&
      !arg.callee.computed &&
      t.isIdentifier(arg.callee.property)
    ) {
      const target =
        dispatcherMap[arg.callee.object.name]?.[arg.callee.property.name];
      if (
        target &&
        (target.type === 'binary' ||
          target.type === 'logical' ||
          target.type === 'call')
      ) {
        return target;
      }
    }
  }
  return null;
}

export function resolveDescriptor(
  wrapperMap: Record<string, Record<string, WrapperDescriptor>>,
  descriptor: WrapperDescriptor,
  seen?: Set<string>,
): WrapperDescriptor | null {
  if (!descriptor) {
    return null;
  }
  if (descriptor.type !== 'member') {
    return descriptor;
  }

  const token = `${descriptor.objectName}:${descriptor.key}`;
  const localSeen = seen ?? new Set<string>();
  if (localSeen.has(token)) {
    return null;
  }
  localSeen.add(token);

  const next =
    wrapperMap[descriptor.objectName]?.[descriptor.key];
  if (!next) {
    return null;
  }
  return resolveDescriptor(wrapperMap, next, localSeen) || next;
}

function getWrapperReturnArgument(
  fnNode: t.FunctionExpression,
): t.Expression | null {
  if (fnNode.body.body.length === 0) {
    return null;
  }

  const body = fnNode.body.body;
  const last = body[body.length - 1]!;
  if (!t.isReturnStatement(last) || !last.argument) {
    return null;
  }

  const referenced = collectReferencedIdentifierNames(last.argument);
  for (const stmt of body.slice(0, -1)) {
    if (!t.isVariableDeclaration(stmt) || stmt.kind !== 'var') {
      return null;
    }
    for (const declaration of stmt.declarations) {
      if (
        !t.isIdentifier(declaration.id) ||
        referenced.has(declaration.id.name) ||
        !isHarmlessWrapperPreludeInit(declaration.init)
      ) {
        return null;
      }
    }
  }

  return last.argument;
}

function isHarmlessWrapperPreludeInit(node: t.Node | null | undefined): boolean {
  return (
    node == null ||
    t.isIdentifier(node) ||
    t.isMemberExpression(node) ||
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node)
  );
}

function collectReferencedIdentifierNames(node: t.Node): Set<string> {
  const names = new Set<string>();
  if (!node) {
    return names;
  }

  traverse(t.file(t.program([t.expressionStatement(t.cloneNode(node) as t.Expression)])), {
    Identifier(path) {
      if ((path as NodePath).isReferencedIdentifier()) {
        names.add((path.node as t.Identifier).name);
      }
    },
  });

  return names;
}

function pruneResolvedWrapperProperties(
  ast: t.File,
  removableEntries: RemovableEntry[],
  options?: WrapperFolderOptions,
): boolean {
  if (removableEntries.length === 0) {
    return false;
  }

  const wrapperNames = new Set(removableEntries.map(e => e.objectName));
  const {liveKeys, unsafeObjects} = collectLiveWrapperPropertyUsage(
    ast,
    wrapperNames,
    options,
  );
  let changed = false;

  removableEntries.forEach(({path, objectName, propertyEntries, removable}) => {
    if (!path || !path.node || (path as {removed?: boolean}).removed || unsafeObjects.has(objectName)) {
      return;
    }

    propertyEntries.forEach(({key, path: propertyPath}) => {
      if (!propertyPath || !propertyPath.node || (propertyPath as {removed?: boolean}).removed) {
        return;
      }
      if (liveKeys.has(`${objectName}:${key}`)) {
        return;
      }
      propertyPath.remove();
      changed = true;
    });

    const valuePath = path.isVariableDeclarator()
      ? (path.get('init') as NodePath)
      : (path.get('right') as NodePath);
    if (!valuePath || !valuePath.node || !valuePath.isObjectExpression()) {
      return;
    }

    const remainingProperties = (valuePath.get('properties') as NodePath[]).length;
    if (remainingProperties > 0) {
      return;
    }

    if (removable || propertyEntries.length > 0) {
      if (removeWrapperOwnerPath(path)) {
        changed = true;
      }
    }
  });

  return changed;
}

function collectLiveWrapperPropertyUsage(
  ast: t.File,
  wrapperNames: Set<string>,
  options?: WrapperFolderOptions,
): {liveKeys: Set<string>; unsafeObjects: Set<string>} {
  const liveKeys = new Set<string>();
  const unsafeObjects = new Set<string>();
  const ignoreDynamicUsage = false;

  traverse(ast, {
    Identifier(path) {
      if (
        !(path as NodePath).isReferencedIdentifier() ||
        !wrapperNames.has((path.node as t.Identifier).name)
      ) {
        return;
      }

      const parent = path.parentPath;
      if (
        parent &&
        parent.isMemberExpression() &&
        path.key === 'object' &&
        (parent.get('object') as NodePath) === path
      ) {
        return;
      }

      unsafeObjects.add((path.node as t.Identifier).name);
    },
    MemberExpression(path) {
      if (!(path.get('object') as NodePath).isIdentifier()) {
        return;
      }

      const objectName = ((path.get('object') as NodePath).node as t.Identifier).name;
      if (!wrapperNames.has(objectName)) {
        return;
      }

      const key = getPropertyKey((path.node as t.MemberExpression).property);
      if (key === null || !isSafeMemberReplacement(path)) {
        if (!ignoreDynamicUsage) {
          unsafeObjects.add(objectName);
        }
        return;
      }

      liveKeys.add(`${objectName}:${key}`);
    },
  });

  return {liveKeys, unsafeObjects};
}

function removeWrapperOwnerPath(path: NodePath): boolean {
  if (!path || !path.node || (path as {removed?: boolean}).removed) {
    return false;
  }

  if (path.isVariableDeclarator()) {
    const declarationPath = path.parentPath;
    path.remove();
    if (
      declarationPath &&
      declarationPath.node &&
      (declarationPath.get('declarations') as NodePath[]).length === 0
    ) {
      declarationPath.remove();
    }
    return true;
  }

  if (path.isAssignmentExpression()) {
    if (path.parentPath?.isExpressionStatement()) {
      path.parentPath.remove();
    } else {
      path.remove();
    }
    return true;
  }

  path.remove();
  return true;
}

function getWrapperOwnerBinding(
  entry: RemovableEntry,
): ReturnType<NodePath['scope']['getBinding']> | null {
  if (!entry || !entry.path || !entry.path.node) {
    return null;
  }

  if (entry.path.isVariableDeclarator()) {
    const idPath = entry.path.get('id') as NodePath;
    return idPath.isIdentifier()
      ? entry.path.scope.getBinding((idPath.node as t.Identifier).name)
      : null;
  }

  if (entry.path.isAssignmentExpression()) {
    const leftPath = entry.path.get('left') as NodePath;
    return leftPath.isIdentifier()
      ? entry.path.scope.getBinding((leftPath.node as t.Identifier).name)
      : null;
  }

  return null;
}

function pruneUnusedWrapperOwners(removableEntries: RemovableEntry[]): boolean {
  let changed = false;

  removableEntries.forEach(entry => {
    if (
      !entry.removable ||
      !entry.path ||
      !entry.path.node ||
      (entry.path as {removed?: boolean}).removed
    ) {
      return;
    }

    const binding = getWrapperOwnerBinding(entry);
    if (!binding || binding.referencePaths.length !== 0) {
      return;
    }

    if (removeWrapperOwnerPath(entry.path)) {
      changed = true;
    }
  });

  return changed;
}
