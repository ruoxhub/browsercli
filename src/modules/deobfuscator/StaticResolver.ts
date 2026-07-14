/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {NodePath} from '@babel/traverse';
import type * as t from '@babel/types';

export const UNRESOLVED: unique symbol = Symbol('unresolved');
export type Unresolved = typeof UNRESOLVED;

export class StaticResolver {
  resolveStatic(path: NodePath, seenBindings?: Set<unknown>): unknown {
    if (!path || !path.node) {
      return UNRESOLVED;
    }

    if (
      path.isStringLiteral() ||
      path.isNumericLiteral() ||
      path.isBooleanLiteral()
    ) {
      return (
        path.node as t.StringLiteral | t.NumericLiteral | t.BooleanLiteral
      ).value;
    }
    if (path.isNullLiteral()) {
      return null;
    }
    if (
      path.isTemplateLiteral() &&
      (path.node as t.TemplateLiteral).expressions.length === 0
    ) {
      return (
        (path.node as t.TemplateLiteral).quasis[0]?.value.cooked ?? UNRESOLVED
      );
    }
    if (path.isIdentifier({name: 'undefined'})) {
      return undefined;
    }

    if (path.isArrayExpression()) {
      const values: unknown[] = [];
      for (const elementPath of path.get('elements') as NodePath[]) {
        if (!elementPath.node) {
          values.push(undefined);
          continue;
        }
        const value = this.resolveStatic(elementPath, seenBindings);
        if (value === UNRESOLVED) {
          return UNRESOLVED;
        }
        values.push(value);
      }
      return values;
    }

    if (path.isObjectExpression()) {
      const out: Record<string, unknown> = Object.create(null);
      for (const propPath of path.get('properties') as NodePath[]) {
        if (!propPath.isObjectProperty()) {
          return UNRESOLVED;
        }
        const keyPath = propPath.get('key') as NodePath;
        const key = (propPath.node as t.ObjectProperty).computed
          ? this.resolveStatic(keyPath, seenBindings)
          : keyPath.isIdentifier()
            ? (keyPath.node as t.Identifier).name
            : this.resolveStatic(keyPath, seenBindings);
        if (key === UNRESOLVED) {
          return UNRESOLVED;
        }
        const value = this.resolveStatic(
          propPath.get('value') as NodePath,
          seenBindings,
        );
        if (value === UNRESOLVED) {
          return UNRESOLVED;
        }
        out[String(key)] = value;
      }
      return out;
    }

    if (path.isIdentifier()) {
      const binding = path.scope.getBinding((path.node as t.Identifier).name);
      if (!binding || seenBindings?.has(binding)) {
        return UNRESOLVED;
      }
      const localSeen = seenBindings ?? new Set();
      localSeen.add(binding);

      let resolved: unknown = UNRESOLVED;
      if (
        binding.path.parentPath &&
        binding.path.parentPath.isVariableDeclarator()
      ) {
        resolved = this.resolveStatic(
          binding.path.parentPath.get('init') as NodePath,
          localSeen,
        );
      } else if (
        binding.kind === 'param' &&
        binding.path.parentPath &&
        binding.path.parentPath.isFunction()
      ) {
        const callPath = getResolvedFunctionCallPath(binding.path.parentPath);
        if (callPath && typeof binding.path.key === 'number') {
          resolved = this.resolveStatic(
            callPath.get(`arguments.${binding.path.key}`) as NodePath,
            localSeen,
          );
        }
      }

      localSeen.delete(binding);
      if (resolved !== UNRESOLVED) {
        return resolved;
      }
    }

    if (path.isMemberExpression()) {
      const memberNode = path.node as t.MemberExpression;
      const propertyValue = memberNode.computed
        ? this.resolveStatic(path.get('property') as NodePath, seenBindings)
        : (path.get('property') as NodePath).isIdentifier()
          ? ((path.get('property') as NodePath).node as t.Identifier).name
          : this.resolveStatic(path.get('property') as NodePath, seenBindings);
      if (propertyValue === UNRESOLVED) {
        return UNRESOLVED;
      }

      const directPropertyValue = this.resolveObjectPropertyFromBinding(
        path.get('object') as NodePath,
        propertyValue,
        seenBindings,
      );
      if (directPropertyValue !== UNRESOLVED) {
        return directPropertyValue;
      }

      const objectValue = this.resolveStatic(
        path.get('object') as NodePath,
        seenBindings,
      );
      if (objectValue === UNRESOLVED) {
        return UNRESOLVED;
      }
      if (Array.isArray(objectValue)) {
        const index = Number(propertyValue);
        return Number.isInteger(index) ? objectValue[index] : UNRESOLVED;
      }
      if (
        objectValue &&
        typeof objectValue === 'object' &&
        String(propertyValue) in (objectValue as Record<string, unknown>)
      ) {
        return (objectValue as Record<string, unknown>)[String(propertyValue)];
      }
      return UNRESOLVED;
    }

    if (
      path.isCallExpression() &&
      (path.get('callee') as NodePath).isMemberExpression()
    ) {
      const calleeProp = (path.get('callee') as NodePath).get(
        'property',
      ) as NodePath;
      const isSplit =
        calleeProp.isIdentifier({name: 'split'}) ||
        calleeProp.isStringLiteral({value: 'split'});
      if (isSplit && (path.get('arguments.0') as NodePath)?.isStringLiteral()) {
        const source = this.resolveStatic(
          (path.get('callee') as NodePath).get('object') as NodePath,
          seenBindings,
        );
        if (typeof source === 'string') {
          return source.split(
            ((path.get('arguments.0') as NodePath).node as t.StringLiteral)
              .value,
          );
        }
      }
    }

    try {
      const evaluated = path.evaluate();
      return evaluated.confident ? evaluated.value : UNRESOLVED;
    } catch {
      return UNRESOLVED;
    }
  }

  getLiteralValue(path: NodePath): string | number | null {
    const resolved = this.resolveStatic(path);
    if (typeof resolved === 'string' || typeof resolved === 'number') {
      return resolved;
    }
    return null;
  }

  resolveObjectPropertyFromBinding(
    objectPath: NodePath,
    propertyValue: unknown,
    seenBindings?: Set<unknown>,
  ): unknown {
    if (!objectPath || !objectPath.node || !objectPath.isIdentifier()) {
      return UNRESOLVED;
    }

    const binding = objectPath.scope.getBinding(
      (objectPath.node as t.Identifier).name,
    );
    if (!binding || seenBindings?.has(binding)) {
      return UNRESOLVED;
    }
    const localSeen = seenBindings ?? new Set();
    localSeen.add(binding);

    const declaratorPath = getDeclaratorForBinding(binding);
    if (!declaratorPath) {
      localSeen.delete(binding);
      return UNRESOLVED;
    }

    const initPath = declaratorPath.get('init') as NodePath;
    if (!initPath.node) {
      localSeen.delete(binding);
      return UNRESOLVED;
    }

    if (initPath.isIdentifier()) {
      const resolved = this.resolveObjectPropertyFromBinding(
        initPath,
        propertyValue,
        localSeen,
      );
      localSeen.delete(binding);
      return resolved;
    }

    if (!initPath.isObjectExpression()) {
      localSeen.delete(binding);
      return UNRESOLVED;
    }

    for (const propertyPath of initPath.get('properties') as NodePath[]) {
      if (!propertyPath.isObjectProperty()) {
        continue;
      }

      const keyPath = propertyPath.get('key') as NodePath;
      const propNode = propertyPath.node as t.ObjectProperty;
      const key = propNode.computed
        ? this.resolveStatic(keyPath, localSeen)
        : keyPath.isIdentifier()
          ? (keyPath.node as t.Identifier).name
          : this.resolveStatic(keyPath, localSeen);
      if (key === UNRESOLVED || String(key) !== String(propertyValue)) {
        continue;
      }

      const resolved = this.resolveStatic(
        propertyPath.get('value') as NodePath,
        localSeen,
      );
      localSeen.delete(binding);
      return resolved;
    }

    localSeen.delete(binding);
    return UNRESOLVED;
  }
}

function getResolvedFunctionCallPath(
  functionPath: NodePath,
): NodePath<t.CallExpression> | null {
  if (
    functionPath.parentPath?.isCallExpression() &&
    functionPath.parentKey === 'callee'
  ) {
    return functionPath.parentPath as NodePath<t.CallExpression>;
  }
  if (
    functionPath.parentPath?.isUnaryExpression() &&
    functionPath.parentPath.parentPath?.isCallExpression() &&
    functionPath.parentPath.parentKey === 'callee'
  ) {
    return functionPath.parentPath.parentPath as NodePath<t.CallExpression>;
  }
  return null;
}

function getDeclaratorForBinding(
  binding: ReturnType<NodePath['scope']['getBinding']>,
): NodePath<t.VariableDeclarator> | null {
  if (!binding || !binding.path) {
    return null;
  }
  if (binding.path.isVariableDeclarator()) {
    return binding.path as NodePath<t.VariableDeclarator>;
  }
  if (binding.path.parentPath?.isVariableDeclarator()) {
    return binding.path.parentPath as NodePath<t.VariableDeclarator>;
  }
  return null;
}
