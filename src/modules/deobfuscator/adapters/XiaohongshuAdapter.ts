import generateImport from '@babel/generator';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from '../astUtils.js';
import {SandboxEvaluator} from '../SandboxEvaluator.js';
import type {SiteAdapter} from '../SiteAdapterRegistry.js';
import {WrapperFolder} from '../WrapperFolder.js';

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

interface OpcodeTestInfo {
  discriminant: t.Expression;
  discriminantName: string;
  caseValue: t.Expression;
}

function getOpcodeTestInfo(testPath: NodePath): OpcodeTestInfo | null {
  if (!testPath.isBinaryExpression()) {
    return null;
  }
  const node = testPath.node as t.BinaryExpression;
  if (!['===', '=='].includes(node.operator)) {
    return null;
  }

  const leftPath = testPath.get('left') as NodePath;
  const rightPath = testPath.get('right') as NodePath;

  if (leftPath.isNumericLiteral() && rightPath.isIdentifier()) {
    return {
      discriminant: t.cloneNode(rightPath.node) as t.Expression,
      discriminantName: (rightPath.node as t.Identifier).name,
      caseValue: t.cloneNode(leftPath.node) as t.Expression,
    };
  }

  if (rightPath.isNumericLiteral() && leftPath.isIdentifier()) {
    return {
      discriminant: t.cloneNode(leftPath.node) as t.Expression,
      discriminantName: (leftPath.node as t.Identifier).name,
      caseValue: t.cloneNode(rightPath.node) as t.Expression,
    };
  }

  return null;
}

function blockify(node: t.Node | null | undefined): t.Statement[] {
  if (!node) {
    return [];
  }
  if (t.isBlockStatement(node)) {
    return node.body.map(stmt => t.cloneNode(stmt) as t.Statement);
  }
  return [t.cloneNode(node) as t.Statement];
}

function isTerminalStatement(node: t.Statement): boolean {
  return (
    t.isBreakStatement(node) ||
    t.isReturnStatement(node) ||
    t.isThrowStatement(node) ||
    t.isContinueStatement(node)
  );
}

function withTrailingBreak(statements: t.Statement[]): t.Statement[] {
  if (statements.length === 0) {
    return [t.breakStatement()];
  }
  const last = statements[statements.length - 1]!;
  if (isTerminalStatement(last)) {
    return statements;
  }
  return [...statements, t.breakStatement()];
}

function getOpcodeTestInfoFromNode(
  testNode: t.Expression,
): OpcodeTestInfo | null {
  if (!t.isBinaryExpression(testNode)) {
    return null;
  }
  if (!['===', '=='].includes(testNode.operator)) {
    return null;
  }

  if (t.isNumericLiteral(testNode.left) && t.isIdentifier(testNode.right)) {
    return {
      discriminant: t.cloneNode(testNode.right),
      discriminantName: testNode.right.name,
      caseValue: t.cloneNode(testNode.left),
    };
  }

  if (t.isNumericLiteral(testNode.right) && t.isIdentifier(testNode.left)) {
    return {
      discriminant: t.cloneNode(testNode.left),
      discriminantName: testNode.left.name,
      caseValue: t.cloneNode(testNode.right),
    };
  }

  return null;
}

function collectOpcodeCasesFromAlternate(
  node: t.Node | null | undefined,
  discriminantName: string,
  cases: t.SwitchCase[],
): void {
  if (!node) {
    return;
  }

  if (t.isIfStatement(node)) {
    const info = getOpcodeTestInfoFromNode(node.test);

    if (info && info.discriminantName === discriminantName) {
      cases.push(
        t.switchCase(
          info.caseValue,
          withTrailingBreak(blockify(node.consequent)),
        ),
      );
      collectOpcodeCasesFromAlternate(
        node.alternate,
        discriminantName,
        cases,
      );
      return;
    }

    cases.push(
      t.switchCase(null, withTrailingBreak(blockify(node))),
    );
    return;
  }

  if (t.isBlockStatement(node)) {
    for (const stmt of node.body) {
      if (t.isIfStatement(stmt)) {
        const info = getOpcodeTestInfoFromNode(stmt.test);

        if (info && info.discriminantName === discriminantName) {
          cases.push(
            t.switchCase(
              info.caseValue,
              withTrailingBreak(blockify(stmt.consequent)),
            ),
          );
          collectOpcodeCasesFromAlternate(
            stmt.alternate,
            discriminantName,
            cases,
          );
          return;
        }
      }

      cases.push(
        t.switchCase(null, withTrailingBreak([t.cloneNode(stmt) as t.Statement])),
      );
    }
    return;
  }

  cases.push(
    t.switchCase(null, withTrailingBreak([t.cloneNode(node) as t.Statement])),
  );
}

function convertOpcodeIfChains(ast: t.File): boolean {
  let changed = false;

  traverse(ast, {
    IfStatement(path) {
      const info = getOpcodeTestInfo(path.get('test') as NodePath);
      if (!info) {
        return;
      }

      const cases: t.SwitchCase[] = [
        t.switchCase(
          info.caseValue,
          withTrailingBreak(blockify(path.node.consequent)),
        ),
      ];
      collectOpcodeCasesFromAlternate(
        path.node.alternate,
        info.discriminantName,
        cases,
      );
      path.replaceWith(t.switchStatement(info.discriminant, cases));
      path.skip();
      changed = true;
    },
  });

  return changed;
}

function stripPseudoForLoops(ast: t.File): boolean {
  let changed = false;

  traverse(ast, {
    ForStatement(path) {
      const testPath = path.get('test') as NodePath;
      if (
        !testPath.isBinaryExpression() ||
        path.node.update !== null ||
        !(
          (testPath.get('left') as NodePath).isNumericLiteral() ||
          (testPath.get('right') as NodePath).isNumericLiteral()
        )
      ) {
        return;
      }

      if (path.node.init) {
        path.replaceWith(t.cloneNode(path.node.init) as t.Statement);
      } else {
        path.remove();
      }
      changed = true;
    },
  });

  return changed;
}

function xiaohongshuWrapperPass(ast: t.File): {ast: t.File; changed: boolean} {
  let changed = false;
  const body = ast.program.body;
  const evaluator = new SandboxEvaluator();

  if (
    body.length >= 3 &&
    t.isVariableDeclaration(body[1]!) &&
    body[1]!.declarations.length > 0 &&
    t.isIdentifier(body[1]!.declarations[0]!.id)
  ) {
    const sandbox = evaluator.createSandbox();
    const decoderName = body[1]!.declarations[0]!.id.name;

    if (
      evaluator.evaluateNodes(body.slice(0, 3), sandbox) &&
      typeof sandbox[decoderName] === 'function'
    ) {
      ast.program.body = body
        .slice(3)
        .map(node => t.cloneNode(node) as t.Statement);
      changed = true;

      const aliasNames = new Set<string>([decoderName]);
      let progress = false;
      do {
        progress = false;

        traverse(ast, {
          VariableDeclarator(path) {
            if (
              !(path.get('id') as NodePath).isIdentifier() ||
              !(path.get('init') as NodePath).isIdentifier()
            ) {
              return;
            }
            const initName = (
              (path.node as t.VariableDeclarator).init as t.Identifier
            ).name;
            const idName = (
              (path.node as t.VariableDeclarator).id as t.Identifier
            ).name;
            if (aliasNames.has(initName) && !aliasNames.has(idName)) {
              aliasNames.add(idName);
              progress = true;
            }
          },
          CallExpression(path) {
            if (
              !(path.get('callee') as NodePath).isIdentifier() ||
              !aliasNames.has(
                ((path.node as t.CallExpression).callee as t.Identifier).name,
              ) ||
              path.node.arguments.length !== 1
            ) {
              return;
            }
            const argCode = generateCode(path.node.arguments[0]!);
            const result = evaluator.evaluateExpression(
              `${decoderName}(${argCode})`,
              sandbox,
            );
            if (!result.ok) {
              return;
            }
            path.replaceWith(t.valueToNode(result.value));
            progress = true;
            changed = true;
          },
        });
      } while (progress);

      traverse(ast, {
        VariableDeclarator(path) {
          if (
            !(path.get('id') as NodePath).isIdentifier() ||
            !(path.get('init') as NodePath).isIdentifier()
          ) {
            return;
          }
          const idName = (
            (path.node as t.VariableDeclarator).id as t.Identifier
          ).name;
          const initName = (
            (path.node as t.VariableDeclarator).init as t.Identifier
          ).name;
          if (aliasNames.has(idName) && aliasNames.has(initName)) {
            path.remove();
            changed = true;
          }
        },
      });
    }
  }

  const wrapperFolder = new WrapperFolder();
  let localChanged = false;
  do {
    localChanged = wrapperFolder.foldWrapperObjects(ast);
    if (localChanged) {
      changed = true;
    }
  } while (localChanged);

  if (convertOpcodeIfChains(ast)) {
    changed = true;
  }

  if (stripPseudoForLoops(ast)) {
    changed = true;
  }

  return {ast, changed};
}

export class XiaohongshuAdapter implements SiteAdapter {
  readonly patternId = 'xiaohongshu';
  readonly prePasses = [xiaohongshuWrapperPass];
  readonly postPasses = [xiaohongshuWrapperPass];
}
