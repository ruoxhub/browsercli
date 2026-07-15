/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import traverseImport from '@babel/traverse';
import type {NodePath as BabelNodePath} from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from '../astUtils.js';
import type {SiteAdapter} from '../SiteAdapterRegistry.js';

const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type NodePath<T extends t.Node = t.Node> = BabelNodePath<T>;

interface TopLevelIifeInfo {
  statementPath: NodePath;
  callPath: NodePath;
  calleePath: NodePath<t.FunctionExpression>;
  argPaths: NodePath[];
}

function getTopLevelIifeInfo(
  programPath: NodePath<t.Program>,
): TopLevelIifeInfo | null {
  const first = (programPath.get('body') as NodePath[])[0];
  if (!first || !first.isExpressionStatement()) {
    return null;
  }

  let exprPath = first.get('expression') as NodePath;
  if (exprPath.isUnaryExpression()) {
    exprPath = exprPath.get('argument') as NodePath;
  }
  if (!exprPath.isCallExpression()) {
    return null;
  }

  let calleePath = exprPath.get('callee') as NodePath;
  if (calleePath.isUnaryExpression()) {
    calleePath = calleePath.get('argument') as NodePath;
  }
  if (!calleePath.isFunctionExpression()) {
    return null;
  }

  return {
    statementPath: first,
    callPath: exprPath,
    calleePath: calleePath as NodePath<t.FunctionExpression>,
    argPaths: exprPath.get('arguments') as NodePath[],
  };
}

function dingxiangArrayPass(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;

  traverse(ast, {
    Program(programPath) {
      const info = getTopLevelIifeInfo(programPath);
      if (!info) {
        return;
      }

      const actualArgs = info.argPaths.map(argPath => argPath.node);
      const formalParams = info.calleePath.node.params;
      const paramElementMap: Record<string, t.Expression[]> =
        Object.create(null);

      formalParams.forEach((paramNode, index) => {
        if (!t.isIdentifier(paramNode)) {
          return;
        }
        const actualNode = actualArgs[index];
        if (t.isArrayExpression(actualNode)) {
          paramElementMap[paramNode.name] = actualNode.elements.map(element =>
            element
              ? (t.cloneNode(element) as t.Expression)
              : t.identifier('undefined'),
          );
        }
      });

      if (Object.keys(paramElementMap).length === 0) {
        return;
      }

      info.statementPath.traverse({
        UnaryExpression(path: NodePath<t.UnaryExpression>) {
          const callPath = path.get('argument') as NodePath;
          if (
            !callPath.isCallExpression() ||
            !(callPath.get('callee') as NodePath).isFunctionExpression() ||
            (callPath.node as t.CallExpression).arguments.length !== 2 ||
            !(callPath.get('arguments') as NodePath[]).every(argPath =>
              argPath.isArrayExpression(),
            )
          ) {
            return;
          }

          (callPath.get('callee.params') as NodePath[]).forEach(paramPath => {
            if (!paramPath.isIdentifier()) {
              return;
            }
            const elements =
              paramElementMap[(paramPath.node as t.Identifier).name];
            if (!elements) {
              return;
            }
            const binding = paramPath.scope.getBinding(
              (paramPath.node as t.Identifier).name,
            );
            if (!binding || !binding.constant) {
              return;
            }
            binding.referencePaths.forEach(refPath => {
              const parent = (refPath as NodePath).parentPath;
              if (
                !parent ||
                !parent.isMemberExpression({object: refPath.node}) ||
                !(parent.get('property') as NodePath).isNumericLiteral()
              ) {
                return;
              }
              const index = (parent.node as t.MemberExpression).property;
              if (!t.isNumericLiteral(index)) {
                return;
              }
              const idx = index.value;
              if (!Number.isInteger(idx) || idx < 0 || idx >= elements.length) {
                return;
              }
              parent.replaceWith(t.cloneNode(elements[idx]!));
              changed = true;
            });
          });

          const bodyPath = callPath.get(
            'callee.body',
          ) as NodePath<t.BlockStatement>;
          path.replaceWithMultiple(
            bodyPath.node.body.map(node => t.cloneNode(node)),
          );
          changed = true;
        },
      });
    },
  });

  return {ast, changed};
}

export class DingxiangAdapter implements SiteAdapter {
  readonly patternId = 'dingxiang';
  readonly prePasses = [dingxiangArrayPass];
}
