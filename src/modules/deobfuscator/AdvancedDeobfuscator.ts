/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 高级反混淆模块 - 支持2024-2025最新混淆技术
 *
 * 门面 + 策略模式：本文件作为门面，按混淆技术分发到对应策略模块。
 *
 * 支持的混淆类型（每种一个策略文件）:
 * 1. Invisible Unicode Obfuscation (2025新技术) → InvisibleUnicodeDeobfuscator
 * 2. VM Protection (虚拟机保护) → VMProtectionDeobfuscator
 * 3. Control Flow Flattening (控制流平坦化) → ControlFlowDeobfuscator
 * 4. String Array Rotation (字符串数组旋转) → StringArrayDeobfuscator
 * 5. Dead Code Injection (死代码注入) → DeadCodeDeobfuscator
 * 6. Opaque Predicates (不透明谓词) → OpaquePredicateDeobfuscator
 * 7. Custom Obfuscators (魔改混淆器) → LLM 辅助
 */

import type {LLMService} from '../../services/LLMService.js';
import {logger} from '../../utils/logger.js';

import {
  applyASTOptimizations,
  estimateCodeComplexity,
  extractCodeFromLLMResponse,
  isValidJavaScript,
  normalizeCode,
  truncateCode,
} from './astUtils.js';
import {ControlFlowDeobfuscator} from './ControlFlowDeobfuscator.js';
import {DeadCodeDeobfuscator} from './DeadCodeDeobfuscator.js';
import {InvisibleUnicodeDeobfuscator} from './InvisibleUnicodeDeobfuscator.js';
import {OpaquePredicateDeobfuscator} from './OpaquePredicateDeobfuscator.js';
import {StringArrayDeobfuscator} from './StringArrayDeobfuscator.js';
import {VMProtectionDeobfuscator} from './VMProtectionDeobfuscator.js';

export interface AdvancedDeobfuscateOptions {
  code: string;
  detectOnly?: boolean; // 仅检测混淆类型
  aggressiveVM?: boolean; // 激进VM反混淆
  useASTOptimization?: boolean; // 使用AST优化
  timeout?: number; // 超时时间（毫秒）
}

export interface AdvancedDeobfuscateResult {
  code: string;
  detectedTechniques: string[];
  confidence: number;
  warnings: string[];
  astOptimized?: boolean; // AST是否被优化
  vmDetected?: {
    type: string;
    instructions: number;
    deobfuscated: boolean;
  };
}

export class AdvancedDeobfuscator {
  private llm?: LLMService;

  constructor(llm?: LLMService) {
    this.llm = llm;
  }

  /**
   * 高级反混淆入口
   */
  async deobfuscate(
    options: AdvancedDeobfuscateOptions,
  ): Promise<AdvancedDeobfuscateResult> {
    logger.info('Starting advanced deobfuscation...');
    const startTime = Date.now();

    let code = options.code;
    const detectedTechniques: string[] = [];
    const warnings: string[] = [];
    let vmDetected: AdvancedDeobfuscateResult['vmDetected'];
    let astOptimized = false;

    // 策略实例（LLM 辅助类技术在需要时构造）
    const vmDeobfuscator = new VMProtectionDeobfuscator(this.llm);
    const controlFlowDeobfuscator = new ControlFlowDeobfuscator(this.llm);

    try {
      // 0. 预处理：标准化代码格式
      code = normalizeCode(code);

      // 1. 检测Invisible Unicode混淆
      if (InvisibleUnicodeDeobfuscator.detectInvisibleUnicode(code)) {
        detectedTechniques.push('invisible-unicode');
        logger.info('Detected: Invisible Unicode Obfuscation (2025)');
        code = InvisibleUnicodeDeobfuscator.decodeInvisibleUnicode(code);
      }

      // 2. 检测和移除字符串编码
      if (InvisibleUnicodeDeobfuscator.detectStringEncoding(code)) {
        detectedTechniques.push('string-encoding');
        logger.info('Detected: String Encoding');
        code = InvisibleUnicodeDeobfuscator.decodeStrings(code);
      }

      // 3. 检测VM保护
      const vmInfo = VMProtectionDeobfuscator.detectVMProtection(code);
      if (vmInfo.detected) {
        detectedTechniques.push('vm-protection');
        logger.info(`Detected: VM Protection (${vmInfo.type})`);
        vmDetected = {
          type: vmInfo.type,
          instructions: vmInfo.instructionCount,
          deobfuscated: false,
        };

        if (options.aggressiveVM) {
          const vmResult = await vmDeobfuscator.deobfuscateVM(code, vmInfo);
          if (vmResult.success) {
            code = vmResult.code;
            vmDetected.deobfuscated = true;
          } else {
            warnings.push('VM deobfuscation failed, code may be incomplete');
          }
        }
      }

      // 4. 检测控制流平坦化
      if (ControlFlowDeobfuscator.detectControlFlowFlattening(code)) {
        detectedTechniques.push('control-flow-flattening');
        logger.info('Detected: Control Flow Flattening');
        code = await controlFlowDeobfuscator.unflattenControlFlow(code);
      }

      // 5. 检测字符串数组旋转
      if (StringArrayDeobfuscator.detectStringArrayRotation(code)) {
        detectedTechniques.push('string-array-rotation');
        logger.info('Detected: String Array Rotation');
        code = StringArrayDeobfuscator.derotateStringArray(code);
      }

      // 6. 检测死代码注入
      if (DeadCodeDeobfuscator.detectDeadCodeInjection(code)) {
        detectedTechniques.push('dead-code-injection');
        logger.info('Detected: Dead Code Injection');
        code = DeadCodeDeobfuscator.removeDeadCode(code);
      }

      // 7. 检测不透明谓词
      if (OpaquePredicateDeobfuscator.detectOpaquePredicates(code)) {
        detectedTechniques.push('opaque-predicates');
        logger.info('Detected: Opaque Predicates');
        code = OpaquePredicateDeobfuscator.removeOpaquePredicates(code);
      }

      // 8. AST优化（常量折叠、表达式简化）
      if (options.useASTOptimization !== false) {
        logger.info('Applying AST optimizations...');
        const optimized = applyASTOptimizations(code);
        if (optimized !== code) {
          code = optimized;
          astOptimized = true;
          detectedTechniques.push('ast-optimized');
        }
      }

      // 9. 使用LLM进行最终清理
      if (this.llm && detectedTechniques.length > 0) {
        logger.info('Using LLM for final cleanup...');
        const llmResult = await this.llmCleanup(code, detectedTechniques);
        if (llmResult) {
          code = llmResult;
        }
      }

      const duration = Date.now() - startTime;
      const confidence = this.calculateConfidence(
        detectedTechniques,
        warnings,
        code,
      );

      logger.success(`Advanced deobfuscation completed in ${duration}ms`);

      return {
        code,
        detectedTechniques,
        confidence,
        warnings,
        vmDetected,
        astOptimized,
      };
    } catch (error) {
      logger.error('Advanced deobfuscation failed', error);
      throw error;
    }
  }

  /**
   * 从LLM响应中提取代码
   */
  extractCodeFromLLMResponse(response: string): string {
    return extractCodeFromLLMResponse(response);
  }

  /**
   * 验证是否是有效的JavaScript
   */
  isValidJavaScript(code: string): boolean {
    return isValidJavaScript(code);
  }

  /**
   * LLM代码清理
   *
   * 在完成基于规则的反混淆后,使用LLM进行最后的清理和优化:
   * 1. 改善变量命名
   * 2. 简化复杂表达式
   * 3. 添加有意义的注释
   * 4. 重构冗余代码
   */
  private async llmCleanup(
    code: string,
    techniques: string[],
  ): Promise<string | null> {
    if (!this.llm) return null;

    try {
      const codeSnippet = truncateCode(code, 3000);

      const prompt = `# Code Cleanup Task

## Detected Obfuscation Techniques
${techniques.map(t => `- ${t}`).join('\n')}

## Deobfuscated Code (needs cleanup)
\`\`\`javascript
${codeSnippet}
\`\`\`

## Your Task
Clean up and improve this deobfuscated JavaScript code:

1. **Variable Naming**: Rename variables to meaningful names based on their usage
   - Avoid generic names like 'a', 'b', 'temp'
   - Use descriptive names like 'userConfig', 'apiEndpoint', 'responseData'

2. **Code Structure**: Improve readability
   - Remove unnecessary parentheses and brackets
   - Simplify complex expressions
   - Extract magic numbers to named constants

3. **Comments**: Add brief comments for:
   - Complex logic or algorithms
   - Non-obvious functionality
   - Important data structures

4. **Consistency**: Ensure consistent code style
   - Use consistent indentation
   - Follow JavaScript best practices

## Important Rules
- Preserve ALL original functionality
- Do NOT remove any functional code
- Do NOT change the program logic
- Output ONLY valid JavaScript code
- Do NOT add explanations outside the code

## Output Format
Return only the cleaned JavaScript code without markdown formatting.`;

      const response = await this.llm.chat(
        [
          {
            role: 'system',
            content: `# Role
You are an expert JavaScript code reviewer and refactoring specialist with expertise in:
- Code readability and maintainability improvement
- Semantic variable naming based on usage context
- Code smell detection and refactoring
- JavaScript best practices (ES6+, clean code principles)
- Preserving exact program functionality during refactoring

# Task
Clean up and improve deobfuscated JavaScript code while preserving 100% of its functionality.

# Refactoring Principles
1. **Semantic Naming**: Infer variable purpose from usage patterns
   - API calls → apiClient, fetchData, apiResponse
   - DOM elements → userInput, submitButton, errorMessage
   - Crypto operations → encryptedData, decryptionKey, hashValue
   - Loops/counters → index, itemCount, currentPage

2. **Code Simplification**: Remove obfuscation artifacts
   - Unnecessary IIFEs and closures
   - Redundant variable assignments
   - Complex ternary chains → if-else
   - Magic numbers → named constants

3. **Structure Improvement**: Enhance readability
   - Extract repeated code to functions
   - Group related operations
   - Consistent indentation and spacing
   - Logical code organization

# Critical Constraints
- **NEVER** change program logic or behavior
- **NEVER** remove functional code (even if it looks redundant)
- **NEVER** add new functionality
- **ONLY** improve naming, structure, and readability
- Output must be syntactically valid JavaScript
- Preserve all side effects and edge cases

# Output Format
Return ONLY the cleaned JavaScript code (no markdown, no explanations).`,
          },
          {role: 'user', content: prompt},
        ],
        {
          temperature: 0.15, // 低温度以保持一致性和确定性
          maxTokens: 3000,
        },
      );

      const cleanedCode = extractCodeFromLLMResponse(response.content);

      // 验证清理后的代码是否有效
      if (isValidJavaScript(cleanedCode)) {
        logger.success('LLM cleanup succeeded');
        return cleanedCode;
      } else {
        logger.warn('LLM cleanup produced invalid JavaScript');
        return null;
      }
    } catch (error) {
      logger.warn('LLM cleanup failed', error);
      return null;
    }
  }

  /**
   * 计算反混淆置信度
   *
   * 基于多个因素计算置信度分数:
   * 1. 成功检测和处理的混淆技术数量
   * 2. 警告和错误数量
   * 3. 代码复杂度变化
   * 4. AST节点数量变化
   */
  private calculateConfidence(
    techniques: string[],
    warnings: string[],
    code: string,
  ): number {
    let confidence = 0.3; // 基础置信度

    // 每成功处理一种混淆技术,增加置信度
    const techniqueBonus = Math.min(techniques.length * 0.12, 0.5);
    confidence += techniqueBonus;

    // 每个警告降低置信度
    const warningPenalty = warnings.length * 0.08;
    confidence -= warningPenalty;

    // 特定技术的额外置信度
    const highConfidenceTechniques = [
      'invisible-unicode',
      'string-array-rotation',
      'dead-code-injection',
      'opaque-predicates',
      'string-encoding',
      'ast-optimized',
    ];

    const highConfidenceCount = techniques.filter(tech =>
      highConfidenceTechniques.some(ht => tech.includes(ht)),
    ).length;

    confidence += highConfidenceCount * 0.05;

    // VM反混淆的置信度较低
    if (techniques.some(tech => tech.includes('vm-protection'))) {
      confidence -= 0.15;
    }

    // 控制流平坦化的置信度中等
    if (techniques.some(tech => tech.includes('control-flow-flattening'))) {
      confidence -= 0.05;
    }

    // 根据代码复杂度调整置信度
    const complexity = estimateCodeComplexity(code);
    if (complexity < 10) {
      confidence += 0.1; // 简单代码更容易反混淆
    } else if (complexity > 100) {
      confidence -= 0.1; // 复杂代码更难反混淆
    }

    // 确保置信度在0-1之间
    return Math.max(0.1, Math.min(0.95, confidence));
  }
}
