/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 混淆类型检测
 *
 * 负责检测代码中存在的混淆类型，以及在管线执行后合并子管线新发现的类型。
 */

import type {ObfuscationType, Transformation} from '../../types/index.js';
import {
  AAEncodeDeobfuscator,
  PackerDeobfuscator,
  URLEncodeDeobfuscator,
} from './PackerDeobfuscator.js';

/**
 * 检测混淆类型（综合检测）
 */
export function detectObfuscationType(code: string): ObfuscationType[] {
  const types: ObfuscationType[] = [];

  // JavaScript Obfuscator
  if (code.includes('_0x') || /var\s+_0x[a-f0-9]+\s*=/.test(code)) {
    types.push('javascript-obfuscator');
  }

  // Webpack
  if (code.includes('__webpack_require__') || code.includes('webpackJsonp')) {
    types.push('webpack');
  }

  // UglifyJS (单行长代码)
  if (code.length > 1000 && !code.includes('\n')) {
    types.push('uglify');
  }

  // VM 保护
  if (code.includes('eval') && code.includes('Function')) {
    types.push('vm-protection');
  }

  // Packer
  if (PackerDeobfuscator.detect(code)) {
    types.push('packer');
  }

  // AAEncode
  if (AAEncodeDeobfuscator.detect(code)) {
    types.push('aaencode');
  }

  // URLEncode
  if (URLEncodeDeobfuscator.detect(code)) {
    types.push('urlencoded');
  }

  // Invisible Unicode (零宽字符)
  if (/[\u200B-\u200F\u2028-\u202F\uFEFF]/.test(code)) {
    types.push('invisible-unicode');
  }

  // 控制流平坦化 (while + switch 嵌套)
  if (
    /while\s*\([^)]*\)\s*\{?\s*switch\s*\(/.test(code) ||
    /while\s*\(\s*!!\s*\[\s*\]\s*\)\s*\{?\s*switch/.test(code)
  ) {
    types.push('control-flow-flattening');
  }

  // 不透明谓词 (恒真/恒假条件)
  if (
    /if\s*\(\s*typeof\s+\w+\s*[!=]==?\s*['"]undefined['"]\s*\)/.test(code) &&
    code.includes('_0x')
  ) {
    types.push('opaque-predicates');
  }

  // 死代码注入
  if (/if\s*\(\s*false\s*\)|if\s*\(\s*![1!]\s*\)/.test(code)) {
    types.push('dead-code-injection');
  }

  // 字符串数组旋转
  if (
    /\(\s*function\s*\(\s*_0x[a-f0-9]+\s*,\s*_0x[a-f0-9]+\s*\).*?push\s*\(\s*.*?shift\s*\(\s*\)/.test(
      code,
    )
  ) {
    types.push('string-array-rotation');
  }

  // JSFuck
  if (/^\s*[\]()!+]+\s*$/.test(code.substring(0, 200))) {
    types.push('jsfuck');
  }

  // eval 混淆
  if (/eval\s*\(\s*['"`]/.test(code) || /eval\s*\(\s*atob\s*\(/.test(code)) {
    types.push('eval-obfuscation');
  }

  // Hex 编码字符串
  if (/\\x[0-9a-fA-F]{2}/.test(code)) {
    types.push('hex-encoding');
  }

  // Base64 编码
  if (
    /atob\s*\(|btoa\s*\(/.test(code) &&
    /[A-Za-z0-9+/]{20,}={0,2}/.test(code)
  ) {
    types.push('base64-encoding');
  }

  if (types.length === 0) {
    types.push('unknown');
  }

  return types;
}

/**
 * 合并子管线检测到的额外混淆类型
 */
export function mergeObfuscationTypes(
  original: ObfuscationType[],
  transformations: Transformation[],
): ObfuscationType[] {
  const types = new Set<ObfuscationType>(original);

  // 从 transformations 推断新发现的类型
  for (const transformation of transformations) {
    if (!transformation.success) continue;

    // 用 description 子串做关键字匹配：避免硬编码每个管线产物的格式
    if (transformation.type === 'unpack') {
      addTypeIfDescriptionMatches(
        types,
        transformation.description,
        ['Packer', 'AAEncode', 'URLEncode'],
        ['packer', 'aaencode', 'urlencoded'],
      );
    }
    if (transformation.type === 'jsvmp') {
      types.add('vm-protection');
    }
    if (transformation.type === 'advanced') {
      addTypeIfDescriptionMatches(
        types,
        transformation.description,
        [
          'invisible-unicode',
          'control-flow-flattening',
          'opaque-predicates',
          'dead-code-injection',
        ],
        [
          'invisible-unicode',
          'control-flow-flattening',
          'opaque-predicates',
          'dead-code-injection',
        ],
      );
    }
    if (transformation.type === 'webcrack') {
      applyWebcrackDetailTypes(types, transformation);
    }
  }

  // 移除 unknown（如果有具体类型）
  if (types.size > 1) {
    types.delete('unknown');
  }

  return [...types];
}

// ==================== 内部辅助 ====================

function applyWebcrackDetailTypes(
  types: Set<ObfuscationType>,
  transformation: Transformation,
): void {
  types.add('webcrack');

  const detail = transformation.detail as
    | {
        bundle?: {type?: string};
        optionsUsed?: {
          unminify?: boolean;
          mangle?: boolean;
          jsx?: boolean;
        };
      }
    | undefined;

  if (detail?.bundle?.type) types.add('bundle-unpack');
  if (detail?.optionsUsed?.unminify) types.add('unminify');
  if (detail?.optionsUsed?.mangle) types.add('mangle');
  if (detail?.optionsUsed?.jsx) types.add('jsx-decompile');
}

/**
 * 并行遍历关键字列表/类型列表：当 description 包含某个关键字时，添加对应类型。
 * 仅做 description.includes 匹配（O(N*M) 但 N 极小），不要用于大文本。
 */
function addTypeIfDescriptionMatches(
  types: Set<ObfuscationType>,
  description: string,
  keywords: string[],
  typeNames: ObfuscationType[],
): void {
  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    if (keyword && description.includes(keyword)) {
      const typeName = typeNames[i];
      if (typeName) types.add(typeName);
    }
  }
}
