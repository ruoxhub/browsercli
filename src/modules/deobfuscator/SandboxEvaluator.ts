/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import vm from 'node:vm';

import generateImport from '@babel/generator';
import traverseImport from '@babel/traverse';
import type {NodePath as BabelNodePath} from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

export interface SandboxOptions {
  timeoutMs?: number;
  maxStatements?: number;
  extraGlobals?: Record<string, unknown>;
}

export interface PreludeResult {
  sandbox: Record<string, unknown>;
  executedCount: number;
}

export interface EvalResult {
  ok: boolean;
  value?: unknown;
  error?: unknown;
}

export class SandboxEvaluator {
  createSandbox(extra?: Record<string, unknown>): Record<string, unknown> {
    const sandbox: Record<string, unknown> = {
      Array,
      Boolean,
      Date,
      Error,
      JSON,
      Map,
      Math,
      Number,
      Object,
      RegExp,
      Set,
      String,
      Symbol,
      TypeError,
      WeakMap,
      WeakSet,
      atob,
      btoa,
      clearInterval,
      clearTimeout,
      console,
      decodeURIComponent,
      encodeURIComponent,
      escape,
      isFinite,
      isNaN,
      parseFloat,
      parseInt,
      setInterval,
      setTimeout,
      unescape,
      Uint8Array,
      ...extra,
    };

    if (typeof Buffer !== 'undefined') {
      sandbox.Buffer = Buffer;
    }

    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    sandbox.window = sandbox;

    return sandbox;
  }

  evaluateExpression(
    code: string,
    sandbox: Record<string, unknown>,
    timeoutMs = 1000,
  ): EvalResult {
    try {
      return {
        ok: true,
        value: vm.runInNewContext(code, sandbox, {timeout: timeoutMs}),
      };
    } catch (error) {
      return {ok: false, error};
    }
  }

  evaluateNodes(
    nodes: t.Node[],
    sandbox: Record<string, unknown>,
    timeoutMs = 1000,
  ): boolean {
    try {
      const code = nodes
        .map(
          n =>
            generate(n, {
              compact: true,
              comments: false,
              jsescOption: {minimal: true},
            }).code,
        )
        .join(';\n');
      vm.runInNewContext(code, sandbox, {timeout: timeoutMs});
      return true;
    } catch {
      return false;
    }
  }

  evaluatePreludeStatements(
    ast: t.File,
    options?: SandboxOptions,
  ): PreludeResult {
    const maxStatements = options?.maxStatements ?? 10;
    const timeoutMs = options?.timeoutMs ?? 1000;
    const sandbox = options?.extraGlobals
      ? this.createSandbox(options.extraGlobals)
      : this.createSandbox();

    const executed: t.Node[] = [];

    for (const node of ast.program.body) {
      if (executed.length >= maxStatements) {
        break;
      }
      if (!shouldEvaluateTopLevelStatement(node)) {
        break;
      }
      if (!this.evaluateNodes([node], sandbox, timeoutMs)) {
        break;
      }
      executed.push(node);
    }

    return {sandbox, executedCount: executed.length};
  }

  seedSandboxFromAliases(
    ast: t.File,
    sandbox: Record<string, unknown>,
  ): boolean {
    let changed = false;

    traverse(ast, {
      VariableDeclarator(path) {
        if (
          !(path.get('id') as NodePath).isIdentifier() ||
          !(path.get('init') as NodePath).isIdentifier()
        ) {
          return;
        }

        const aliasName = (path.node.id as t.Identifier).name;
        const sourceName = (path.node.init as t.Identifier).name;
        if (
          !Object.prototype.hasOwnProperty.call(sandbox, sourceName) ||
          Object.prototype.hasOwnProperty.call(sandbox, aliasName)
        ) {
          return;
        }

        sandbox[aliasName] = sandbox[sourceName];
        changed = true;
      },
      AssignmentExpression(path) {
        if (
          !(path.get('left') as NodePath).isIdentifier() ||
          !(path.get('right') as NodePath).isIdentifier()
        ) {
          return;
        }

        const aliasName = (path.node.left as t.Identifier).name;
        const sourceName = (path.node.right as t.Identifier).name;
        if (
          !Object.prototype.hasOwnProperty.call(sandbox, sourceName) ||
          Object.prototype.hasOwnProperty.call(sandbox, aliasName)
        ) {
          return;
        }

        sandbox[aliasName] = sandbox[sourceName];
        changed = true;
      },
    });

    return changed;
  }

  replacePrimitiveIdentifiers(
    ast: t.File,
    sandbox: Record<string, unknown>,
    options?: {includeGlobals?: boolean; globalAllowlist?: string[]},
  ): boolean {
    const includeGlobals = options?.includeGlobals === true;
    const globalAllowlist = new Set(options?.globalAllowlist ?? []);
    const bindingLiterals = new Map<unknown, t.Expression>();
    let changed = false;

    traverse(ast, {
      VariableDeclarator(path) {
        if (!(path.get('id') as NodePath).isIdentifier()) {
          return;
        }
        const name = (path.node.id as t.Identifier).name;
        const binding = path.scope.getBinding(name);
        if (!Object.prototype.hasOwnProperty.call(sandbox, name)) {
          return;
        }
        const node = literalNodeFromValue(sandbox[name]);
        if (binding && binding.constant && node) {
          bindingLiterals.set(binding, node);
        }
      },
      Identifier(path) {
        if (!includeGlobals) {
          return;
        }
        if (!(path as NodePath).isReferencedIdentifier()) {
          return;
        }
        if (
          globalAllowlist.size > 0 &&
          !globalAllowlist.has((path.node as t.Identifier).name)
        ) {
          return;
        }
        const binding = path.scope.getBinding((path.node as t.Identifier).name);
        if (binding) {
          return;
        }
        if (
          !Object.prototype.hasOwnProperty.call(
            sandbox,
            (path.node as t.Identifier).name,
          )
        ) {
          return;
        }
        const node = literalNodeFromValue(
          sandbox[(path.node as t.Identifier).name],
        );
        if (
          !node ||
          (t.isIdentifier(node) &&
            node.name === (path.node as t.Identifier).name)
        ) {
          return;
        }
        path.replaceWith(t.cloneNode(node));
        changed = true;
      },
    });

    if (bindingLiterals.size > 0) {
      traverse(ast, {
        Identifier(path) {
          if (!(path as NodePath).isReferencedIdentifier()) {
            return;
          }
          const binding = path.scope.getBinding(
            (path.node as t.Identifier).name,
          );
          const node = binding ? bindingLiterals.get(binding) : null;
          if (
            !node ||
            (t.isIdentifier(node) &&
              node.name === (path.node as t.Identifier).name)
          ) {
            return;
          }
          path.replaceWith(t.cloneNode(node));
          changed = true;
        },
      });

      for (const [binding, node] of bindingLiterals.entries()) {
        const bp = (binding as {path?: NodePath}).path;
        if (bp && !(bp as {removed?: boolean}).removed) {
          if ((bp as NodePath).isVariableDeclarator()) {
            const initPath = (bp as NodePath<t.VariableDeclarator>).get('init');
            if (initPath && initPath.node) {
              initPath.replaceWith(t.cloneNode(node));
            }
          }
          (bp as {remove(): void}).remove();
          changed = true;
        }
      }
    }

    return changed;
  }

  replaceCallsFromSandbox(
    ast: t.File,
    sandbox: Record<string, unknown>,
    options?: {
      timeoutMs?: number;
      allowPredicate?: (path: unknown, name: string) => boolean;
    },
  ): boolean {
    const allowPredicate = options?.allowPredicate ?? (() => true);
    const timeoutMs = options?.timeoutMs ?? 1000;
    let changed = false;

    traverse(ast, {
      CallExpression(path) {
        const calleeName = resolveSandboxCallableName(
          path.get('callee') as NodePath,
          sandbox,
        );
        if (!calleeName || !allowPredicate(path, calleeName)) {
          return;
        }

        const argValues: unknown[] = [];
        for (const argPath of path.get('arguments') as NodePath[]) {
          const code = generate(argPath.node, {
            compact: true,
            comments: false,
            jsescOption: {minimal: true},
          }).code;
          const evaluated = new SandboxEvaluator().evaluateExpression(
            code,
            sandbox,
            timeoutMs,
          );
          if (!evaluated.ok) {
            return;
          }
          argValues.push(evaluated.value);
        }

        let value: unknown;
        try {
          value = (sandbox[calleeName] as (...args: unknown[]) => unknown)(
            ...argValues,
          );
        } catch {
          const code = generate(path.node, {
            compact: true,
            comments: false,
            jsescOption: {minimal: true},
          }).code;
          const result = new SandboxEvaluator().evaluateExpression(
            code,
            sandbox,
            timeoutMs,
          );
          if (!result.ok) {
            return;
          }
          value = result.value;
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

  replaceMembersFromSandbox(
    ast: t.File,
    sandbox: Record<string, unknown>,
  ): boolean {
    let changed = false;

    traverse(ast, {
      MemberExpression(path) {
        if (!isSafeMemberReplacement(path as NodePath)) {
          return;
        }

        const key = getPropertyKey((path.node as t.MemberExpression).property);
        if (key === null) {
          return;
        }

        const objectName = resolveSandboxValueName(
          path.get('object') as NodePath,
          sandbox,
        );
        if (!objectName) {
          return;
        }

        const container = sandbox[objectName];
        if (
          !container ||
          (typeof container !== 'object' && typeof container !== 'function')
        ) {
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(container, key)) {
          return;
        }

        const node = literalNodeFromValue(
          (container as Record<string, unknown>)[key],
        );
        if (!node) {
          return;
        }

        path.replaceWith(node);
        changed = true;
      },
    });

    return changed;
  }
}

export function isSafeMemberReplacement(path: NodePath): boolean {
  const parent = path.parentPath;
  if (!parent) {
    return false;
  }
  if (
    (parent.isAssignmentExpression() || parent.isAssignmentPattern()) &&
    path.key === 'left'
  ) {
    return false;
  }
  if (parent.isUpdateExpression() && path.key === 'argument') {
    return false;
  }
  if (
    (parent.isForInStatement() || parent.isForOfStatement()) &&
    path.key === 'left'
  ) {
    return false;
  }
  if (
    parent.isUnaryExpression({operator: 'delete'}) &&
    path.key === 'argument'
  ) {
    return false;
  }
  return true;
}

export function getPropertyKey(node: t.Node): string | null {
  if (t.isIdentifier(node)) {
    return node.name;
  }
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) {
    return String(node.value);
  }
  return null;
}

export function literalNodeFromValue(value: unknown): t.Expression | null {
  if (!isSerializableValue(value)) {
    return null;
  }
  if (typeof value === 'undefined') {
    return t.identifier('undefined');
  }
  return t.valueToNode(value) as t.Expression;
}

export function isPrimitiveValue(value: unknown): boolean {
  return (
    value === null ||
    ['string', 'number', 'boolean', 'undefined'].includes(typeof value)
  );
}

function isSerializableValue(value: unknown, depth = 0): boolean {
  if (depth > 4) {
    return false;
  }
  if (isPrimitiveValue(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(item => isSerializableValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return false;
    }
    return Object.keys(value as Record<string, unknown>).every(key =>
      isSerializableValue((value as Record<string, unknown>)[key], depth + 1),
    );
  }
  return false;
}

function shouldEvaluateTopLevelStatement(node: t.Node): boolean {
  if (t.isFunctionDeclaration(node)) {
    return true;
  }
  if (t.isVariableDeclaration(node)) {
    return true;
  }
  if (!t.isExpressionStatement(node)) {
    return false;
  }

  const expr = node.expression;
  if (t.isAssignmentExpression(expr)) {
    return true;
  }
  if (t.isCallExpression(expr)) {
    if (
      t.isFunctionExpression(expr.callee) ||
      t.isArrowFunctionExpression(expr.callee)
    ) {
      const body = (
        expr.callee as t.FunctionExpression | t.ArrowFunctionExpression
      ).body;
      return (
        body != null && (!t.isBlockStatement(body) || body.body.length <= 40)
      );
    }
    return t.isIdentifier(expr.callee);
  }
  if (t.isUnaryExpression(expr) && t.isCallExpression(expr.argument)) {
    const call = expr.argument;
    if (
      t.isFunctionExpression(call.callee) ||
      t.isArrowFunctionExpression(call.callee)
    ) {
      const body = (
        call.callee as t.FunctionExpression | t.ArrowFunctionExpression
      ).body;
      return (
        body != null && (!t.isBlockStatement(body) || body.body.length <= 40)
      );
    }
  }
  return false;
}

function getBindingAliasInitPath(
  binding: ReturnType<NodePath['scope']['getBinding']>,
): NodePath | null {
  if (!binding || !binding.path) {
    return null;
  }

  if (binding.path.isVariableDeclarator()) {
    const initPath = (binding.path as NodePath<t.VariableDeclarator>).get(
      'init',
    );
    if (initPath && initPath.node) {
      return initPath as NodePath;
    }
  }

  if (binding.path.parentPath?.isVariableDeclarator()) {
    const initPath = (
      binding.path.parentPath as NodePath<t.VariableDeclarator>
    ).get('init');
    if (initPath && initPath.node) {
      return initPath as NodePath;
    }
  }

  if (binding.constantViolations.length === 1) {
    const violationPath = binding.constantViolations[0] as NodePath | undefined;
    if (
      violationPath &&
      violationPath.isAssignmentExpression() &&
      (violationPath.get('left') as NodePath).isIdentifier() &&
      (violationPath.get('right') as NodePath).isIdentifier()
    ) {
      return violationPath.get('right') as NodePath;
    }
  }

  return null;
}

function resolveSandboxCallableName(
  path: NodePath,
  sandbox: Record<string, unknown>,
  seenBindings?: Set<unknown>,
): string | null {
  if (!path || !path.node || !path.isIdentifier()) {
    return null;
  }

  const directName = (path.node as t.Identifier).name;
  const binding = path.scope.getBinding(directName);
  const programScope = path.scope.getProgramParent();

  if (!binding) {
    return typeof sandbox[directName] === 'function' ? directName : null;
  }

  if (
    binding.scope === programScope &&
    typeof sandbox[directName] === 'function'
  ) {
    return directName;
  }

  const localSeen = seenBindings ?? new Set();
  if (localSeen.has(binding)) {
    return null;
  }
  localSeen.add(binding);

  const initPath = getBindingAliasInitPath(binding);
  if (!initPath || !initPath.node || !initPath.isIdentifier()) {
    return null;
  }

  return resolveSandboxCallableName(initPath, sandbox, localSeen);
}

function resolveSandboxValueName(
  path: NodePath,
  sandbox: Record<string, unknown>,
  seenBindings?: Set<unknown>,
): string | null {
  if (!path || !path.node || !path.isIdentifier()) {
    return null;
  }

  const directName = (path.node as t.Identifier).name;
  const binding = path.scope.getBinding(directName);
  const programScope = path.scope.getProgramParent();

  if (!binding) {
    return Object.prototype.hasOwnProperty.call(sandbox, directName)
      ? directName
      : null;
  }

  if (
    binding.scope === programScope &&
    Object.prototype.hasOwnProperty.call(sandbox, directName)
  ) {
    return directName;
  }

  const localSeen = seenBindings ?? new Set();
  if (localSeen.has(binding)) {
    return null;
  }
  localSeen.add(binding);

  const initPath = getBindingAliasInitPath(binding);
  if (!initPath || !initPath.node || !initPath.isIdentifier()) {
    return null;
  }

  return resolveSandboxValueName(initPath, sandbox, localSeen);
}

type NodePath<T extends t.Node = t.Node> = BabelNodePath<T>;
