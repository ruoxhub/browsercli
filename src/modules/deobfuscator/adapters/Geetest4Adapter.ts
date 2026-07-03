import generateImport from '@babel/generator';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from '../astUtils.js';
import {SandboxEvaluator} from '../SandboxEvaluator.js';
import type {SiteAdapter} from '../SiteAdapterRegistry.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type NodePath<T extends t.Node = t.Node> = import('@babel/traverse').NodePath<T>;

function generateCode(node: t.Node): string {
  return generate(node, {
    compact: true,
    comments: false,
    jsescOption: {minimal: true},
  }).code;
}

function geetest4GuardedPass(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;
  const body = ast.program.body;

  if (body.length < 5) {
    return {ast, changed};
  }

  const evaluator = new SandboxEvaluator();
  const sandbox = evaluator.createSandbox();

  const body2Expr =
    t.isExpressionStatement(body[2]!) &&
    t.isAssignmentExpression(body[2]!.expression)
      ? body[2]!.expression.left
      : null;
  const decriptPropName = body2Expr ? generateCode(body2Expr) : '';

  const body3Expr =
    t.isExpressionStatement(body[3]!) &&
    t.isAssignmentExpression(body[3]!.expression)
      ? body[3]!.expression.left
      : null;
  const ctrlVarName = body3Expr ? generateCode(body3Expr) : '';

  if (!decriptPropName || !evaluator.evaluateNodes(body.slice(0, 5), sandbox)) {
    return {ast, changed};
  }

  traverse(ast, {
    VariableDeclaration(path) {
      if (
        path.node.declarations.length !== 3 ||
        !((path.get('declarations') as NodePath[])[0]!.get('init') as NodePath).node ||
        generateCode(
          ((path.get('declarations') as NodePath[])[0]!.get('init') as NodePath).node!,
        ) !== decriptPropName
      ) {
        return;
      }

      const next1 = path.getNextSibling();
      const next2 = next1 ? next1.getNextSibling() : null;
      if (!next1 || !next2 || !next1.node || !next2.node) {
        return;
      }

      const candidateNames = [0, 2]
        .map(index => (path.get('declarations') as NodePath[])[index]!.get('id') as NodePath)
        .filter(idPath => idPath && idPath.isIdentifier())
        .map(idPath => (idPath.node as t.Identifier).name);

      candidateNames.forEach(name => {
        const binding = path.scope.getBinding(name);
        if (!binding) {
          return;
        }
        binding.referencePaths.forEach(refPath => {
          const parent = (refPath as NodePath).parentPath;
          if (
            !parent ||
            !parent.isCallExpression() ||
            (parent.node as t.CallExpression).arguments.length !== 1 ||
            !((parent.get('arguments') as NodePath[])[0] as NodePath).isNumericLiteral()
          ) {
            return;
          }
          const argValue = (
            (parent.node as t.CallExpression)
              .arguments[0] as t.NumericLiteral
          ).value;
          const result = evaluator.evaluateExpression(
            `${decriptPropName}(${argValue})`,
            sandbox,
          );
          if (!result.ok) {
            return;
          }
          parent.replaceWith(t.valueToNode(result.value));
          changed = true;
        });
      });

      path.remove();
      next1.remove();
      next2.remove();
      changed = true;
    },
    ForStatement(path) {
      if (
        path.node.init !== null ||
        path.node.update !== null ||
        !(path.get('test') as NodePath).isBinaryExpression() ||
        !generateCode(
          (path.get('test.right') as NodePath).node!,
        ).includes(ctrlVarName) ||
        !(path.get('body') as NodePath).isBlockStatement() ||
        ((path.get('body') as NodePath<t.BlockStatement>).get('body') as NodePath[]).length !== 1 ||
        !(((path.get('body') as NodePath<t.BlockStatement>).get('body') as NodePath[])[0] as NodePath).isSwitchStatement()
      ) {
        return;
      }

      const testNamePath = path.get('test.left') as NodePath;
      if (!testNamePath.isIdentifier()) {
        return;
      }

      const testName = (testNamePath.node as t.Identifier).name;
      const statements: t.Statement[] = [];

      const switchPath = ((path.get('body') as NodePath<t.BlockStatement>).get('body') as NodePath[])[0] as NodePath<t.SwitchStatement>;
      (switchPath.get('cases') as NodePath[]).forEach(casePath => {
        (casePath.get('consequent') as NodePath[]).forEach(stmtPath => {
          if (stmtPath.isBreakStatement()) {
            return;
          }
          if (
            stmtPath.isExpressionStatement() &&
            (stmtPath.get('expression') as NodePath).isAssignmentExpression() &&
            (stmtPath.get('expression.left') as NodePath).isIdentifier({
              name: testName,
            })
          ) {
            return;
          }
          statements.push(t.cloneNode(stmtPath.node) as t.Statement);
        });
      });

      if (statements.length > 0) {
        path.replaceWithMultiple(statements);
        const prev = path.getPrevSibling();
        if (prev && prev.node) {
          prev.remove();
        }
        changed = true;
      }
    },
  });

  return {ast, changed};
}

export class Geetest4Adapter implements SiteAdapter {
  readonly patternId = 'geetest4';
  readonly postPasses = [geetest4GuardedPass];
}
