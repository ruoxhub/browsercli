/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import generateImport from '@babel/generator';
import type {NodePath as BabelNodePath} from '@babel/traverse';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from './astUtils.js';
import {StaticResolver} from './StaticResolver.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type NodePath<T extends t.Node = t.Node> = BabelNodePath<T>;

// StaticResolver is stateless — safe to share across iterations and passes.
const resolver = new StaticResolver();

function getCaseStatements(casePath: NodePath<t.SwitchCase>): t.Statement[] {
  return (casePath.get('consequent') as NodePath[])
    .filter(stmt => !stmt.isContinueStatement() && !stmt.isBreakStatement())
    .map(stmt => t.cloneNode(stmt.node) as t.Statement);
}

function hasLexicalBindings(nodes: t.Node[]): boolean {
  return nodes.some(
    node => t.isVariableDeclaration(node) && node.kind !== 'var',
  );
}

function isSimpleDiscriminant(node: t.Node): boolean {
  return t.isIdentifier(node) || t.isLiteral(node);
}

function normalizeCaseConsequent(nodes: t.Node[]): t.Statement[] | null {
  const statements = nodes.map(node => t.cloneNode(node) as t.Statement);
  if (statements.length === 0) {
    return [t.continueStatement()];
  }

  const last = statements[statements.length - 1]!;
  if (t.isBreakStatement(last)) {
    statements.pop();
    statements.push(t.continueStatement());
    return statements;
  }
  if (
    t.isContinueStatement(last) ||
    t.isReturnStatement(last) ||
    t.isThrowStatement(last)
  ) {
    return statements;
  }

  return null;
}

function buildIfChainFromSwitch(
  switchNode: t.SwitchStatement,
): t.IfStatement | null {
  if (!isSimpleDiscriminant(switchNode.discriminant)) {
    return null;
  }

  let root: t.IfStatement | null = null;
  let current: t.IfStatement | null = null;
  let defaultBlock: t.BlockStatement | null = null;

  for (const caseNode of switchNode.cases) {
    const normalized = normalizeCaseConsequent(caseNode.consequent);
    if (!normalized || hasLexicalBindings(normalized)) {
      return null;
    }

    if (caseNode.test === null) {
      defaultBlock = t.blockStatement(normalized);
      continue;
    }

    const test = t.binaryExpression(
      '===',
      t.cloneNode(switchNode.discriminant),
      t.cloneNode(caseNode.test),
    );
    const nextIf = t.ifStatement(test, t.blockStatement(normalized));

    if (!root) {
      root = nextIf;
    } else {
      current!.alternate = nextIf;
    }
    current = nextIf;
  }

  if (!root) {
    return null;
  }
  if (current && defaultBlock) {
    current.alternate = defaultBlock;
  }
  return root;
}

function replaceLoopSwitchWithIf(path: NodePath): boolean {
  const body = path.get('body') as NodePath;
  if (!body.isBlockStatement()) {
    return false;
  }

  const statements = (body as NodePath<t.BlockStatement>).get(
    'body',
  ) as NodePath[];
  if (statements.length !== 1 || !statements[0]!.isSwitchStatement()) {
    return false;
  }

  const ifChain = buildIfChainFromSwitch(
    statements[0]!.node as t.SwitchStatement,
  );
  if (!ifChain) {
    return false;
  }

  body.replaceWith(t.blockStatement([ifChain]));
  return true;
}

function normalizeKey(node: t.Node): string {
  return generate(node, {
    compact: true,
    comments: false,
    jsescOption: {minimal: true},
  }).code;
}

function getCaseKey(casePath: NodePath<t.SwitchCase>): string | number {
  const value = resolver.getLiteralValue(casePath.get('test') as NodePath);
  return value === null
    ? normalizeKey((casePath.node as t.SwitchCase).test!)
    : value;
}

function getOrderFromInit(initPath: NodePath): Array<string | number> | null {
  if (initPath.isArrayExpression()) {
    const values: Array<string | number> = [];
    for (const elementPath of initPath.get('elements') as NodePath[]) {
      if (!elementPath.node) {
        return null;
      }
      const value = resolver.getLiteralValue(elementPath);
      values.push(value === null ? normalizeKey(elementPath.node) : value);
    }
    return values;
  }

  if (
    initPath.isCallExpression() &&
    (initPath.get('callee') as NodePath).isMemberExpression()
  ) {
    const calleeProp = (initPath.get('callee') as NodePath).get(
      'property',
    ) as NodePath;
    const isSplit =
      calleeProp.isIdentifier({name: 'split'}) ||
      calleeProp.isStringLiteral({value: 'split'});
    if (
      isSplit &&
      (initPath.get('arguments.0') as NodePath)?.isStringLiteral()
    ) {
      const source = resolver.getLiteralValue(
        (initPath.get('callee') as NodePath).get('object') as NodePath,
      );
      if (typeof source === 'string') {
        return source.split(
          ((initPath.get('arguments.0') as NodePath).node as t.StringLiteral)
            .value,
        );
      }
    }
  }

  return null;
}

function getOrderFromResolvedValue(
  value: unknown,
): Array<string | number> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const order: Array<string | number> = [];
  for (const item of value) {
    if (typeof item === 'string' || typeof item === 'number') {
      order.push(item);
      continue;
    }
    return null;
  }
  return order;
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

function getOrderFromBinding(
  binding: ReturnType<NodePath['scope']['getBinding']>,
): Array<string | number> | null {
  const declaratorPath = getDeclaratorForBinding(binding);
  if (!declaratorPath) {
    return null;
  }

  const initPath = declaratorPath.get('init') as NodePath;
  if (!initPath.node) {
    return null;
  }

  return (
    getOrderFromInit(initPath) ||
    getOrderFromResolvedValue(resolver.resolveStatic(initPath))
  );
}

function getStaticPropertyKey(node: t.Node): string | null {
  if (t.isIdentifier(node)) {
    return node.name;
  }
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) {
    return String(node.value);
  }
  return null;
}

function splitPipeString(value: unknown): string[] | null {
  if (typeof value !== 'string' || !value.includes('|')) {
    return null;
  }
  const parts = value.split('|');
  return parts.length > 1 ? parts : null;
}

function getPipeOrderFromValuePath(valuePath: NodePath): string[] | null {
  if (!valuePath || !valuePath.node) {
    return null;
  }

  if (valuePath.isStringLiteral()) {
    return splitPipeString((valuePath.node as t.StringLiteral).value);
  }

  const resolved = resolver.resolveStatic(valuePath);
  return splitPipeString(resolved);
}

interface PipeCandidate {
  key: string | null;
  order: string[];
  start: number;
}

function resolveObjectAliasNames(
  loopPath: NodePath,
  objectName: string,
): Set<string> {
  const names = new Set<string>();
  let currentName: string | undefined = objectName;

  while (currentName) {
    if (names.has(currentName)) {
      break;
    }
    names.add(currentName);

    const binding = loopPath.scope.getBinding(currentName);
    const declaratorPath = getDeclaratorForBinding(binding);
    if (
      !declaratorPath ||
      !(declaratorPath.get('init') as NodePath).isIdentifier()
    ) {
      break;
    }

    currentName = (
      (declaratorPath.get('init') as NodePath).node as t.Identifier
    ).name;
  }

  return names;
}

function getAncestorBodyStatements(loopPath: NodePath): NodePath[][] {
  const bodies: NodePath[][] = [];
  const seen = new Set<string>();
  let current: NodePath | null = loopPath;

  while (current) {
    if (current.isProgram()) {
      const key = `program:${(current.node as {start?: number}).start || 0}`;
      if (!seen.has(key)) {
        bodies.push(current.get('body') as NodePath[]);
        seen.add(key);
      }
    } else if (
      current.isBlockStatement() &&
      Array.isArray((current.node as t.BlockStatement).body)
    ) {
      const key = `block:${(current.node as {start?: number}).start || 0}`;
      if (!seen.has(key)) {
        bodies.push(current.get('body') as NodePath[]);
        seen.add(key);
      }
    }
    current = current.parentPath ?? null;
  }

  return bodies;
}

function collectObjectPipeStringCandidates(
  loopPath: NodePath,
  objectName: string,
): PipeCandidate[] {
  if (!objectName) {
    return [];
  }

  const objectNames = resolveObjectAliasNames(loopPath, objectName);
  const candidates: PipeCandidate[] = [];
  const loopStart = (loopPath.node as {start?: number}).start || 0;

  getAncestorBodyStatements(loopPath).forEach(statements => {
    statements.forEach(stmtPath => {
      if (
        !stmtPath.node ||
        ((stmtPath.node as {start?: number}).start || 0) >= loopStart
      ) {
        return;
      }

      if (stmtPath.isVariableDeclaration()) {
        (stmtPath.get('declarations') as NodePath[]).forEach(declPath => {
          if (
            !(declPath.get('id') as NodePath).isIdentifier() ||
            !objectNames.has(
              ((declPath.get('id') as NodePath).node as t.Identifier).name,
            ) ||
            !(declPath.get('init') as NodePath).isObjectExpression()
          ) {
            return;
          }
          (
            (declPath.get('init') as NodePath).get('properties') as NodePath[]
          ).forEach(propPath => {
            if (!propPath.isObjectProperty()) {
              return;
            }
            const keyNode = (propPath.node as t.ObjectProperty).key;
            const key = getStaticPropertyKey(keyNode);
            const valuePath = propPath.get('value') as NodePath;
            const pipeOrder = getPipeOrderFromValuePath(valuePath);
            if (pipeOrder) {
              candidates.push({
                key,
                order: pipeOrder,
                start: (stmtPath.node as {start?: number}).start || 0,
              });
            }
          });
        });
        return;
      }

      if (!stmtPath.isExpressionStatement()) {
        return;
      }

      const exprPath = (stmtPath as NodePath<t.ExpressionStatement>).get(
        'expression',
      ) as NodePath;
      if (!exprPath.isAssignmentExpression({operator: '='})) {
        return;
      }

      const leftPath = exprPath.get('left') as NodePath;
      const rightPath = exprPath.get('right') as NodePath;
      if (
        !leftPath.isMemberExpression() ||
        !(leftPath.get('object') as NodePath).isIdentifier() ||
        !objectNames.has(
          ((leftPath.get('object') as NodePath).node as t.Identifier).name,
        )
      ) {
        return;
      }

      const memberNode = leftPath.node as t.MemberExpression;
      const key = getStaticPropertyKey(memberNode.property);
      if (key === null) {
        return;
      }

      const pipeOrder = getPipeOrderFromValuePath(rightPath);
      if (pipeOrder) {
        candidates.push({
          key,
          order: pipeOrder,
          start: (stmtPath.node as {start?: number}).start || 0,
        });
      }
    });
  });

  candidates.sort((a, b) => b.start - a.start);
  return candidates;
}

function getOrderFromSplitCallWithObjectTable(
  initPath: NodePath,
  loopPath: NodePath,
): Array<string | number> | null {
  if (
    !initPath.isCallExpression() ||
    !(initPath.get('callee') as NodePath).isMemberExpression()
  ) {
    return null;
  }

  const calleeProp = (initPath.get('callee') as NodePath).get(
    'property',
  ) as NodePath;
  const isSplit =
    calleeProp.isIdentifier({name: 'split'}) ||
    calleeProp.isStringLiteral({value: 'split'});
  if (
    !isSplit ||
    !(initPath.get('arguments.0') as NodePath)?.isStringLiteral()
  ) {
    return null;
  }

  const sourcePath = (initPath.get('callee') as NodePath).get(
    'object',
  ) as NodePath;
  if (
    !sourcePath.isMemberExpression() ||
    !(sourcePath.get('object') as NodePath).isIdentifier()
  ) {
    return null;
  }

  const objectName = (
    (sourcePath.get('object') as NodePath).node as t.Identifier
  ).name;
  const propertyKey = getStaticPropertyKey(
    (sourcePath.node as t.MemberExpression).property,
  );
  if (propertyKey === null) {
    return null;
  }

  const match = collectObjectPipeStringCandidates(loopPath, objectName).find(
    candidate => candidate.key === propertyKey,
  );
  return match ? match.order : null;
}

function getOrderFromDiscriminant(
  discriminantPath: NodePath,
): Array<string | number> | null {
  if (!discriminantPath.isMemberExpression()) {
    return null;
  }

  const objectPath = discriminantPath.get('object') as NodePath;
  const directOrder = getOrderFromResolvedValue(
    resolver.resolveStatic(objectPath),
  );
  if (directOrder) {
    return directOrder;
  }

  if (!objectPath.isIdentifier()) {
    return null;
  }

  const binding = objectPath.scope.getBinding(
    (objectPath.node as t.Identifier).name,
  );
  return getOrderFromBinding(binding);
}

function findNearbyOrderDeclaration(
  loopPath: NodePath,
  maxSiblings = 3,
): {order: Array<string | number>; declarationPath: NodePath} | null {
  let siblingPath: NodePath | null =
    loopPath.getPrevSibling() as NodePath | null;
  for (
    let seen = 0;
    siblingPath && siblingPath.node && seen < maxSiblings;
    seen += 1
  ) {
    if (!siblingPath.isVariableDeclaration()) {
      break;
    }

    for (const declaratorPath of (
      siblingPath as NodePath<t.VariableDeclaration>
    ).get('declarations') as NodePath[]) {
      if (
        !declaratorPath.node ||
        !(declaratorPath.get('init') as NodePath).node
      ) {
        continue;
      }
      const initPath = declaratorPath.get('init') as NodePath;
      const order =
        getOrderFromInit(initPath) ||
        getOrderFromSplitCallWithObjectTable(initPath, loopPath) ||
        getOrderFromResolvedValue(resolver.resolveStatic(initPath));
      if (order) {
        return {order, declarationPath: siblingPath};
      }
    }

    siblingPath = siblingPath.getPrevSibling() as NodePath | null;
  }

  return null;
}

function getCaseKeys(
  switchStmt: NodePath<t.SwitchStatement>,
): Array<string | number> {
  const keys: Array<string | number> = [];
  (switchStmt.get('cases') as Array<NodePath<t.SwitchCase>>).forEach(
    casePath => {
      if (!(casePath.node as t.SwitchCase).test) {
        return;
      }
      keys.push(getCaseKey(casePath));
    },
  );
  return keys;
}

function sameSequenceKeySet(
  order: Array<string | number>,
  caseKeys: Array<string | number>,
): boolean {
  if (!order || order.length !== caseKeys.length) {
    return false;
  }

  const counts = new Map<string, number>();
  caseKeys.forEach(key =>
    counts.set(String(key), (counts.get(String(key)) || 0) + 1),
  );
  for (const item of order) {
    const key = String(item);
    const count = counts.get(key);
    if (!count) {
      return false;
    }
    if (count === 1) {
      counts.delete(key);
    } else {
      counts.set(key, count - 1);
    }
  }
  return counts.size === 0;
}

function getOrderFromObjectStringTable(
  loopPath: NodePath,
  switchStmt: NodePath<t.SwitchStatement>,
): Array<string | number> | null {
  const discriminant = switchStmt.get('discriminant') as NodePath;
  if (
    !discriminant.isMemberExpression() ||
    !(discriminant.get('object') as NodePath).isIdentifier()
  ) {
    return null;
  }

  const candidates = collectObjectPipeStringCandidates(
    loopPath,
    ((discriminant.get('object') as NodePath).node as t.Identifier).name,
  );
  if (candidates.length === 0) {
    return null;
  }

  const caseKeys = getCaseKeys(switchStmt);
  const match = candidates.find(candidate =>
    sameSequenceKeySet(candidate.order, caseKeys),
  );
  return match ? match.order : null;
}

function buildBlocksFromSwitchOrder(
  switchStmt: NodePath<t.SwitchStatement>,
  order: Array<string | number> | null,
): t.Statement[] | null {
  if (!order) {
    return null;
  }

  const caseMap = new Map<string | number, t.Statement[]>();
  (switchStmt.get('cases') as Array<NodePath<t.SwitchCase>>).forEach(
    casePath => {
      if (!(casePath.node as t.SwitchCase).test) {
        return;
      }
      caseMap.set(getCaseKey(casePath), getCaseStatements(casePath));
    },
  );

  const blocks: t.Statement[] = [];
  order.forEach(key => {
    const stmts = caseMap.get(key);
    if (stmts) {
      blocks.push(...stmts);
    }
  });

  return blocks.length > 0 ? blocks : null;
}

export function enhancedControlFlow(ast: t.File): {
  ast: t.File;
  changed: boolean;
} {
  let changed = false;

  traverse(ast, {
    ForStatement(path) {
      const body = path.get('body') as NodePath;
      if (!body.isBlockStatement()) {
        return;
      }
      const bodyStmts = (body as NodePath<t.BlockStatement>).get(
        'body',
      ) as NodePath[];
      if (bodyStmts.length === 0) {
        return;
      }
      const firstStmt = bodyStmts[0]!;
      if (
        firstStmt.isSwitchStatement() &&
        (path.get('init') as NodePath).isVariableDeclaration() &&
        path.node.update === null
      ) {
        let order: Array<string | number> | null = null;
        const leftovers: t.Statement[] = [];
        (
          (path.get('init') as NodePath<t.VariableDeclaration>).get(
            'declarations',
          ) as NodePath[]
        ).forEach(decl => {
          const declarator = decl as NodePath<t.VariableDeclarator>;
          if (declarator.node.init === null) {
            leftovers.push(
              t.variableDeclaration('var', [
                t.cloneNode(declarator.node) as t.VariableDeclarator,
              ]),
            );
            return;
          }
          const initPath = declarator.get('init') as NodePath;
          const candidate =
            getOrderFromInit(initPath) ||
            getOrderFromSplitCallWithObjectTable(initPath, path) ||
            getOrderFromResolvedValue(resolver.resolveStatic(initPath));
          if (candidate) {
            order = candidate;
          }
        });
        if (order) {
          const caseMap = new Map<string | number, t.Statement[]>();
          (firstStmt.get('cases') as Array<NodePath<t.SwitchCase>>).forEach(
            casePath => {
              if (!(casePath.node as t.SwitchCase).test) {
                return;
              }
              caseMap.set(getCaseKey(casePath), getCaseStatements(casePath));
            },
          );
          const blocks: t.Statement[] = [...leftovers];
          order.forEach(key => {
            const stmts = caseMap.get(key);
            if (stmts) {
              blocks.push(...stmts);
            }
          });
          if (blocks.length > 0) {
            path.replaceWithMultiple(blocks);
            changed = true;
            return;
          }
        }
      }

      if (replaceLoopSwitchWithIf(path)) {
        changed = true;
      }
    },
    WhileStatement(path) {
      if (
        (path.get('test') as NodePath).isUnaryExpression() &&
        (path.get('body') as NodePath).isBlockStatement()
      ) {
        const switchStmt = (
          (path.get('body') as NodePath<t.BlockStatement>).get(
            'body',
          ) as NodePath[]
        )[0] as NodePath | undefined;
        if (switchStmt?.isSwitchStatement()) {
          const nearby = findNearbyOrderDeclaration(path);
          const order =
            (nearby && nearby.order) ||
            getOrderFromDiscriminant(
              switchStmt.get('discriminant') as NodePath,
            ) ||
            getOrderFromObjectStringTable(
              path,
              switchStmt as NodePath<t.SwitchStatement>,
            );
          const blocks = buildBlocksFromSwitchOrder(
            switchStmt as NodePath<t.SwitchStatement>,
            order,
          );
          if (blocks) {
            path.replaceWithMultiple(blocks);
            if (
              nearby &&
              nearby.declarationPath &&
              nearby.declarationPath.node
            ) {
              nearby.declarationPath.remove();
            }
            changed = true;
            return;
          }
        }
      }

      if (replaceLoopSwitchWithIf(path)) {
        changed = true;
      }
    },
  });

  return {ast, changed};
}
