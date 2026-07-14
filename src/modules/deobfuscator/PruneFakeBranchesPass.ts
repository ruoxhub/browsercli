/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from './astUtils.js';

const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

function isLiteralLike(node: t.Node): boolean {
  return (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isIdentifier(node, {name: 'undefined'})
  );
}

function evaluateBinary(node: t.Node): boolean | null {
  if (
    !t.isBinaryExpression(node) ||
    !['==', '===', '!=', '!=='].includes(node.operator)
  ) {
    return null;
  }
  if (!isLiteralLike(node.left) || !isLiteralLike(node.right)) {
    return null;
  }
  const left = t.isIdentifier(node.left, {name: 'undefined'})
    ? undefined
    : (node.left as t.StringLiteral | t.NumericLiteral | t.BooleanLiteral)
        .value;
  const right = t.isIdentifier(node.right, {name: 'undefined'})
    ? undefined
    : (node.right as t.StringLiteral | t.NumericLiteral | t.BooleanLiteral)
        .value;
  switch (node.operator) {
    case '==':
      return left == right;
    case '===':
      return left === right;
    case '!=':
      return left != right;
    case '!==':
      return left !== right;
    default:
      return null;
  }
}

type NodePath<T extends t.Node = t.Node> =
  import('@babel/traverse').NodePath<T>;

function replaceStatement(
  path: NodePath<t.IfStatement>,
  node: t.Statement | null | undefined,
): void {
  if (!node) {
    path.remove();
    return;
  }
  if (t.isBlockStatement(node)) {
    path.replaceWithMultiple(node.body);
    return;
  }
  path.replaceWith(node);
}

export function pruneFakeBranches(ast: t.File): {
  ast: t.File;
  changed: boolean;
} {
  let changed = false;

  traverse(ast, {
    IfStatement: {
      exit(path) {
        let decision = evaluateBinary(path.node.test);
        if (decision === null) {
          const evaluated = (path.get('test') as NodePath).evaluate();
          if (evaluated.confident && typeof evaluated.value === 'boolean') {
            decision = evaluated.value;
          }
        }
        if (decision === null) {
          return;
        }
        replaceStatement(
          path,
          decision ? path.node.consequent : path.node.alternate,
        );
        changed = true;
      },
    },
    ConditionalExpression(path) {
      let decision = evaluateBinary(path.node.test);
      if (decision === null) {
        const evaluated = (path.get('test') as NodePath).evaluate();
        if (evaluated.confident && typeof evaluated.value === 'boolean') {
          decision = evaluated.value;
        }
      }
      if (decision === null) {
        return;
      }
      path.replaceWith(decision ? path.node.consequent : path.node.alternate);
      changed = true;
    },
  });

  return {ast, changed};
}
