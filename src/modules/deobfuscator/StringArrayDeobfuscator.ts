/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * String Array Rotation 去混淆器。提取自 AdvancedDeobfuscator.ts。
 *
 * 基于 CASCADE 论文: String Array Rotate Function 还原。
 * Obfuscator.IO 会生成一个 IIFE 来旋转字符串数组：
 * (function(getStringArray, target) {
 *   var stringArray = getStringArray();
 *   while (true) {
 *     try {
 *       var value = parseInt(...) / ... + ...;
 *       if (value === target) break;
 *       else stringArray.push(stringArray.shift());
 *     } catch { stringArray.push(stringArray.shift()); }
 *   }
 * })(getStringArray, 0x12345);
 */

import generateImport from '@babel/generator';
import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
import * as t from '@babel/types';

import {logger} from '../../utils/logger.js';

import {unwrapBabelDefault} from './astUtils.js';

const generate = unwrapBabelDefault<typeof generateImport>(generateImport);
const traverse = unwrapBabelDefault<typeof traverseImport>(traverseImport);

// 字符串数组旋转特征
const STRING_ARRAY_ROTATION_PATTERN = /\w+\s*=\s*\w+\s*\+\s*0x[0-9a-f]+/;

export class StringArrayDeobfuscator {
  /**
   * 检测字符串数组旋转
   */
  static detectStringArrayRotation(code: string): boolean {
    return STRING_ARRAY_ROTATION_PATTERN.test(code);
  }

  /**
   * 字符串数组去旋转
   */
  static derotateStringArray(code: string): string {
    logger.info('Derotating string array...');

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      let derotated = 0;

      traverse(ast, {
        // 查找字符串数组旋转 IIFE
        CallExpression(path) {
          // 检查是否是 IIFE 调用
          if (
            !t.isFunctionExpression(path.node.callee) &&
            !t.isArrowFunctionExpression(path.node.callee)
          ) {
            return;
          }

          const func = path.node.callee;
          if (!t.isFunctionExpression(func) || !t.isBlockStatement(func.body)) {
            return;
          }

          // 检查函数体是否包含 while 循环和字符串数组操作
          const hasWhileLoop = func.body.body.some(stmt =>
            t.isWhileStatement(stmt),
          );
          const hasArrayRotation =
            JSON.stringify(func.body).includes('push') &&
            JSON.stringify(func.body).includes('shift');

          if (hasWhileLoop && hasArrayRotation) {
            logger.debug('Found string array rotation IIFE');

            // 移除这个 IIFE，因为它只是用来旋转数组的
            // 实际的字符串数组已经在运行时被旋转过了
            path.remove();
            derotated++;
          }
        },
      });

      if (derotated > 0) {
        logger.info(`Removed ${derotated} string array rotation functions`);
        return generate(ast, {comments: true, compact: false}).code;
      }

      return code;
    } catch (error) {
      logger.error('Failed to derotate string array:', error);
      return code;
    }
  }
}
