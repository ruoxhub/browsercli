/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Invisible Unicode + String Encoding 去混淆器。提取自 AdvancedDeobfuscator.ts。
 *
 * 覆盖两种相关混淆：
 * 1. Invisible Unicode Obfuscation (2025 新技术) —— 用零宽字符编码二进制位
 * 2. String Encoding —— \\x / \\u 转义、String.fromCharCode、atob 等
 */

import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {logger} from '../../utils/logger.js';

import {unwrapBabelDefault} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

// 字符串编码特征
const STRING_ENCODING_PATTERNS = [
  /\\x[0-9a-f]{2}/i,
  /\\u[0-9a-f]{4}/i,
  /String\.fromCharCode/i,
  /atob\(/i,
];

export class InvisibleUnicodeDeobfuscator {
  /**
   * 检测 Invisible Unicode 混淆 (2025 新技术)
   * 使用不可见 Unicode 字符表示二进制数据
   */
  static detectInvisibleUnicode(code: string): boolean {
    const invisibleChars = [
      '\u200B', // Zero Width Space
      '\u200C', // Zero Width Non-Joiner
      '\u200D', // Zero Width Joiner
      '\u2060', // Word Joiner
      '\uFEFF', // Zero Width No-Break Space
    ];

    return invisibleChars.some(char => code.includes(char));
  }

  /**
   * 解码 Invisible Unicode 混淆
   */
  static decodeInvisibleUnicode(code: string): string {
    logger.info('Decoding invisible unicode...');

    // 映射：不可见字符 -> 二进制位
    const charToBit: Record<string, string> = {
      '\u200B': '0',
      '\u200C': '1',
      '\u200D': '00',
      '\u2060': '01',
      '\uFEFF': '10',
    };

    let decoded = code;

    // 查找所有不可见字符序列
    // eslint-disable-next-line no-misleading-character-class
    const invisiblePattern = /[\u200B\u200C\u200D\u2060\uFEFF]+/g;
    const matches = code.match(invisiblePattern);

    if (matches) {
      matches.forEach(match => {
        // 转换为二进制
        let binary = '';
        for (const char of match) {
          binary += charToBit[char] || '';
        }

        // 二进制转字符串
        if (binary.length % 8 === 0) {
          let text = '';
          for (let i = 0; i < binary.length; i += 8) {
            const byte = binary.substring(i, i + 8);
            text += String.fromCharCode(parseInt(byte, 2));
          }
          decoded = decoded.replace(match, text);
        }
      });
    }

    return decoded;
  }

  /**
   * 检测字符串编码
   */
  static detectStringEncoding(code: string): boolean {
    return STRING_ENCODING_PATTERNS.some(p => p.test(code));
  }

  /**
   * 解码字符串
   */
  static decodeStrings(code: string): string {
    logger.info('Decoding strings...');

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let decoded = 0;

      traverse(ast, {
        // 解码 String.fromCharCode(...)
        CallExpression(path) {
          const callee = path.node.callee;
          if (
            !t.isMemberExpression(callee) ||
            !t.isIdentifier(callee.object, {name: 'String'}) ||
            !t.isIdentifier(callee.property, {name: 'fromCharCode'})
          ) {
            return;
          }

          // 所有参数都是数字字面量才安全替换
          const allNumbers = path.node.arguments.every(arg =>
            t.isNumericLiteral(arg),
          );
          if (!allNumbers) return;

          const charCodes = path.node.arguments.map(
            arg => (arg as t.NumericLiteral).value,
          );
          path.replaceWith(t.stringLiteral(String.fromCharCode(...charCodes)));
          decoded++;
        },
      });

      if (decoded > 0) {
        logger.info(`Decoded ${decoded} string expressions`);
        return generate(ast, {comments: false, compact: false}).code;
      }

      return code;
    } catch (error) {
      logger.error('Failed to decode strings:', error);
      return code;
    }
  }
}
