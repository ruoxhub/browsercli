/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import traverseImport from '@babel/traverse';
import type {NodePath as BabelNodePath} from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from '../astUtils.js';
import {SandboxEvaluator} from '../SandboxEvaluator.js';
import type {SiteAdapter} from '../SiteAdapterRegistry.js';
import {WrapperFolder} from '../WrapperFolder.js';

const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type NodePath<T extends t.Node = t.Node> = BabelNodePath<T>;

const STRING_METHODS = new Set(['substring', 'substr', 'slice', 'split']);

function isPrimitiveValue(value: unknown): boolean {
  return (
    value === null ||
    ['string', 'number', 'boolean', 'undefined'].includes(typeof value)
  );
}

function literalNodeFromValue(value: unknown): t.Expression | null {
  if (typeof value === 'undefined') {
    return t.identifier('undefined');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return t.valueToNode(value);
  }
  return null;
}

function getPropertyKey(node: t.Node): string | null {
  if (t.isIdentifier(node)) {
    return node.name;
  }
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) {
    return String(node.value);
  }
  return null;
}

function resolveStringValue(
  path: NodePath,
  seen = new Set<unknown>(),
): string | null {
  if (!path || !path.node) {
    return null;
  }
  if (path.isStringLiteral()) {
    return (path.node as t.StringLiteral).value;
  }
  if (
    path.isTemplateLiteral() &&
    (path.node as t.TemplateLiteral).expressions.length === 0
  ) {
    return (path.node as t.TemplateLiteral).quasis[0]!.value.cooked ?? null;
  }
  if (path.isIdentifier()) {
    const binding = path.scope.getBinding((path.node as t.Identifier).name);
    if (
      !binding ||
      seen.has(binding) ||
      !binding.path.parentPath ||
      !binding.path.parentPath.isVariableDeclarator()
    ) {
      return null;
    }
    seen.add(binding);
    return resolveStringValue(
      binding.path.parentPath.get('init') as NodePath,
      seen,
    );
  }
  return null;
}

function inlineStringMethodCalls(ast: t.File): boolean {
  let changed = false;

  traverse(ast, {
    CallExpression(path) {
      if (!(path.get('callee') as NodePath).isMemberExpression()) {
        return;
      }
      const callee = path.get('callee') as NodePath<t.MemberExpression>;
      const property = getPropertyKey(callee.node.property);
      if (!property || !STRING_METHODS.has(property)) {
        return;
      }
      const source = resolveStringValue(callee.get('object') as NodePath);
      if (typeof source !== 'string') {
        return;
      }

      const argValues: unknown[] = [];
      for (const argPath of path.get('arguments') as NodePath[]) {
        const evaluated = argPath.evaluate();
        if (!evaluated.confident || !isPrimitiveValue(evaluated.value)) {
          return;
        }
        argValues.push(evaluated.value);
      }

      let value: unknown;
      try {
        value = (
          source as unknown as Record<string, (...args: unknown[]) => unknown>
        )[property](...argValues);
      } catch {
        return;
      }

      const node = literalNodeFromValue(value);
      if (!node) {
        return;
      }
      path.replaceWith(node);
      changed = true;
    },
  });

  return changed;
}

function getDecoderPreludeNodes(ast: t.File): t.Node[] {
  const topLevelDeclarator = ast.program.body
    .filter(node => t.isVariableDeclaration(node))
    .flatMap(node => (node as t.VariableDeclaration).declarations)
    .find(
      decl =>
        t.isIdentifier(decl.id) &&
        (t.isFunctionExpression(decl.init) ||
          (t.isCallExpression(decl.init) &&
            t.isFunctionExpression(decl.init.callee))),
    );

  const rootFunction: t.FunctionExpression | null = !topLevelDeclarator
    ? null
    : t.isFunctionExpression(topLevelDeclarator.init)
      ? topLevelDeclarator.init
      : t.isCallExpression(topLevelDeclarator.init) &&
          t.isFunctionExpression(topLevelDeclarator.init.callee)
        ? topLevelDeclarator.init.callee
        : null;

  if (!rootFunction || !t.isBlockStatement(rootFunction.body)) {
    return [];
  }

  const nodes: t.Node[] = [];
  for (const stmt of rootFunction.body.body) {
    if (
      t.isFunctionDeclaration(stmt) &&
      stmt.id &&
      (stmt.id.name === 't' || stmt.id.name === 'u')
    ) {
      nodes.push(stmt);
      continue;
    }
    if (
      t.isVariableDeclaration(stmt) &&
      stmt.declarations.every(
        decl => t.isIdentifier(decl.id) && decl.init == null,
      )
    ) {
      nodes.push(stmt);
      continue;
    }
    if (t.isExpressionStatement(stmt)) {
      nodes.push(stmt);
      break;
    }
  }

  return nodes;
}

function collectDecoderAliasNames(
  ast: t.File,
  seedNames: string[],
): Set<string> {
  const aliasNames = new Set<string>(seedNames);
  let expanded = false;

  do {
    expanded = false;
    traverse(ast, {
      VariableDeclarator(path) {
        if (
          !(path.get('id') as NodePath).isIdentifier() ||
          !(path.get('init') as NodePath).isIdentifier()
        ) {
          return;
        }
        const sourceName = (
          (path.node as t.VariableDeclarator).init as t.Identifier
        ).name;
        const aliasName = (
          (path.node as t.VariableDeclarator).id as t.Identifier
        ).name;
        if (!aliasNames.has(sourceName) || aliasNames.has(aliasName)) {
          return;
        }
        aliasNames.add(aliasName);
        expanded = true;
      },
      AssignmentExpression(path) {
        if (
          !(path.get('left') as NodePath).isIdentifier() ||
          !(path.get('right') as NodePath).isIdentifier()
        ) {
          return;
        }
        const sourceName = (
          (path.node as t.AssignmentExpression).right as t.Identifier
        ).name;
        const aliasName = (
          (path.node as t.AssignmentExpression).left as t.Identifier
        ).name;
        if (!aliasNames.has(sourceName) || aliasNames.has(aliasName)) {
          return;
        }
        aliasNames.add(aliasName);
        expanded = true;
      },
    });
  } while (expanded);

  return aliasNames;
}

function replaceDecoderAliasCalls(
  ast: t.File,
  sandbox: Record<string, unknown>,
  aliasNames: Set<string>,
): boolean {
  if (typeof sandbox['t'] !== 'function' || aliasNames.size === 0) {
    return false;
  }

  let changed = false;
  const decoderFn = sandbox['t'] as (arg: number) => unknown;

  traverse(ast, {
    CallExpression(path) {
      const calleePath = path.get('callee') as NodePath;
      let isDecoderAliasCall = false;

      if (calleePath.isIdentifier()) {
        isDecoderAliasCall = aliasNames.has(
          (calleePath.node as t.Identifier).name,
        );
      } else if (
        calleePath.isAssignmentExpression({operator: '='}) &&
        (calleePath.get('left') as NodePath).isIdentifier() &&
        (calleePath.get('right') as NodePath).isIdentifier()
      ) {
        isDecoderAliasCall = aliasNames.has(
          ((calleePath.node as t.AssignmentExpression).right as t.Identifier)
            .name,
        );
      }

      if (!isDecoderAliasCall) {
        return;
      }
      if (
        (path.node as t.CallExpression).arguments.length !== 1 ||
        !(path.get('arguments.0') as NodePath).isNumericLiteral()
      ) {
        return;
      }

      let value: unknown;
      try {
        value = decoderFn(
          ((path.node as t.CallExpression).arguments[0] as t.NumericLiteral)
            .value,
        );
      } catch {
        return;
      }

      const literalNode = literalNodeFromValue(value);
      if (!literalNode) {
        return;
      }

      path.replaceWith(literalNode);
      changed = true;
    },
  });

  return changed;
}

function tonghuashunOrderPass(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;
  let localChanged = false;

  const evaluator = new SandboxEvaluator();
  const sandbox = evaluator.createSandbox();
  const preludeNodes = getDecoderPreludeNodes(ast);

  if (
    preludeNodes.length > 0 &&
    evaluator.evaluateNodes(preludeNodes, sandbox, 2000)
  ) {
    while (evaluator.seedSandboxFromAliases(ast, sandbox)) {
      changed = true;
    }
  }

  const decoderAliasNames = collectDecoderAliasNames(ast, ['t']);
  const wrapperFolder = new WrapperFolder();

  do {
    localChanged = false;

    if (replaceDecoderAliasCalls(ast, sandbox, decoderAliasNames)) {
      localChanged = true;
      changed = true;
    }

    if (inlineStringMethodCalls(ast)) {
      localChanged = true;
      changed = true;
    }

    if (wrapperFolder.foldWrapperObjects(ast)) {
      localChanged = true;
      changed = true;
    }

    if (inlineStringMethodCalls(ast)) {
      localChanged = true;
      changed = true;
    }
  } while (localChanged);

  return {ast, changed};
}

export class TonghuashunAdapter implements SiteAdapter {
  readonly patternId = 'tonghuashun';
  readonly prePasses = [tonghuashunOrderPass];
}
