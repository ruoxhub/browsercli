import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from '../astUtils.js';
import type {SiteAdapter} from '../SiteAdapterRegistry.js';

const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type NodePath<T extends t.Node = t.Node> = import('@babel/traverse').NodePath<T>;

const STRING_METHODS = new Set(['substring', 'substr', 'slice', 'split']);

function isPrimitiveValue(value: unknown): boolean {
  return (
    value === null ||
    ['string', 'number', 'boolean', 'undefined'].includes(typeof value)
  );
}

function literalNodeFromValue(value: unknown): t.Expression | null {
  if (value === null || typeof value === 'undefined') {
    return t.identifier('undefined');
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return t.valueToNode(value);
  }
  if (Array.isArray(value)) {
    return t.valueToNode(value);
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
    const binding = path.scope.getBinding(
      (path.node as t.Identifier).name,
    );
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

function getPropertyKey(node: t.Node): string | null {
  if (t.isIdentifier(node)) {
    return node.name;
  }
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) {
    return String(node.value);
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
        value = (source as unknown as Record<string, Function>)[property](
          ...argValues,
        );
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

function foldStringConcatenation(ast: t.File): boolean {
  let changed = false;

  traverse(ast, {
    BinaryExpression: {
      exit(path) {
        if (
          (path.get('left') as NodePath).isStringLiteral() &&
          (path.get('right') as NodePath).isStringLiteral()
        ) {
          const evaluated = path.evaluate();
          if (evaluated.confident) {
            path.replaceWith(t.valueToNode(evaluated.value));
            changed = true;
          }
        }
      },
    },
  });

  return changed;
}

function pruneUnusedTopLevel(ast: t.File): boolean {
  let changed = false;

  traverse(ast, {
    Program(path) {
      (path.get('body') as NodePath[]).forEach(stmtPath => {
        if (stmtPath.isVariableDeclaration()) {
          const removable: NodePath[] = [];
          (stmtPath.get('declarations') as NodePath[]).forEach(declPath => {
            if (!(declPath.get('id') as NodePath).isIdentifier()) {
              return;
            }
            const binding = declPath.scope.getBinding(
              (declPath.node as t.VariableDeclarator).id
                ? ((declPath.node as t.VariableDeclarator).id as t.Identifier)
                    .name
                : '',
            );
            if (binding && !binding.referenced) {
              removable.push(declPath);
            }
          });
          if (
            removable.length ===
              (stmtPath.node as t.VariableDeclaration).declarations.length &&
            removable.length > 0
          ) {
            stmtPath.remove();
            changed = true;
          } else if (removable.length > 0) {
            removable.forEach(declPath => declPath.remove());
            changed = true;
          }
        } else if (
          stmtPath.isFunctionDeclaration() &&
          (stmtPath.node as t.FunctionDeclaration).id
        ) {
          const binding = stmtPath.scope.getBinding(
            ((stmtPath.node as t.FunctionDeclaration).id as t.Identifier).name,
          );
          if (binding && !binding.referenced) {
            stmtPath.remove();
            changed = true;
          }
        }
      });
    },
  });

  return changed;
}

function reese84PostPass(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;

  if (inlineStringMethodCalls(ast)) {
    changed = true;
  }
  if (foldStringConcatenation(ast)) {
    changed = true;
  }
  if (pruneUnusedTopLevel(ast)) {
    changed = true;
  }

  return {ast, changed};
}

export class Reese84Adapter implements SiteAdapter {
  readonly patternId = 'reese84';
  readonly postPasses = [reese84PostPass];
}
