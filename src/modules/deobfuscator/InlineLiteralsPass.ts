/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from './astUtils.js';

const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type NodePath<T extends t.Node = t.Node> =
  import('@babel/traverse').NodePath<T>;

function isPrimitiveNode(node: t.Node | null | undefined): boolean {
  if (!node) return false;
  return (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isIdentifier(node, {name: 'undefined'})
  );
}

function getReplacementTarget(path: NodePath): NodePath {
  let current = path;
  while (current.parentPath?.isMemberExpression() && current.key === 'object') {
    current = current.parentPath;
  }
  return current;
}

function isUnsafeReplacementTarget(path: NodePath): boolean {
  const target = getReplacementTarget(path);
  if (target.parentPath?.isUpdateExpression() && target.key === 'argument') {
    return true;
  }
  if (
    (target.parentPath?.isAssignmentExpression() ||
      target.parentPath?.isAssignmentPattern()) &&
    target.key === 'left'
  ) {
    return true;
  }
  if (
    (target.parentPath?.isForInStatement() ||
      target.parentPath?.isForOfStatement()) &&
    target.key === 'left'
  ) {
    return true;
  }
  if (
    target.parentPath?.isUnaryExpression({operator: 'delete'}) &&
    target.key === 'argument'
  ) {
    return true;
  }
  if (
    target.parentPath?.isObjectProperty() &&
    target.key === 'key' &&
    !(target.parentPath.node as t.ObjectProperty).computed
  ) {
    return true;
  }
  return false;
}

function replaceSafely(path: NodePath, node: t.Node): boolean {
  if (isUnsafeReplacementTarget(path)) {
    return false;
  }
  path.replaceWith(node);
  return true;
}

function allRefsAfter(
  binding: ReturnType<NodePath['scope']['getBinding']>,
  position: number,
): boolean {
  if (!binding) return false;
  return binding.referencePaths.every(
    refPath =>
      typeof (refPath.node as {start?: number}).start !== 'number' ||
      (refPath.node as {start?: number}).start! > position,
  );
}

export function inlineLiterals(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;

  traverse(ast, {
    MemberExpression(path) {
      const obj = path.node.object;
      const prop = path.node.property;
      if (
        t.isArrayExpression(obj) &&
        obj.elements.length === 0 &&
        t.isArrayExpression(prop) &&
        prop.elements.length === 0
      ) {
        if (replaceSafely(path, t.identifier('undefined'))) {
          changed = true;
        }
      }
    },
    VariableDeclarator(path) {
      if (!(path.get('id') as NodePath).isIdentifier()) {
        return;
      }
      const name = (path.node.id as t.Identifier).name;
      const init = path.node.init;
      const binding = path.scope.getBinding(name);
      if (!binding) {
        return;
      }
      if (
        t.isStringLiteral(init) ||
        t.isNumericLiteral(init) ||
        t.isBooleanLiteral(init)
      ) {
        if (!binding.constant) {
          return;
        }
        let replacedAll = binding.referencePaths.length > 0;
        let replacedAny = false;
        binding.referencePaths.forEach(refPath => {
          if (!replaceSafely(refPath, t.cloneNode(init))) {
            replacedAll = false;
            return;
          }
          replacedAny = true;
        });
        if (replacedAny) {
          changed = true;
        }
        if (replacedAll) {
          path.remove();
        }
        return;
      }
      if (
        t.isSequenceExpression(init) &&
        init.expressions.length > 0 &&
        init.expressions.every(expr => t.isStringLiteral(expr))
      ) {
        (path.get('init') as NodePath).replaceWith(
          t.cloneNode(init.expressions[init.expressions.length - 1]!),
        );
        changed = true;
        return;
      }
      if (
        t.isArrayExpression(init) &&
        init.elements.length > 0 &&
        init.elements.every(el => el != null && isPrimitiveNode(el))
      ) {
        let replacedAll = binding.referencePaths.length > 0;
        let replacedCount = 0;
        binding.referencePaths.forEach(refPath => {
          const parent = refPath.parentPath;
          if (
            !parent?.isMemberExpression({object: refPath.node}) ||
            !(parent.get('property') as NodePath).isNumericLiteral()
          ) {
            replacedAll = false;
            return;
          }
          const index = (parent.node.property as t.NumericLiteral).value;
          if (!init.elements[index]) {
            replacedAll = false;
            return;
          }
          if (!replaceSafely(parent, t.cloneNode(init.elements[index]!))) {
            replacedAll = false;
            return;
          }
          replacedCount += 1;
          changed = true;
        });
        if (replacedAll && replacedCount > 0) {
          path.remove();
        }
      }
    },
    AssignmentExpression(path) {
      if (
        !(path.get('left') as NodePath).isIdentifier() ||
        path.node.operator !== '='
      ) {
        return;
      }
      if (!path.parentPath?.isExpressionStatement()) {
        return;
      }
      const binding = path.scope.getBinding(
        (path.node.left as t.Identifier).name,
      );
      if (!binding) {
        return;
      }
      if (
        typeof (path.node as {start?: number}).start === 'number' &&
        !allRefsAfter(binding, (path.node as {start: number}).start)
      ) {
        return;
      }
      const right = path.node.right;
      if (
        t.isStringLiteral(right) ||
        t.isNumericLiteral(right) ||
        t.isBooleanLiteral(right)
      ) {
        const rightClone = t.cloneNode(right);
        let replacedAll = binding.referencePaths.length > 0;
        let replacedAny = false;
        binding.referencePaths.forEach(refPath => {
          if (!replaceSafely(refPath, t.cloneNode(rightClone))) {
            replacedAll = false;
            return;
          }
          replacedAny = true;
        });
        if (replacedAny) {
          changed = true;
        }
        if (replacedAll) {
          path.remove();
        }
        return;
      }
      if (
        t.isArrayExpression(right) &&
        right.elements.every(el => el != null && isPrimitiveNode(el))
      ) {
        const elements = right.elements;
        let replacedAll = binding.referencePaths.length > 0;
        let replacedCount = 0;
        binding.referencePaths.forEach(refPath => {
          const parent = refPath.parentPath;
          if (
            !parent?.isMemberExpression({object: refPath.node}) ||
            !(parent.get('property') as NodePath).isNumericLiteral()
          ) {
            replacedAll = false;
            return;
          }
          const index = (parent.node.property as t.NumericLiteral).value;
          if (!elements[index]) {
            replacedAll = false;
            return;
          }
          if (!replaceSafely(parent, t.cloneNode(elements[index]!))) {
            replacedAll = false;
            return;
          }
          replacedCount += 1;
          changed = true;
        });
        if (replacedAll && replacedCount > 0) {
          path.remove();
        }
      }
    },
  });

  return {ast, changed};
}
