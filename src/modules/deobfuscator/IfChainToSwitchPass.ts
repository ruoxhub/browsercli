import generateImport from '@babel/generator';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type NodePath<T extends t.Node = t.Node> = import('@babel/traverse').NodePath<T>;

function normalizeCode(node: t.Node): string {
  return generate(node, {
    compact: true,
    comments: false,
    jsescOption: {minimal: true},
  }).code;
}

interface CaseInfo {
  discriminant: t.Expression;
  caseValue: t.Expression;
}

function getCaseInfo(testNode: t.Node): CaseInfo | null {
  if (
    !t.isBinaryExpression(testNode) ||
    !['==', '==='].includes(testNode.operator)
  ) {
    return null;
  }

  const leftLiteral = t.isLiteral(testNode.left);
  const rightLiteral = t.isLiteral(testNode.right);
  if (leftLiteral === rightLiteral) {
    return null;
  }

  if (leftLiteral) {
    if (t.isPrivateName(testNode.right)) return null;
    return {discriminant: testNode.right as t.Expression, caseValue: testNode.left as t.Expression};
  }

  if (t.isPrivateName(testNode.left)) return null;
  return {discriminant: testNode.left as t.Expression, caseValue: testNode.right as t.Expression};
}

function toCaseStatements(node: t.Node | null | undefined): t.Statement[] {
  if (!node) {
    return [];
  }
  if (t.isBlockStatement(node)) {
    return node.body.map(stmt => t.cloneNode(stmt));
  }
  return [t.cloneNode(node) as t.Statement];
}

interface UnwrapResult {
  kind: 'empty' | 'if' | 'default';
  path: NodePath | null;
  node: t.Node | null;
}

function unwrapAlternate(path: NodePath | null): UnwrapResult {
  if (!path || !path.node) {
    return {kind: 'empty', path: null, node: null};
  }
  if (path.isIfStatement()) {
    return {kind: 'if', path, node: path.node};
  }
  if (path.isBlockStatement()) {
    const body = (path as NodePath<t.BlockStatement>).get('body') as NodePath[];
    if (body.length === 1 && body[0]!.isIfStatement()) {
      return {kind: 'if', path: body[0]!, node: body[0]!.node};
    }
    return {kind: 'default', path, node: path.node};
  }
  return {kind: 'default', path, node: path.node};
}

function isTerminalStatement(node: t.Node): boolean {
  return (
    t.isReturnStatement(node) ||
    t.isThrowStatement(node) ||
    t.isBreakStatement(node) ||
    t.isContinueStatement(node)
  );
}

interface IfChain {
  discriminant: t.Expression;
  cases: Array<{test: t.Expression; statements: t.Statement[]}>;
  defaultStatements: t.Statement[] | null;
}

function collectIfChain(path: NodePath<t.IfStatement>): IfChain | null {
  if (path.parentPath?.isIfStatement() && path.key === 'alternate') {
    return null;
  }

  let currentPath: NodePath | null = path;
  let discriminantCode: string | null = null;
  let discriminantNode: t.Expression | null = null;
  const cases: Array<{test: t.Expression; statements: t.Statement[]}> = [];
  let defaultStatements: t.Statement[] | null = null;

  while (currentPath && currentPath.isIfStatement()) {
    const info = getCaseInfo((currentPath.node as t.IfStatement).test);
    if (!info) {
      return null;
    }

    const currentCode = normalizeCode(info.discriminant);
    if (discriminantCode === null) {
      discriminantCode = currentCode;
      discriminantNode = t.cloneNode(info.discriminant);
    } else if (currentCode !== discriminantCode) {
      return null;
    }

    cases.push({
      test: t.cloneNode(info.caseValue),
      statements: toCaseStatements((currentPath.node as t.IfStatement).consequent),
    });

    const alternate = unwrapAlternate(
      (currentPath as NodePath<t.IfStatement>).get('alternate') as NodePath | null,
    );
    if (alternate.kind === 'empty') {
      break;
    }
    if (alternate.kind === 'if') {
      currentPath = alternate.path;
      continue;
    }
    defaultStatements = toCaseStatements(alternate.node);
    break;
  }

  if (cases.length < 2) {
    return null;
  }

  return {discriminant: discriminantNode!, cases, defaultStatements};
}

function buildSwitchStatementFromChain(chain: IfChain): t.SwitchStatement {
  const switchCases = chain.cases.map(entry => {
    const statements = entry.statements.slice();
    if (
      statements.length === 0 ||
      !isTerminalStatement(statements[statements.length - 1]!)
    ) {
      statements.push(t.breakStatement());
    }
    return t.switchCase(entry.test, statements);
  });

  if (chain.defaultStatements) {
    switchCases.push(t.switchCase(null, chain.defaultStatements));
  }

  return t.switchStatement(chain.discriminant, switchCases);
}

interface ConsecutiveIfRun {
  startIndex: number;
  endIndex: number;
  switchNode: t.SwitchStatement;
}

function collectConsecutiveIfCases(
  statementPaths: NodePath[],
  startIndex: number,
): ConsecutiveIfRun | null {
  const firstPath = statementPaths[startIndex];
  if (!firstPath || !firstPath.isIfStatement() || firstPath.node.alternate) {
    return null;
  }

  const firstInfo = getCaseInfo((firstPath.node as t.IfStatement).test);
  if (!firstInfo) {
    return null;
  }

  const discriminantCode = normalizeCode(firstInfo.discriminant);
  const cases: Array<{test: t.Expression; statements: t.Statement[]}> = [
    {
      test: t.cloneNode(firstInfo.caseValue),
      statements: toCaseStatements((firstPath.node as t.IfStatement).consequent),
    },
  ];

  let endIndex = startIndex + 1;
  while (endIndex < statementPaths.length) {
    const nextPath = statementPaths[endIndex]!;
    if (!nextPath.isIfStatement() || nextPath.node.alternate) {
      break;
    }

    const info = getCaseInfo((nextPath.node as t.IfStatement).test);
    if (!info || normalizeCode(info.discriminant) !== discriminantCode) {
      break;
    }

    cases.push({
      test: t.cloneNode(info.caseValue),
      statements: toCaseStatements((nextPath.node as t.IfStatement).consequent),
    });
    endIndex += 1;
  }

  if (cases.length < 2) {
    return null;
  }

  return {
    startIndex,
    endIndex,
    switchNode: buildSwitchStatementFromChain({
      discriminant: t.cloneNode(firstInfo.discriminant),
      cases,
      defaultStatements: null,
    }),
  };
}

function rewriteStatementList(
  statementPaths: NodePath[],
): t.Statement[] | null {
  if (!Array.isArray(statementPaths) || statementPaths.length < 2) {
    return null;
  }

  const nextBody: t.Statement[] = [];
  let changed = false;

  for (let index = 0; index < statementPaths.length; ) {
    const run = collectConsecutiveIfCases(statementPaths, index);
    if (!run) {
      nextBody.push(statementPaths[index]!.node as t.Statement);
      index += 1;
      continue;
    }

    nextBody.push(run.switchNode);
    index = run.endIndex;
    changed = true;
  }

  return changed ? nextBody : null;
}

export function ifChainToSwitch(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;

  traverse(ast, {
    IfStatement(path) {
      const chain = collectIfChain(path);
      if (!chain) {
        return;
      }

      path.replaceWith(buildSwitchStatementFromChain(chain));
      changed = true;
    },
    'Program|BlockStatement': {
      exit(path) {
        const nextBody = rewriteStatementList(
          (path.get('body') as NodePath[]),
        );
        if (nextBody) {
          (path.node as t.Program | t.BlockStatement).body = nextBody;
          changed = true;
        }
      },
    },
    SwitchCase: {
      exit(path) {
        const nextConsequent = rewriteStatementList(
          (path.get('consequent') as NodePath[]),
        );
        if (nextConsequent) {
          (path.node as t.SwitchCase).consequent = nextConsequent;
          changed = true;
        }
      },
    },
  });

  return {ast, changed};
}
