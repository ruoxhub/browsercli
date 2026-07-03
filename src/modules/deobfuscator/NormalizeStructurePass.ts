import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from './astUtils.js';

const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type NodePath<T extends t.Node = t.Node> = import('@babel/traverse').NodePath<T>;

function toStatements(expressions: t.Expression[]): t.ExpressionStatement[] {
  return expressions.map(expr => t.expressionStatement(expr));
}

function hasUnsafeContinue(bodyPath: NodePath<t.BlockStatement>): boolean {
  let found = false;
  bodyPath.traverse({
    Function(path) {
      path.skip();
    },
    ContinueStatement() {
      found = true;
    },
  });
  return found;
}

function ensureBlock(
  path: NodePath,
): NodePath<t.BlockStatement> {
  if (path.isBlockStatement()) {
    return path as NodePath<t.BlockStatement>;
  }
  path.replaceWith(t.blockStatement([path.node as t.Statement]));
  return path.parentPath.get(path.key as string) as NodePath<t.BlockStatement>;
}

function replaceStatement(path: NodePath, node: t.Statement): void {
  if ((path as {inList?: boolean}).inList) {
    path.replaceWith(node);
    return;
  }
  path.replaceWith(t.blockStatement([node]));
}

function replaceStatementWithStatements(
  path: NodePath,
  statements: t.Statement[],
): void {
  if (statements.length === 0) {
    path.remove();
    return;
  }
  if ((path as {inList?: boolean}).inList) {
    path.replaceWithMultiple(statements);
    return;
  }
  if (statements.length === 1) {
    path.replaceWith(statements[0]!);
    return;
  }
  path.replaceWith(t.blockStatement(statements));
}

export function normalizeStructure(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;

  traverse(ast, {
    UnaryExpression(path) {
      if (
        path.node.operator === 'void' &&
        path.parentPath?.isExpressionStatement()
      ) {
        path.replaceWith(path.node.argument);
        changed = true;
      }
    },
    SequenceExpression(path) {
      if (path.parentPath?.isExpressionStatement()) {
        replaceStatementWithStatements(
          path.parentPath,
          toStatements(path.node.expressions),
        );
        changed = true;
        return;
      }

      if (path.parentPath?.isReturnStatement()) {
        if (!(path.parentPath as {inList?: boolean}).inList) {
          return;
        }
        const exprs = path.node.expressions.slice();
        const returnExpr = exprs.pop()!;
        path.parentPath.insertBefore(toStatements(exprs));
        path.replaceWith(returnExpr);
        changed = true;
        return;
      }

      if (path.parentPath?.isIfStatement() && path.key === 'test') {
        if (!(path.parentPath as {inList?: boolean}).inList) {
          return;
        }
        const exprs = path.node.expressions.slice();
        const testExpr = exprs.pop()!;
        path.parentPath.insertBefore(toStatements(exprs));
        path.replaceWith(testExpr);
        changed = true;
        return;
      }

      if (path.parentPath?.isForStatement() && path.key === 'init') {
        if (!(path.parentPath as {inList?: boolean}).inList) {
          return;
        }
        path.parentPath.insertBefore(toStatements(path.node.expressions));
        path.remove();
        changed = true;
        return;
      }

      if (path.parentPath?.isForStatement() && path.key === 'test') {
        const exprs = path.node.expressions.slice();
        const testExpr = exprs.pop()!;
        const forPath = path.parentPath as NodePath<t.ForStatement>;
        const bodyPath = ensureBlock(forPath.get('body') as NodePath);
        bodyPath.unshiftContainer(
          'body',
          t.ifStatement(
            t.unaryExpression('!', testExpr, true),
            t.blockStatement([t.breakStatement()]),
          ),
        );
        bodyPath.unshiftContainer('body', toStatements(exprs));
        path.remove();
        changed = true;
        return;
      }

      if (path.parentPath?.isForStatement() && path.key === 'update') {
        const forPath = path.parentPath as NodePath<t.ForStatement>;
        const bodyPath = ensureBlock(forPath.get('body') as NodePath);
        if (hasUnsafeContinue(bodyPath)) {
          return;
        }
        bodyPath.pushContainer('body', toStatements(path.node.expressions));
        path.remove();
        changed = true;
      }
    },
    ConditionalExpression(path) {
      if (path.parentPath?.isExpressionStatement()) {
        replaceStatement(
          path.parentPath,
          t.ifStatement(
            path.node.test,
            t.blockStatement([t.expressionStatement(path.node.consequent)]),
            t.blockStatement([t.expressionStatement(path.node.alternate)]),
          ),
        );
        changed = true;
      }
    },
    LogicalExpression(path) {
      if (!path.parentPath?.isExpressionStatement()) {
        return;
      }
      const body = t.blockStatement([
        t.expressionStatement(path.node.right),
      ]);
      if (path.node.operator === '&&') {
        replaceStatement(path.parentPath, t.ifStatement(path.node.left, body));
      } else if (path.node.operator === '||') {
        replaceStatement(
          path.parentPath,
          t.ifStatement(t.unaryExpression('!', path.node.left, true), body),
        );
      } else {
        return;
      }
      changed = true;
    },
    AssignmentExpression(path) {
      if (
        !path.parentPath?.isExpressionStatement() ||
        !t.isConditionalExpression(path.node.right)
      ) {
        return;
      }
      const condExpr = path.node.right;
      const test = condExpr.test;
      const consequent = t.expressionStatement(
        t.assignmentExpression(
          path.node.operator,
          t.cloneNode(path.node.left, true),
          condExpr.consequent,
        ),
      );
      const alternate = t.expressionStatement(
        t.assignmentExpression(
          path.node.operator,
          t.cloneNode(path.node.left, true),
          condExpr.alternate,
        ),
      );
      replaceStatement(
        path.parentPath,
        t.ifStatement(
          test,
          t.blockStatement([consequent]),
          t.blockStatement([alternate]),
        ),
      );
      changed = true;
    },
    CallExpression(path) {
      if (!path.parentPath?.isExpressionStatement()) {
        return;
      }
      if (
        (path.get('callee') as NodePath).isFunctionExpression() &&
        path.node.arguments.length === 0
      ) {
        const fnBody = (path.node.callee as t.FunctionExpression).body.body;
        replaceStatementWithStatements(path.parentPath, fnBody);
        changed = true;
        return;
      }
      if (
        (path.get('callee') as NodePath).isMemberExpression() &&
        (path.get('callee.object') as NodePath).isFunctionExpression() &&
        (path.get('callee.property') as NodePath).isIdentifier({name: 'call'}) &&
        path.node.arguments.length === 1 &&
        (path.get('arguments.0') as NodePath)?.isThisExpression()
      ) {
        const fnBody = ((path.node.callee as t.MemberExpression)
          .object as t.FunctionExpression).body.body;
        replaceStatementWithStatements(path.parentPath, fnBody);
        changed = true;
      }
    },
    BlockStatement(path) {
      if (path.parentPath?.isSwitchCase()) {
        path.replaceWithMultiple(path.node.body);
        changed = true;
      }
    },
  });

  return {ast, changed};
}
