/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Control Flow Flattening 去混淆器。提取自 AdvancedDeobfuscator.ts。
 *
 * 控制流平坦化是常见混淆技术，使用优化的提示词进行 LLM 辅助反混淆。
 */

import type {LLMService} from '../../services/LLMService.js';
import {logger} from '../../utils/logger.js';

import {extractCodeFromLLMResponse, truncateCode} from './astUtils.js';

// 控制流平坦化特征
const CONTROL_FLOW_FLATTEN_PATTERN =
  /while\s*\(\s*!!\s*\[\s*\]\s*\)\s*\{[\s\S]*?switch\s*\(/i;

export class ControlFlowDeobfuscator {
  constructor(private llm?: LLMService) {}

  /**
   * 检测控制流平坦化
   */
  static detectControlFlowFlattening(code: string): boolean {
    return CONTROL_FLOW_FLATTEN_PATTERN.test(code);
  }

  /**
   * 还原控制流 - 优化版
   *
   * 控制流平坦化(Control Flow Flattening)是常见的混淆技术
   * 使用优化的提示词进行LLM辅助反混淆
   */
  async unflattenControlFlow(code: string): Promise<string> {
    logger.info('Unflattening control flow...');

    if (!this.llm) return code;

    try {
      const codeSnippet = truncateCode(code, 3000);

      const response = await this.llm.chat(
        [
          {
            role: 'system',
            content: `# Role
You are an expert in JavaScript control flow deobfuscation specializing in:
- Control flow flattening detection and removal
- Switch-case state machine analysis
- Dispatcher loop identification
- Control flow graph (CFG) reconstruction

# Task
Analyze control flow flattened JavaScript and reconstruct the original, natural control flow.

# Control Flow Flattening Pattern
Obfuscators replace normal if/while/for with a dispatcher loop:
\`\`\`javascript
// Flattened (obfuscated)
var state = '0';
while (true) {
  switch (state) {
    case '0': console.log('a'); state = '1'; break;
    case '1': console.log('b'); state = '2'; break;
    case '2': return;
  }
}

// Original (deobfuscated)
console.log('a');
console.log('b');
return;
\`\`\`

# Requirements
- Output ONLY valid JavaScript code
- Preserve exact program logic
- Remove dispatcher loops and state variables
- Restore natural if/while/for structures
- Use meaningful variable names`,
          },
          {
            role: 'user',
            content: `# Control Flow Flattened Code
\`\`\`javascript
${codeSnippet}
\`\`\`

# Instructions
1. Identify the dispatcher loop (while/for with switch-case)
2. Trace state transitions to determine execution order
3. Reconstruct original control flow (if/while/for)
4. Remove state variables and dispatcher overhead
5. Return ONLY the deobfuscated code (no explanations)

Output the deobfuscated JavaScript code:`,
          },
        ],
        {
          temperature: 0.1,
          maxTokens: 3000,
        },
      );

      return extractCodeFromLLMResponse(response.content);
    } catch (error) {
      logger.warn('LLM control flow unflattening failed', error);
    }

    return code;
  }
}
