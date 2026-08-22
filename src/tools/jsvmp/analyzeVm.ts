/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * analyze_jsvmp_vm —— JSVMP 虚拟机静态分析工具。
 *
 * 与 JSVMPDeobfuscator 互补：后者聚焦「反混淆/还原代码」，
 * 本工具聚焦「解剖 VM 骨架」——分派结构、字节码数组来源、
 * 指令表（含空洞）、opcode 语义粗分类，输出结构化 JSON
 * 供 skill 编排后续步骤（解密、探针、还原）。
 */

import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {unwrapBabelDefault} from '../../modules/deobfuscator/astUtils.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {getDebuggerFromContext} from '../debugger/runtime-helpers.js';
import {errorMessage} from '../shared/pageResponse.js';
import {defineTool, type Context} from '../ToolDefinition.js';

const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

type VmOpType =
  | 'load'
  | 'store'
  | 'arithmetic'
  | 'control'
  | 'call'
  | 'unknown';

interface VmDispatcherInfo {
  kind: 'while-switch' | 'index-dispatch' | 'switch-only';
  switchCount: number;
  maxSwitchCases: number;
  whileTrueCount: number;
  /** 取指表达式源码，例如 B[Codes[PC++]] */
  dispatchExpression?: string;
  dispatcherLine?: number;
}

interface BytecodeInfo {
  kind: 'array-literal' | 'iife' | 'none';
  length?: number;
  encrypted: boolean;
  line?: number;
}

interface InstructionTableInfo {
  kind: 'array-literal' | 'none';
  length: number;
  holes: number;
  line?: number;
}

interface JsvmpOpcode {
  id: number | string;
  type: VmOpType;
  line?: number;
}

interface JsvmpVmAnalysis {
  isJsvmp: boolean;
  confidence: number;
  dispatcher?: VmDispatcherInfo;
  bytecode?: BytecodeInfo;
  instructionTable?: InstructionTableInfo;
  opcodes: JsvmpOpcode[];
  nextSteps: string[];
}

const BINARY_ARITHMETIC_OPS = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '^',
  '&',
  '|',
  '<<',
  '>>',
  '>>>',
]);

function nodeLine(node: t.Node | null | undefined): number | undefined {
  return node?.loc?.start.line;
}

function classifyFunction(
  fn: t.Function | t.ArrowFunctionExpression,
): VmOpType {
  const body = fn.body;
  const statements = t.isBlockStatement(body) ? body.body : [];
  let hasArithmetic = false;
  let hasApplyCall = false;
  let hasControl = false;
  let hasStackOp = false;
  let hasCall = false;

  for (const stmt of statements) {
    if (
      t.isIfStatement(stmt) ||
      t.isWhileStatement(stmt) ||
      t.isForStatement(stmt) ||
      t.isBreakStatement(stmt) ||
      t.isContinueStatement(stmt) ||
      t.isReturnStatement(stmt)
    ) {
      hasControl = true;
    }
    if (t.isExpressionStatement(stmt) && t.isCallExpression(stmt.expression)) {
      hasCall = true;
      const callee = stmt.expression.callee;
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.property) &&
        (callee.property.name === 'apply' || callee.property.name === 'call')
      ) {
        hasApplyCall = true;
      }
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.property) &&
        (callee.property.name === 'push' || callee.property.name === 'pop')
      ) {
        hasStackOp = true;
      }
    }
    if (t.isExpressionStatement(stmt)) {
      const expr = stmt.expression;
      if (t.isAssignmentExpression(expr) || t.isBinaryExpression(expr)) {
        if (
          t.isBinaryExpression(expr) &&
          BINARY_ARITHMETIC_OPS.has(expr.operator)
        ) {
          hasArithmetic = true;
        }
      }
    }
  }

  if (hasApplyCall || hasStackOp) return 'call';
  if (hasArithmetic) return 'arithmetic';
  if (hasControl) return 'control';
  if (hasCall) return 'call';
  return 'unknown';
}

function classifySwitchCase(caseNode: t.SwitchCase): VmOpType {
  let hasArithmetic = false;
  let hasControl = false;
  let hasCall = false;
  let hasAssignment = false;

  for (const stmt of caseNode.consequent) {
    if (
      t.isIfStatement(stmt) ||
      t.isBreakStatement(stmt) ||
      t.isContinueStatement(stmt) ||
      t.isReturnStatement(stmt)
    ) {
      hasControl = true;
    }
    if (t.isExpressionStatement(stmt)) {
      const expr = stmt.expression;
      if (t.isCallExpression(expr)) hasCall = true;
      if (t.isAssignmentExpression(expr)) hasAssignment = true;
      if (
        t.isBinaryExpression(expr) &&
        BINARY_ARITHMETIC_OPS.has(expr.operator)
      ) {
        hasArithmetic = true;
      }
    }
  }

  if (hasArithmetic) return 'arithmetic';
  if (hasControl) return 'control';
  if (hasCall) return 'call';
  if (hasAssignment) return 'store';
  return 'load';
}

function extractOpcodeLabel(
  test: t.Expression | null,
  index: number,
): number | string {
  if (t.isNumericLiteral(test)) return test.value;
  if (t.isStringLiteral(test)) return test.value;
  return index;
}

/**
 * 在 AST 中定位 VM 分派结构。
 * - while(true) + switch 大循环
 * - 取指表达式 arr[idx++] 或 B[n[++h]]() 的 CallExpression
 */
function findDispatcher(
  ast: t.File,
  switchCases: t.SwitchCase[],
): {dispatcher?: VmDispatcherInfo; switchCases: t.SwitchCase[]} {
  let whileTrueCount = 0;
  let switchCount = 0;
  let maxSwitchCases = 0;
  let dispatchExpression: string | undefined;
  let dispatcherLine: number | undefined;

  traverse(ast, {
    WhileStatement(path) {
      const test = path.node.test;
      if (
        (t.isBooleanLiteral(test) && test.value === true) ||
        (t.isNumericLiteral(test) && test.value === 1)
      ) {
        whileTrueCount += 1;
      }
    },
    SwitchStatement(path) {
      const count = path.node.cases.length;
      if (count > 3) {
        switchCount += 1;
        if (count > maxSwitchCases) maxSwitchCases = count;
      }
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        !t.isMemberExpression(callee) ||
        !t.isMemberExpression(callee.property)
      ) {
        return;
      }
      const inner = callee.property;
      if (
        t.isUpdateExpression(inner.property, {operator: '++'}) ||
        t.isUpdateExpression(inner.property, {operator: '--'})
      ) {
        if (!dispatchExpression) {
          dispatchExpression = callee.toString();
          dispatcherLine = nodeLine(path.node);
        }
        return;
      }
      if (
        t.isBinaryExpression(inner.property) &&
        inner.property.operator === '+'
      ) {
        if (!dispatchExpression) {
          dispatchExpression = callee.toString();
          dispatcherLine = nodeLine(path.node);
        }
      }
    },
  });

  let kind: VmDispatcherInfo['kind'];
  if (dispatchExpression && whileTrueCount > 0) {
    kind = 'while-switch';
  } else if (dispatchExpression) {
    kind = 'index-dispatch';
  } else if (switchCount > 0) {
    kind = 'switch-only';
  } else {
    return {switchCases};
  }

  return {
    switchCases,
    dispatcher: {
      kind,
      switchCount,
      maxSwitchCases,
      whileTrueCount,
      dispatchExpression,
      dispatcherLine,
    },
  };
}

/** 分析字节码数组与指令表：大数组字面量 / IIFE 解密产出。 */
function findBytecodeAndTable(ast: t.File): {
  bytecode?: BytecodeInfo;
  instructionTable?: InstructionTableInfo;
} {
  let bytecode: BytecodeInfo | undefined;
  let instructionTable: InstructionTableInfo | undefined;
  let hasParseIntPattern = false;

  traverse(ast, {
    VariableDeclarator(path) {
      const init = path.node.init;
      if (!init) return;

      // IIFE 解密产出：自执行函数体内构建大数组（可能 return 变量而非字面量）
      if (
        t.isCallExpression(init) &&
        (t.isFunctionExpression(init.callee) ||
          t.isArrowFunctionExpression(init.callee))
      ) {
        let innerArray: t.ArrayExpression | undefined;
        path.traverse({
          ArrayExpression(inner) {
            if (inner.node.elements.length > 20 && !innerArray) {
              innerArray = inner.node;
            }
          },
        });
        if (innerArray && !bytecode) {
          bytecode = {
            kind: 'iife',
            length: innerArray.elements.length,
            encrypted: true,
            line: nodeLine(innerArray),
          };
        }
        return;
      }

      if (!t.isArrayExpression(init)) return;
      const arr = init;
      const elements = arr.elements;

      // 指令表：元素大部分是函数（允许 ,, 空洞）——小表也识别
      const functionCount = elements.filter(
        el => el && (t.isFunction(el) || t.isArrowFunctionExpression(el)),
      ).length;
      const holes = elements.filter(el => el === null).length;
      if (elements.length >= 4 && functionCount >= elements.length * 0.5) {
        if (!instructionTable) {
          instructionTable = {
            kind: 'array-literal',
            length: elements.length,
            holes,
            line: nodeLine(arr),
          };
        }
        return;
      }

      // 字节码数组：数字/字符串字面量为主
      if (elements.length < 20) return;
      const literalCount = elements.filter(
        el => el && (t.isNumericLiteral(el) || t.isStringLiteral(el)),
      ).length;
      if (literalCount >= elements.length * 0.7 && !bytecode) {
        bytecode = {
          kind: 'array-literal',
          length: elements.length,
          encrypted: false,
          line: nodeLine(arr),
        };
      }
    },
    CallExpression(path) {
      // parseInt("" + b[O] + b[O+1], 16) —— 字节码按字节拼接的经典模式
      if (
        t.isIdentifier(path.node.callee, {name: 'parseInt'}) &&
        path.node.arguments.length >= 2 &&
        t.isBinaryExpression(path.node.arguments[0]) &&
        path.node.arguments[0].operator === '+'
      ) {
        hasParseIntPattern = true;
      }
    },
  });

  if (hasParseIntPattern) {
    // parseInt 拼接意味着字节码被编码/加密，非纯字面量数组
    if (bytecode) {
      bytecode = {...bytecode, encrypted: true};
    } else {
      bytecode = {kind: 'array-literal', encrypted: true};
    }
  }

  return {bytecode, instructionTable};
}

/** 对指令表函数（或 switch case）做 opcode 语义粗分类。 */
function extractOpcodes(
  ast: t.File,
  switchCases: t.SwitchCase[],
  instructionTable?: InstructionTableInfo,
): JsvmpOpcode[] {
  const opcodes: JsvmpOpcode[] = [];

  // 优先指令表函数数组（只取第一个，与 findBytecodeAndTable 语义一致）
  if (instructionTable) {
    traverse(ast, {
      VariableDeclarator(path) {
        const init = path.node.init;
        if (!t.isArrayExpression(init)) return;
        const functions = init.elements.filter(
          (el): el is t.FunctionExpression | t.ArrowFunctionExpression =>
            el !== null &&
            (t.isFunction(el) || t.isArrowFunctionExpression(el)),
        );
        if (
          init.elements.length < 4 ||
          functions.length < init.elements.length * 0.5
        ) {
          return;
        }
        for (const fn of functions) {
          opcodes.push({
            id: opcodes.length,
            type: classifyFunction(fn),
            line: nodeLine(fn),
          });
        }
        path.stop();
      },
    });
    if (opcodes.length > 0) return opcodes;
  }

  // 回退：switch case 作为 opcode 表
  if (switchCases.length > 0) {
    switchCases.forEach((caseNode, index) => {
      opcodes.push({
        id: extractOpcodeLabel(caseNode.test, index),
        type: classifySwitchCase(caseNode),
        line: nodeLine(caseNode),
      });
    });
    return opcodes;
  }

  return opcodes;
}

function buildNextSteps(
  analysis: Omit<JsvmpVmAnalysis, 'nextSteps'>,
): string[] {
  const steps: string[] = [];
  if (!analysis.isJsvmp) {
    steps.push(
      '未检出明显 JSVMP 特征；可改用 deobfuscate_code 判断是否为其他混淆（obfuscator.io/jsFuck 等）。',
    );
    return steps;
  }
  if (analysis.bytecode?.encrypted) {
    steps.push(
      '字节码疑似加密/编码（IIFE 解密或 parseInt 拼接）：用 evaluate_script 在页面执行解密函数拿到明文大数组，再喂回本工具。',
    );
  }
  if (analysis.instructionTable?.holes) {
    steps.push(
      `指令表含 ${analysis.instructionTable.holes} 个空洞，疑似乱序重排（TDC 风格）：还原时需按映射表重排，勿按数组下标直读。`,
    );
  }
  if (analysis.dispatcher?.dispatchExpression) {
    steps.push(
      `分派表达式 ${analysis.dispatcher.dispatchExpression}：用 hook_jsvmp_interpreter 探针记录该 VM 运行时的环境访问与调用轨迹（数据落 window.__mcp_jsvmp_log）。`,
    );
  }
  steps.push(
    '对依赖环境的 VM（如 CF 5s 校验）：用 compare_env 采集浏览器环境基准，判断是否需补环境而非还原算法。',
  );
  steps.push(
    '还原验证：跑多组真实实参比对签名结果；纯算场景参考 scripts/ast-instrument-template.js 插桩还原。',
  );
  return steps;
}

export function analyzeJsvmpVmCode(code: string): JsvmpVmAnalysis {
  const empty: JsvmpVmAnalysis = {
    isJsvmp: false,
    confidence: 0,
    opcodes: [],
    nextSteps: [],
  };
  let ast: t.File;
  try {
    ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
  } catch {
    empty.nextSteps = [
      '源码无法解析（可能被截断或含非 JS 语法），请提供完整脚本源码。',
    ];
    return empty;
  }

  // 收集大 switch 的 case（阈值与 findDispatcher 的 switchCount 保持一致）
  let switchCases: t.SwitchCase[] = [];
  traverse(ast, {
    SwitchStatement(path) {
      if (path.node.cases.length > 3 && !switchCases.length) {
        switchCases = path.node.cases;
      }
    },
  });

  const {dispatcher} = findDispatcher(ast, switchCases);
  const {bytecode, instructionTable} = findBytecodeAndTable(ast);
  const opcodes = extractOpcodes(ast, switchCases, instructionTable);

  // 置信度：多信号加权累计（静态启发式，best-effort）
  let confidence = 0;
  if (dispatcher) {
    // 分派结构是 VM 核心，加权最高
    if (dispatcher.kind === 'while-switch') confidence += 0.5;
    else if (dispatcher.kind === 'index-dispatch') confidence += 0.4;
    else confidence += 0.3;
  }
  if (instructionTable) confidence += 0.4; // 函数大数组是 JSVMP 特有结构
  if (bytecode) {
    confidence += bytecode.encrypted ? 0.25 : 0.15;
    if (bytecode.kind === 'iife') confidence += 0.05;
  }
  confidence = Math.min(1, confidence);
  const isJsvmp = confidence >= 0.6;

  const analysis: JsvmpVmAnalysis = {
    isJsvmp,
    confidence,
    dispatcher,
    bytecode,
    instructionTable,
    opcodes,
    nextSteps: [],
  };
  analysis.nextSteps = buildNextSteps(analysis);
  return analysis;
}

export const analyzeJsvmpVm = defineTool({
  name: 'analyze_jsvmp_vm',
  description:
    '静态分析 JSVMP 虚拟机骨架：分派结构、字节码数组来源（字面量/IIFE 解密）、指令表（含空洞）、opcode 语义粗分类。',
  annotations: {
    title: 'Analyze JSVMP VM',
    category: ToolCategory.REVERSE_ENGINEERING,
    readOnlyHint: true,
  },
  schema: {
    code: zod.string().optional().describe('要分析的 JavaScript 源码'),
    scriptId: zod
      .string()
      .optional()
      .describe('调试会话中的脚本 ID（用于直接获取对应脚本源码分析）'),
  },
  handler: async (request, response, context: Context) => {
    try {
      const {code, scriptId} = request.params as {
        code?: string;
        scriptId?: string;
      };
      let targetCode = code;

      if (scriptId) {
        const debuggerContext = await getDebuggerFromContext(context);
        targetCode = await debuggerContext.getScriptSource(scriptId);
        if (targetCode === null || targetCode === undefined) {
          throw new Error(`未找到脚本 ID 为 ${scriptId} 的源码`);
        }
      } else if (targetCode === undefined || targetCode === null) {
        throw new Error('必须提供 code 或 scriptId 参数之一');
      }

      const data = analyzeJsvmpVmCode(targetCode);
      response.setStructuredContent({
        success: true,
        message: data.isJsvmp
          ? `检出 JSVMP 特征，置信度 ${Math.round(data.confidence * 100)}%`
          : '未检出明显 JSVMP 特征',
        tooltype: 'analyze_jsvmp_vm',
        data,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw createToolError(
        ErrorCodes.RUNTIME,
        `JSVMP VM 分析失败：${errorMessage(error)}`,
        {toolName: 'analyze_jsvmp_vm'},
      );
    }
  },
});
