/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import generateImport from '@babel/generator';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from '../astUtils.js';
import {SandboxEvaluator} from '../SandboxEvaluator.js';
import type {SiteAdapter} from '../SiteAdapterRegistry.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type NodePath<T extends t.Node = t.Node> =
  import('@babel/traverse').NodePath<T>;

function generateCode(node: t.Node): string {
  return generate(node, {
    compact: true,
    comments: false,
    jsescOption: {minimal: true},
  }).code;
}

function unwrapTopLevelIife(ast: t.File): boolean {
  const first = ast.program.body[0];
  if (
    !first ||
    !t.isExpressionStatement(first) ||
    !t.isCallExpression(first.expression)
  ) {
    return false;
  }
  const callee = first.expression.callee;
  if (!t.isFunctionExpression(callee)) {
    return false;
  }
  ast.program.body = callee.body.body.map(
    node => t.cloneNode(node) as t.Statement,
  );
  return true;
}

function expandSequenceExpressions(ast: t.File): boolean {
  let changed = false;

  traverse(ast, {
    SequenceExpression(path) {
      if (path.parentPath!.isExpressionStatement()) {
        path.replaceWithMultiple(
          path.node.expressions.map(expr =>
            t.expressionStatement(t.cloneNode(expr)),
          ),
        );
        changed = true;
        return;
      }

      if (path.parentPath!.isReturnStatement()) {
        const expressions = path.node.expressions.map(expr =>
          t.cloneNode(expr),
        );
        const last = expressions.pop();
        if (!last) {
          return;
        }
        path.parentPath!.replaceWithMultiple([
          ...expressions.map(expr => t.expressionStatement(expr)),
          t.returnStatement(last),
        ]);
        changed = true;
        return;
      }

      if (path.parentPath!.isVariableDeclarator()) {
        const declaratorPath =
          path.parentPath as NodePath<t.VariableDeclarator>;
        const declarationPath = declaratorPath.parentPath;
        if (!declarationPath || !declarationPath.isVariableDeclaration()) {
          return;
        }

        const expressions = path.node.expressions.map(expr =>
          t.cloneNode(expr),
        );
        const last = expressions.pop();
        if (!last) {
          return;
        }

        const inserted: t.Statement[] = [
          ...expressions.map(expr => t.expressionStatement(expr)),
          t.variableDeclaration(
            (declarationPath.node as t.VariableDeclaration).kind,
            [t.variableDeclarator(t.cloneNode(declaratorPath.node.id), last)],
          ),
        ];

        declarationPath.insertAfter(inserted);
        declaratorPath.remove();
        if ((declarationPath.get('declarations') as NodePath[]).length === 0) {
          declarationPath.remove();
        }
        changed = true;
      }
    },
  });

  return changed;
}

function unwrapUnaryIifes(ast: t.File): boolean {
  let changed = false;

  traverse(ast, {
    UnaryExpression(path) {
      if (
        path.node.operator !== '!' ||
        !(path.get('argument') as NodePath).isCallExpression() ||
        (path.get('argument') as NodePath<t.CallExpression>).node.arguments
          .length !== 0 ||
        !(
          (path.get('argument') as NodePath<t.CallExpression>).get(
            'callee',
          ) as NodePath
        ).isFunctionExpression() ||
        (
          (path.get('argument') as NodePath<t.CallExpression>).get(
            'callee',
          ) as NodePath<t.FunctionExpression>
        ).node.params.length !== 0
      ) {
        return;
      }

      const bodyPath = (
        (path.get('argument') as NodePath<t.CallExpression>).get(
          'callee',
        ) as NodePath<t.FunctionExpression>
      ).get('body') as NodePath<t.BlockStatement>;

      path.replaceWithMultiple(
        bodyPath.node.body.map(node => t.cloneNode(node)),
      );
      changed = true;
    },
  });

  return changed;
}

function yidunDispatcherPass(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;
  const evaluator = new SandboxEvaluator();

  if (unwrapTopLevelIife(ast)) {
    changed = true;
  }

  if (expandSequenceExpressions(ast)) {
    changed = true;
  }

  if (unwrapUnaryIifes(ast)) {
    changed = true;
  }

  const body = ast.program.body;
  if (
    body.length >= 2 &&
    t.isFunctionDeclaration(body[1]!) &&
    body[1]!.id &&
    body[1]!.params.length === 2
  ) {
    const sandbox = evaluator.createSandbox();
    const decoderName = body[1]!.id!.name;

    if (
      evaluator.evaluateNodes(body.slice(0, 2), sandbox) &&
      typeof sandbox[decoderName] === 'function'
    ) {
      traverse(ast, {
        CallExpression(path) {
          if (
            !(path.get('callee') as NodePath).isIdentifier({
              name: decoderName,
            }) ||
            path.node.arguments.length !== 1 ||
            !(path.get('arguments.0') as NodePath).isNumericLiteral()
          ) {
            return;
          }
          const code = generateCode(path.node);
          const result = evaluator.evaluateExpression(code, sandbox);
          if (!result.ok) {
            return;
          }
          path.replaceWith(t.valueToNode(result.value));
          changed = true;
        },
      });

      ast.program.body = ast.program.body
        .slice(2)
        .map(node => t.cloneNode(node) as t.Statement);
      changed = true;
    }
  }

  traverse(ast, {
    VariableDeclaration(path) {
      if (
        path.node.declarations.length !== 5 ||
        !(path.get('declarations') as NodePath[]).every(declarationPath => {
          return (
            (declarationPath.get('init') as NodePath).isMemberExpression() &&
            (
              declarationPath.get('init.object') as NodePath
            ).isNewExpression() &&
            (declarationPath.get('init.property') as NodePath).isStringLiteral()
          );
        })
      ) {
        return;
      }

      const prev = path.getPrevSibling();
      const next1 = path.getNextSibling();
      const next2 = next1 ? next1.getNextSibling() : null;
      if (
        !prev ||
        !next1 ||
        !next2 ||
        !prev.node ||
        !next1.node ||
        !next2.node
      ) {
        return;
      }

      const sandbox = evaluator.createSandbox();
      if (
        !evaluator.evaluateNodes(
          [prev.node, path.node, next1.node, next2.node],
          sandbox,
        )
      ) {
        return;
      }

      const names: string[] = []
        .concat((next1.node as t.VariableDeclaration).declarations || [])
        .concat((next2.node as t.VariableDeclaration).declarations || [])
        .map(declaration => declaration.id)
        .filter((idNode): idNode is t.Identifier => t.isIdentifier(idNode))
        .map(idNode => idNode.name);

      names.forEach(name => {
        const binding = path.scope.getBinding(name);
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
          const code = generateCode(parent.node);
          const result = evaluator.evaluateExpression(code, sandbox);
          if (!result.ok) {
            return;
          }
          parent.replaceWith(t.valueToNode(result.value));
          changed = true;
        });
      });

      prev.remove();
      path.remove();
      next1.remove();
      next2.remove();
      changed = true;
    },
  });

  return {ast, changed};
}

export class YidunAdapter implements SiteAdapter {
  readonly patternId = 'yidun';
  readonly prePasses = [yidunDispatcherPass];
}
