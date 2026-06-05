/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Packer反混淆器
 * 专门用于处理Dean Edwards' Packer混淆的JavaScript代码
 *
 * Packer特征：
 * 1. eval(function(p,a,c,k,e,d){...})(...) 模式
 * 2. 使用62进制或更高进制编码
 * 3. 字符串数组存储
 * 4. 自解压缩逻辑
 *
 * 参考资料：
 * - Dean Edwards' Packer: http://dean.edwards.name/packer/
 * - 在线解包工具: https://matthewfl.com/unPacker.html
 */

import {logger} from '../../utils/logger.js';

/**
 * Packer反混淆选项
 */
export interface PackerDeobfuscatorOptions {
  code: string;
  maxIterations?: number; // 最大解包迭代次数
}

/**
 * Packer反混淆结果
 */
export interface PackerDeobfuscatorResult {
  code: string;
  success: boolean;
  iterations: number;
  warnings: string[];
}

interface PackerParams {
  p: string;
  a: number;
  c: number;
  k: string[];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  e: Function;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  d: Function;
}

/**
 * Packer反混淆器
 */
export class PackerDeobfuscator {
  /**
   * 检测是否为Packer混淆
   */
  static detect(code: string): boolean {
    // 检测典型的Packer模式
    const packerPattern =
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/;
    return packerPattern.test(code);
  }

  /**
   * 反混淆Packer代码
   */
  async deobfuscate(
    options: PackerDeobfuscatorOptions,
  ): Promise<PackerDeobfuscatorResult> {
    const {code, maxIterations = 5} = options;

    logger.info('📦 开始Packer反混淆...');

    const warnings: string[] = [];
    let currentCode = code;
    let iterations = 0;

    try {
      // 循环解包，直到不再是Packer格式
      while (
        PackerDeobfuscator.detect(currentCode) &&
        iterations < maxIterations
      ) {
        const unpacked = this.unpack(currentCode);

        if (!unpacked || unpacked === currentCode) {
          warnings.push('解包失败或已达到最终状态');
          break;
        }

        currentCode = unpacked;
        iterations++;
        logger.info(`📦 完成第 ${iterations} 次解包`);
      }

      logger.info(`✅ Packer反混淆完成，共 ${iterations} 次迭代`);

      return {
        code: currentCode,
        success: true,
        iterations,
        warnings,
      };
    } catch (error) {
      logger.error('Packer反混淆失败', error);
      return {
        code: currentCode,
        success: false,
        iterations,
        warnings: [...warnings, String(error)],
      };
    }
  }

  /**
   * 解包单次Packer混淆
   */
  private unpack(code: string): string {
    // 1. 提取Packer参数
    const match = code.match(
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*{([\s\S]*?)}\s*\((.*?)\)\s*\)/,
    );

    if (!match || !match[2]) {
      return code;
    }

    const args = match[2];

    // 2. 解析参数
    const params = this.parsePackerParams(args);
    if (!params) {
      return code;
    }

    // 3. 执行解包
    try {
      const unpacked = this.executeUnpacker(params);
      return unpacked || code;
    } catch (error) {
      logger.warn('解包执行失败', error);
      return code;
    }
  }

  /**
   * 解析Packer参数
   */
  private parsePackerParams(argsString: string): PackerParams | null {
    try {
      const params = new Function(`return [${argsString}];`)() as unknown[];

      if (params.length < 4) {
        return null;
      }

      return {
        p: String(params[0] ?? ''),
        a: Number(params[1] ?? 0),
        c: Number(params[2] ?? 0),
        k: String(params[3] ?? '').split('|'),
        e: this.toDecoder(params[4], (c: number) => c),
        d: this.toDecoder(params[5], () => ''),
      };
    } catch {
      return null;
    }
  }

  private toDecoder(value: unknown, fallback: (...args: never[]) => unknown): PackerParams['e'] {
    return typeof value === 'function' ? (value as PackerParams['e']) : (fallback as PackerParams['e']);
  }

  /**
   * 执行解包器
   */
  private executeUnpacker(params: PackerParams): string {
    const {p, a, k} = params;
    let {c} = params;

    // 标准Packer解包逻辑：从大到小替换编码标识符
    let result = p;
    while (c--) {
      const replacement = k[c];
      if (!replacement) continue;

      const pattern = new RegExp('\\b' + this.base(c, a) + '\\b', 'g');
      result = result.replace(pattern, replacement);
    }

    return result;
  }

  /**
   * 进制转换（Packer使用的编码方式）
   */
  private base(num: number, radix: number): string {
    const digits =
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    if (num === 0) {
      return '0';
    }

    let result = '';
    while (num > 0) {
      result = digits[num % radix] + result;
      num = Math.floor(num / radix);
    }

    return result || '0';
  }

  /**
   * 美化解包后的代码
   *
   * 注意：这只是"够用"级别的美化，不是真正的格式化器。
   * 仅用于让 eval 串变成多行可读版本。
   */
  beautify(code: string): string {
    return code
      .replace(/;/g, ';\n')
      .replace(/{/g, '{\n')
      .replace(/}/g, '\n}\n')
      .replace(/\n\n+/g, '\n\n')
      .trim();
  }
}

/**
 * AAEncode反混淆器
 * 处理颜文字编码的JavaScript
 */
export class AAEncodeDeobfuscator {
  /**
   * 检测是否为AAEncode
   */
  static detect(code: string): boolean {
    // AAEncode使用颜文字字符
    return (
      code.includes('゜-゜') || code.includes('ω゜') || code.includes('o゜)')
    );
  }

  /**
   * 反混淆AAEncode代码
   *
   * AAEncode本质上是可执行的JavaScript，借助 Function 构造器执行并取出结果。
   */
  async deobfuscate(code: string): Promise<string> {
    try {
      const decoded = new Function(`return (${code})`)();
      logger.info('✅ AAEncode反混淆完成');
      return decoded;
    } catch (error) {
      logger.error('AAEncode反混淆失败', error);
      return code;
    }
  }
}

/**
 * URLEncode反混淆器
 * 处理URL编码的JavaScript
 */
export class URLEncodeDeobfuscator {
  /**
   * 检测是否为URLEncode
   */
  static detect(code: string): boolean {
    const percentCount = (code.match(/%[0-9A-Fa-f]{2}/g) || []).length;
    return percentCount > 10;
  }

  /**
   * 反混淆URLEncode代码
   */
  async deobfuscate(code: string): Promise<string> {
    try {
      const decoded = decodeURIComponent(code);
      logger.info('✅ URLEncode反混淆完成');
      return decoded;
    } catch (error) {
      logger.error('URLEncode反混淆失败', error);
      return code;
    }
  }
}

/**
 * 通用解包器
 * 自动检测并应用合适的反混淆器
 */
export class UniversalUnpacker {
  private packerDeobfuscator = new PackerDeobfuscator();
  private aaencodeDeobfuscator = new AAEncodeDeobfuscator();
  private urlencodeDeobfuscator = new URLEncodeDeobfuscator();

  /**
   * 自动检测并反混淆
   */
  async deobfuscate(code: string): Promise<{
    code: string;
    type: string;
    success: boolean;
  }> {
    logger.info('🔍 自动检测混淆类型...');

    // 优先级：Packer > AAEncode > URLEncode
    // Packer 可能包含 AAEncode 风格的颜文字片段，所以先尝试
    if (PackerDeobfuscator.detect(code)) {
      logger.info('检测到: Packer混淆');
      const result = await this.packerDeobfuscator.deobfuscate({code});
      return {code: result.code, type: 'Packer', success: result.success};
    }

    if (AAEncodeDeobfuscator.detect(code)) {
      logger.info('检测到: AAEncode混淆');
      const decoded = await this.aaencodeDeobfuscator.deobfuscate(code);
      return {code: decoded, type: 'AAEncode', success: decoded !== code};
    }

    if (URLEncodeDeobfuscator.detect(code)) {
      logger.info('检测到: URLEncode混淆');
      const decoded = await this.urlencodeDeobfuscator.deobfuscate(code);
      return {code: decoded, type: 'URLEncode', success: decoded !== code};
    }

    logger.info('未检测到已知的混淆类型');
    return {code, type: 'Unknown', success: false};
  }
}
