/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import vm from 'node:vm';

import generateImport from '@babel/generator';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from '../astUtils.js';
import {literalNodeFromValue, SandboxEvaluator} from '../SandboxEvaluator.js';
import type {SiteAdapter} from '../SiteAdapterRegistry.js';
import {WrapperFolder} from '../WrapperFolder.js';

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

function runCodeInSandbox(
  code: string,
  sandbox: Record<string, unknown>,
  timeoutMs: number,
): boolean {
  try {
    vm.runInNewContext(code, sandbox, {timeout: timeoutMs});
    return true;
  } catch {
    return false;
  }
}

function inlineAssignmentObjects(ast: t.File): boolean {
  let changed = false;

  traverse(ast, {
    VariableDeclaration(path) {
      if (path.node.declarations.length !== 1) {
        return;
      }

      const declaration = path.get(
        'declarations.0',
      ) as NodePath<t.VariableDeclarator>;
      if (
        !(declaration.get('id') as NodePath).isIdentifier() ||
        !(declaration.get('init') as NodePath).isObjectExpression({
          properties: [],
        })
      ) {
        return;
      }

      const name = (declaration.node.id as t.Identifier).name;
      const binding = path.scope.getBinding(name);
      if (!binding) {
        return;
      }

      const objectEntries: Record<string, t.Expression> = Object.create(null);
      binding.referencePaths.forEach(refPath => {
        const memberPath = (refPath as NodePath).parentPath;
        const assignmentPath = memberPath ? memberPath.parentPath : null;
        if (
          !memberPath ||
          !memberPath.isMemberExpression({object: refPath.node}) ||
          !assignmentPath ||
          !assignmentPath.isAssignmentExpression({
            left: memberPath.node,
            operator: '=',
          })
        ) {
          return;
        }

        const memberNode = memberPath.node as t.MemberExpression;
        const key = memberNode.computed
          ? String(
              (memberNode.property as t.StringLiteral | t.NumericLiteral).value,
            )
          : (memberNode.property as t.Identifier).name;
        objectEntries[key] = t.cloneNode(
          (assignmentPath.node as t.AssignmentExpression).right,
        ) as t.Expression;
        assignmentPath.remove();
        changed = true;
      });

      const properties = Object.entries(objectEntries).map(([key, valueNode]) =>
        t.objectProperty(t.stringLiteral(key), valueNode),
      );
      if (properties.length > 0) {
        (declaration.get('init') as NodePath).replaceWith(
          t.objectExpression(properties),
        );
        changed = true;
      }
    },
  });

  return changed;
}

function getLeadingPreludeNodes(ast: t.File, maxStatements = 12): t.Node[] {
  const collected: t.Node[] = [];
  for (const node of ast.program.body) {
    if (collected.length >= maxStatements) {
      break;
    }
    if (t.isFunctionDeclaration(node) || t.isVariableDeclaration(node)) {
      collected.push(node);
      continue;
    }
    break;
  }
  return collected;
}

function findRotationIifeNode(
  ast: t.File,
  preludeCount: number,
): t.Node | null {
  const node = ast.program.body[preludeCount];
  if (!node || !t.isExpressionStatement(node)) {
    return null;
  }
  const expr = node.expression;
  if (
    t.isCallExpression(expr) &&
    (t.isFunctionExpression(expr.callee) ||
      t.isArrowFunctionExpression(expr.callee))
  ) {
    return node;
  }
  return null;
}

function findPxSetterFunctionName(ast: t.File): string | null {
  for (const node of ast.program.body) {
    if (!t.isFunctionDeclaration(node) || !node.id) {
      continue;
    }
    let matched = false;
    traverse(t.file(t.program([t.cloneNode(node) as t.Statement])), {
      AssignmentExpression(path) {
        if ((path.get('left') as NodePath).isIdentifier({name: 'PX'})) {
          matched = true;
          path.stop();
        }
      },
    });
    if (matched) {
      return node.id.name;
    }
  }
  return null;
}

function findDecoderFunctionName(ast: t.File): string | null {
  for (const node of ast.program.body) {
    if (t.isFunctionDeclaration(node) && node.id && node.id.name) {
      return node.id.name;
    }
  }
  return null;
}

interface ValidationTarget {
  argValue: number;
  expected: string;
  orderArgValue: number;
}

function collectValidationTargets(ast: t.File): ValidationTarget[] {
  const targets: ValidationTarget[] = [];
  const seen = new Set<string>();

  traverse(ast, {
    CallExpression(path) {
      const firstArgPath = path.get('arguments.0') as NodePath;
      if (
        !(path.get('callee') as NodePath).isMemberExpression() ||
        !firstArgPath ||
        !firstArgPath.node ||
        !firstArgPath.isStringLiteral({value: '|'})
      ) {
        return;
      }

      const propertyPath = path.get('callee.property') as NodePath;
      if (
        !propertyPath.isCallExpression() ||
        !(propertyPath.get('arguments.0') as NodePath).isNumericLiteral()
      ) {
        return;
      }

      const argValue = (
        (propertyPath.node as t.CallExpression).arguments[0] as t.NumericLiteral
      ).value;
      const objectPath = path.get('callee.object') as NodePath;
      if (
        !objectPath.isCallExpression() ||
        !(objectPath.get('arguments.0') as NodePath).isNumericLiteral()
      ) {
        return;
      }

      const orderArgValue = (
        (objectPath.node as t.CallExpression).arguments[0] as t.NumericLiteral
      ).value;
      const token = `split:${argValue}:order:${orderArgValue}`;
      if (seen.has(token)) {
        return;
      }

      seen.add(token);
      targets.push({argValue, expected: 'split', orderArgValue});
    },
  });

  return targets;
}

function buildDynamicDecoderSandbox(
  preludeCode: string,
  rotationCode: string,
  pxSetterName: string,
  pxValue: number,
): Record<string, unknown> | null {
  const evaluator = new SandboxEvaluator();
  const sandbox = evaluator.createSandbox();

  if (!runCodeInSandbox(preludeCode, sandbox, 5000)) {
    return null;
  }

  sandbox[pxSetterName] = function patchedPxSetter() {
    sandbox['PX'] = pxValue;
    return 'nBfa';
  };

  if (!runCodeInSandbox(rotationCode, sandbox, 3000)) {
    return null;
  }

  return sandbox;
}

function validateDynamicDecoderSandbox(
  sandbox: Record<string, unknown> | null,
  decoderName: string,
  targets: ValidationTarget[],
): boolean {
  if (
    !sandbox ||
    typeof sandbox[decoderName] !== 'function' ||
    targets.length === 0
  ) {
    return false;
  }

  try {
    const decoderFn = sandbox[decoderName] as (arg: number) => unknown;
    return targets.every(target => {
      if (decoderFn(target.argValue) !== target.expected) {
        return false;
      }
      if (typeof target.orderArgValue !== 'number') {
        return true;
      }
      const orderValue = decoderFn(target.orderArgValue);
      return typeof orderValue === 'string' && orderValue.includes('|');
    });
  } catch {
    return false;
  }
}

interface DynamicDecoderResult {
  sandbox: Record<string, unknown>;
  decoderName: string;
  pxValue: number;
}

function bootstrapDynamicDecoderSandbox(
  ast: t.File,
): DynamicDecoderResult | null {
  const preludeNodes = getLeadingPreludeNodes(ast);
  const rotationNode = findRotationIifeNode(ast, preludeNodes.length);
  const pxSetterName = findPxSetterFunctionName(ast);
  const decoderName = findDecoderFunctionName(ast);
  const targets = collectValidationTargets(ast);
  const preludeCode = preludeNodes.map(node => generateCode(node)).join(';\n');
  const rotationCode = rotationNode ? generateCode(rotationNode) : '';

  if (!rotationNode || !pxSetterName || !decoderName || targets.length === 0) {
    return null;
  }

  const pxCandidates: number[] = [];
  for (let pxValue = 256; pxValue <= 512; pxValue += 1) {
    pxCandidates.push(pxValue);
  }
  for (let pxValue = 0; pxValue < 256; pxValue += 1) {
    pxCandidates.push(pxValue);
  }

  for (const pxValue of pxCandidates) {
    const sandbox = buildDynamicDecoderSandbox(
      preludeCode,
      rotationCode,
      pxSetterName,
      pxValue,
    );
    if (!validateDynamicDecoderSandbox(sandbox, decoderName, targets)) {
      continue;
    }
    return {sandbox, decoderName, pxValue};
  }

  return null;
}

function obVariantPass(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;
  const body = ast.program.body;
  const evaluator = new SandboxEvaluator();

  if (
    body.length >= 3 &&
    t.isVariableDeclaration(body[2]!) &&
    body[2]!.declarations.length > 0 &&
    t.isIdentifier(body[2]!.declarations[0]!.id)
  ) {
    const sandbox = evaluator.createSandbox();
    const decoderName = body[2]!.declarations[0]!.id.name;

    if (
      evaluator.evaluateNodes(body.slice(0, 3), sandbox) &&
      typeof sandbox[decoderName] === 'function'
    ) {
      ast.program.body = body
        .slice(3)
        .map(node => t.cloneNode(node) as t.Statement);
      changed = true;

      traverse(ast, {
        CallExpression(path) {
          if (
            !(path.get('callee') as NodePath).isIdentifier({name: decoderName})
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
        BinaryExpression: {
          exit(path) {
            const evaluated = path.evaluate();
            if (evaluated.confident) {
              path.replaceWith(t.valueToNode(evaluated.value));
              changed = true;
            }
          },
        },
      });
    }
  }

  const dynamicDecoder = bootstrapDynamicDecoderSandbox(ast);
  const prelude = dynamicDecoder
    ? null
    : evaluator.evaluatePreludeStatements(ast, {
        maxStatements: 8,
        timeoutMs: 1500,
      });

  const sandbox = dynamicDecoder ? dynamicDecoder.sandbox : prelude!.sandbox;

  if (dynamicDecoder || prelude!.executedCount > 0) {
    if (evaluator.seedSandboxFromAliases(ast, sandbox)) {
      changed = true;
    }

    if (
      evaluator.replaceCallsFromSandbox(ast, sandbox, {
        timeoutMs: 800,
        allowPredicate: (_path: unknown, _name: string) =>
          (
            (_path as NodePath<t.CallExpression>).node as t.CallExpression
          ).arguments.every(arg => t.isLiteral(arg)),
      })
    ) {
      changed = true;
    }

    if (evaluator.replaceMembersFromSandbox(ast, sandbox)) {
      changed = true;
    }

    traverse(ast, {
      VariableDeclarator(path) {
        const initPath = path.get('init') as NodePath;
        if (!initPath.node) {
          return;
        }
        const code = generateCode(initPath.node);
        const result = evaluator.evaluateExpression(code, sandbox, 800);
        const node = result.ok ? literalNodeFromValue(result.value) : null;
        if (!node) {
          return;
        }
        initPath.replaceWith(node);
        changed = true;
      },
    });

    if (evaluator.replacePrimitiveIdentifiers(ast, sandbox)) {
      changed = true;
    }

    if (evaluator.replaceMembersFromSandbox(ast, sandbox)) {
      changed = true;
    }

    if (
      evaluator.replaceCallsFromSandbox(ast, sandbox, {
        timeoutMs: 800,
        allowPredicate: (_path: unknown, _name: string) =>
          (
            (_path as NodePath<t.CallExpression>).node as t.CallExpression
          ).arguments.every(arg => t.isLiteral(arg)),
      })
    ) {
      changed = true;
    }
  }

  if (inlineAssignmentObjects(ast)) {
    changed = true;
  }

  const wrapperFolder = new WrapperFolder();
  let localChanged = false;
  do {
    localChanged = wrapperFolder.foldWrapperObjects(ast, {
      sandbox,
      timeoutMs: 800,
    });
    if (localChanged) {
      changed = true;
    }
  } while (localChanged);

  return {ast, changed};
}

export class ObVariantAdapter implements SiteAdapter {
  readonly patternId = 'cn-bidding-ob';
  readonly prePasses = [obVariantPass];
  readonly postPasses = [obVariantPass];
}

export const MPS_OB_PATTERN_ID = 'mps-ob';
