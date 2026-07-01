/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * VM Protection 去混淆器。提取自 AdvancedDeobfuscator.ts。
 *
 * VM 保护是一种高级混淆技术，将 JavaScript 代码转换为自定义虚拟机指令。
 * 常见 VM 混淆器：JScrambler VM Protection、自定义字节码 VM (如 TikTok 使用的)、
 * Stack-based VM。
 *
 * 反混淆策略：识别 VM 结构 → 提取指令序列 → 符号执行 → 重建控制流 → LLM 辅助。
 */

import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import type {LLMService} from '../../services/LLMService.js';
import {logger} from '../../utils/logger.js';

import {
  extractCodeFromLLMResponse,
  isValidJavaScript,
  truncateCode,
  unwrapBabelDefault,
} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

// VM 解释器的关键特征
const VM_PATTERNS = [
  /while\s*\(\s*true\s*\)\s*\{[\s\S]*?switch\s*\(/i,
  /var\s+\w+\s*=\s*\[\s*\d+(?:\s*,\s*\d+){10,}\s*\]/i,
  /\w+\[pc\+\+\]/i,
  /stack\.push|stack\.pop/i,
];

export interface VMDeobfuscateResult {
  success: boolean;
  code: string;
}

export interface VMDetectionInfo {
  detected: boolean;
  type: string;
  instructionCount: number;
}

export interface VMStructure {
  hasInterpreter: boolean;
  instructionTypes: string[];
  hasStack: boolean;
  hasRegisters: boolean;
}

export interface VMComponents {
  instructionArray?: string;
  dataArray?: string;
  interpreterFunction?: string;
}

export class VMProtectionDeobfuscator {
  constructor(private llm?: LLMService) {}

  /**
   * 检测 VM 保护
   */
  static detectVMProtection(code: string): VMDetectionInfo {
    const matchCount = VM_PATTERNS.filter(pattern => pattern.test(code)).length;

    if (matchCount >= 2) {
      return {
        detected: true,
        type: matchCount >= 3 ? 'custom-vm' : 'simple-vm',
        instructionCount: VMProtectionDeobfuscator.countVMInstructions(code),
      };
    }

    return {detected: false, type: 'none', instructionCount: 0};
  }

  /**
   * 统计 VM 指令数量
   */
  static countVMInstructions(code: string): number {
    const match = code.match(/case\s+\d+:/g);
    return match ? match.length : 0;
  }

  /**
   * VM 反混淆
   */
  async deobfuscateVM(
    code: string,
    vmInfo: {type: string; instructionCount: number},
  ): Promise<VMDeobfuscateResult> {
    logger.warn('VM deobfuscation is experimental and may fail');

    try {
      // 第一步: 尝试识别 VM 结构
      const vmStructure = VMProtectionDeobfuscator.analyzeVMStructure(code);

      if (vmStructure.hasInterpreter) {
        logger.info(
          `Detected VM interpreter with ${vmStructure.instructionTypes.length} instruction types`,
        );
      }

      // 第二步: 提取关键 VM 组件
      const vmComponents = VMProtectionDeobfuscator.extractVMComponents(code);

      // 第三步: 使用 LLM 辅助理解 VM 逻辑 (优化后的提示词)
      if (this.llm) {
        const prompt = this.buildVMDeobfuscationPrompt(
          code,
          vmInfo,
          vmStructure,
          vmComponents,
        );

        const response = await this.llm.chat(
          [
            {
              role: 'system',
              content: `# Role
You are a world-class expert in JavaScript VM deobfuscation and reverse engineering with expertise in:
- Virtual machine architecture and instruction set design
- Bytecode interpretation and JIT compilation
- Control flow reconstruction from VM instructions
- Stack-based and register-based VM analysis
- Obfuscation techniques used by TikTok, Shopee, and commercial protectors

# Task
Analyze VM-protected JavaScript code and reconstruct the original, readable JavaScript.

# Methodology
1. **Identify VM Components**: Locate instruction array, interpreter loop, stack/registers
2. **Decode Instructions**: Map VM opcodes to JavaScript operations
3. **Reconstruct Control Flow**: Convert VM jumps/branches to if/while/for
4. **Simplify**: Remove VM overhead and restore natural code structure
5. **Validate**: Ensure output is syntactically valid and functionally equivalent

# Critical Requirements
- Output ONLY valid, executable JavaScript (no markdown, no explanations)
- Preserve exact program logic and side effects
- Use meaningful variable names based on context
- Add brief comments for complex patterns
- Do NOT hallucinate or guess functionality
- If uncertain, preserve original code structure

# Output Format
Return clean JavaScript code without any wrapper or formatting.`,
            },
            {role: 'user', content: prompt},
          ],
          {
            temperature: 0.05, // 极低温度以获得最确定性的输出
            maxTokens: 4000,
          },
        );

        // 验证 LLM 输出是否是有效的 JavaScript
        const deobfuscatedCode = extractCodeFromLLMResponse(response.content);

        if (isValidJavaScript(deobfuscatedCode)) {
          logger.success('VM deobfuscation succeeded via LLM');
          return {
            success: true,
            code: deobfuscatedCode,
          };
        } else {
          logger.warn(
            'LLM output is not valid JavaScript, falling back to original',
          );
        }
      }

      // 第四步: 如果 LLM 失败，尝试基于规则的简化
      const simplifiedCode = VMProtectionDeobfuscator.simplifyVMCode(
        code,
        vmComponents,
      );

      return {
        success: simplifiedCode !== code,
        code: simplifiedCode,
      };
    } catch (error) {
      logger.error('VM deobfuscation failed', error);
      return {success: false, code};
    }
  }

  /**
   * 分析 VM 结构
   */
  static analyzeVMStructure(code: string): VMStructure {
    const structure: VMStructure = {
      hasInterpreter: false,
      instructionTypes: [] as string[],
      hasStack: false,
      hasRegisters: false,
    };

    // 检测解释器循环模式
    if (/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(code)) {
      structure.hasInterpreter = true;
    }

    // 检测指令分发模式 (switch-case)
    const switchMatches = code.match(/case\s+0x[0-9a-f]+:/gi);
    if (switchMatches && switchMatches.length > 10) {
      structure.hasInterpreter = true;
      structure.instructionTypes = switchMatches.map(m =>
        m.replace(/case\s+/i, '').replace(/:/, ''),
      );
    }

    // 检测栈操作
    if (/\.push\(|\.pop\(/.test(code)) {
      structure.hasStack = true;
    }

    // 检测寄存器模式
    if (/r\d+\s*=|reg\[\d+\]/.test(code)) {
      structure.hasRegisters = true;
    }

    return structure;
  }

  /**
   * 提取 VM 组件
   */
  static extractVMComponents(code: string): VMComponents {
    const components: any = {};

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      traverse(ast, {
        // 查找大型数组 (可能是指令或数据)
        VariableDeclarator(path: any) {
          if (t.isArrayExpression(path.node.init)) {
            const arrayLength = path.node.init.elements.length;

            if (arrayLength > 50) {
              const arrayName = t.isIdentifier(path.node.id)
                ? path.node.id.name
                : 'unknown';

              // 检查数组内容类型
              const firstElement = path.node.init.elements[0];
              if (t.isNumericLiteral(firstElement)) {
                components.instructionArray = arrayName;
              } else if (t.isStringLiteral(firstElement)) {
                components.dataArray = arrayName;
              }
            }
          }
        },

        // 查找解释器函数 (包含大型 switch 语句)
        FunctionDeclaration(path: any) {
          let hasBigSwitch = false;

          traverse(
            path.node,
            {
              SwitchStatement(switchPath: any) {
                if (switchPath.node.cases.length > 10) {
                  hasBigSwitch = true;
                }
              },
            },
            path.scope,
            path,
          );

          if (hasBigSwitch && t.isIdentifier(path.node.id)) {
            components.interpreterFunction = path.node.id.name;
          }
        },
      });
    } catch (error) {
      logger.debug('Failed to extract VM components:', error);
    }

    return components;
  }

  /**
   * 构建 VM 反混淆提示词
   */
  private buildVMDeobfuscationPrompt(
    code: string,
    vmInfo: {type: string; instructionCount: number},
    vmStructure: VMStructure,
    vmComponents: VMComponents,
  ): string {
    const codeSnippet = truncateCode(code, 6000);

    return `# VM Deobfuscation Analysis

## VM Profile
- **Architecture**: ${vmInfo.type}
- **Instruction Count**: ${vmInfo.instructionCount}
- **Interpreter Loop**: ${vmStructure.hasInterpreter ? 'Detected' : 'Not detected'}
- **Stack Operations**: ${vmStructure.hasStack ? 'Present' : 'Absent'}
- **Register Usage**: ${vmStructure.hasRegisters ? 'Present' : 'Absent'}
- **Instruction Variety**: ${vmStructure.instructionTypes.length} distinct types

## Identified Components
${vmComponents.instructionArray ? `✓ Instruction Array: Found at ${vmComponents.instructionArray}` : '✗ Instruction Array: Not found'}
${vmComponents.dataArray ? `✓ Data Array: Found at ${vmComponents.dataArray}` : '✗ Data Array: Not found'}
${vmComponents.interpreterFunction ? `✓ Interpreter Function: Found at ${vmComponents.interpreterFunction}` : '✗ Interpreter Function: Not found'}

## VM-Protected Code
\`\`\`javascript
${codeSnippet}
\`\`\`

## Deobfuscation Instructions (Chain-of-Thought)

### Step 1: VM Structure Analysis
Examine the code to identify:
- Instruction array (usually a large array of numbers/strings)
- Interpreter loop (while/for loop processing instructions)
- Stack/register variables
- Opcode handlers (switch-case or if-else chains)

### Step 2: Instruction Decoding
For each instruction type, determine:
- What JavaScript operation it represents (e.g., opcode 0x01 = addition)
- How it manipulates the stack/registers
- What side effects it has (function calls, property access, etc.)

### Step 3: Control Flow Reconstruction
- Map VM jumps/branches to JavaScript if/while/for statements
- Identify function calls and returns
- Reconstruct try-catch blocks if present

### Step 4: Code Generation
- Replace VM instruction sequences with equivalent JavaScript
- Use meaningful variable names based on usage context
- Remove VM overhead (interpreter loop, stack management)
- Preserve all side effects and program behavior

### Step 5: Validation
- Ensure output is syntactically valid JavaScript
- Verify no functionality is lost
- Add comments for complex patterns

## Example Transformation (Few-shot Learning)

**VM Code (Before)**:
\`\`\`javascript
var vm = [0x01, 0x05, 0x02, 0x03, 0x10];
var stack = [];
for(var i=0; i<vm.length; i++) {
  switch(vm[i]) {
    case 0x01: stack.push(5); break;
    case 0x02: stack.push(3); break;
    case 0x10: var b=stack.pop(), a=stack.pop(); stack.push(a+b); break;
  }
}
console.log(stack[0]);
\`\`\`

**Deobfuscated Code (After)**:
\`\`\`javascript
// VM instructions decoded: PUSH 5, PUSH 3, ADD
var result = 5 + 3;
console.log(result);
\`\`\`

## Critical Requirements
1. Output ONLY the deobfuscated JavaScript code
2. NO markdown code blocks, NO explanations, NO comments outside the code
3. Code must be syntactically valid and executable
4. Preserve exact program logic and side effects
5. If full deobfuscation is impossible, return the best partial result

## Output Format
Return clean JavaScript code starting immediately (no preamble).`;
  }

  /**
   * 简化 VM 代码 (基于规则)
   */
  static simplifyVMCode(code: string, vmComponents: VMComponents): string {
    try {
      let simplified = code;

      // 移除 VM 解释器函数 (如果能识别)
      if (vmComponents.interpreterFunction) {
        const regex = new RegExp(
          `function\\s+${vmComponents.interpreterFunction}\\s*\\([^)]*\\)\\s*\\{[^}]*\\}`,
          'g',
        );
        simplified = simplified.replace(regex, '// VM interpreter removed');
      }

      // 移除大型指令数组
      if (vmComponents.instructionArray) {
        const regex = new RegExp(
          `var\\s+${vmComponents.instructionArray}\\s*=\\s*\\[[^\\]]*\\];`,
          'g',
        );
        simplified = simplified.replace(
          regex,
          '// VM instruction array removed',
        );
      }

      return simplified;
    } catch (error) {
      logger.debug('Failed to simplify VM code:', error);
      return code;
    }
  }
}
