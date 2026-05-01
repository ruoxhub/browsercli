/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {logger} from '../../utils/logger.js';

/**
 * 观察模式工具配置
 */
export interface ObserveFlowOptions {
  /** 是否包含动态脚本 */
  includeDynamic?: boolean;
  /** 是否包含外部脚本 */
  includeExternal?: boolean;
  /** 是否包含内联脚本 */
  includeInline?: boolean;
  /** 是否包含 Service Worker */
  includeServiceWorker?: boolean;
  /** 是否包含 Web Worker */
  includeWebWorker?: boolean;
  /** 最大文件大小（字节） */
  maxFileSize?: number;
  /** 最大总大小（字节） */
  maxTotalSize?: number;
  /** 收集模式 */
  mode?: 'summary' | 'priority' | 'incremental' | 'full';
  /** 智能模式 */
  smartMode?: boolean;
  /** 动态脚本等待时间（毫秒） */
  dynamicWaitMs?: number;
  /** 优先级 URL 模式 */
  priorities?: string[];
  /** 是否压缩代码 */
  compress?: boolean;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/**
 * 脚本分析结果
 */
export interface ScriptAnalysis {
  /** 脚本 URL */
  url: string;
  /** 脚本类型 */
  type: string;
  /** 文件大小 */
  size: number;
  /** 是否包含加密代码 */
  hasEncryption: boolean;
  /** 是否包含 API 调用 */
  hasAPI: boolean;
  /** 是否混淆 */
  hasObfuscation: boolean;
  /** 加密算法列表 */
  cryptoAlgorithms: string[];
  /** 主要函数列表 */
  functions: string[];
  /** 导入模块列表 */
  imports: string[];
  /** 代码预览 */
  preview: string;
  /** 风险评分 (0-100) */
  riskScore: number;
}

/**
 * 依赖关系图
 */
export interface DependencyInfo {
  /** 节点列表 */
  nodes: Array<{id: string; url: string; type: string}>;
  /** 边列表 */
  edges: Array<{from: string; to: string; type: string}>;
  /** 入口文件列表 */
  entryPoints: string[];
  /** 第三方库列表 */
  thirdPartyLibs: string[];
}

/**
 * 观察模式分析报告
 */
export interface ObserveFlowReport {
  /** 页面 URL */
  url: string;
  /** 收集的脚本总数 */
  scriptCount: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 收集时间（毫秒） */
  collectTime: number;
  /** 脚本分析列表 */
  scriptAnalysis: ScriptAnalysis[];
  /** 依赖关系图 */
  dependencies: DependencyInfo;
  /** 加密检测结果 */
  cryptoDetection: {
    /** 检测到的算法 */
    algorithms: string[];
    /** 检测到的库 */
    libraries: string[];
    /** 置信度 */
    confidence: number;
  };
  /** 混淆检测结果 */
  obfuscationDetection: {
    /** 是否检测到混淆 */
    hasObfuscation: boolean;
    /** 混淆类型 */
    types: string[];
    /** 受影响文件 */
    affectedFiles: string[];
  };
  /** 总体风险评估 */
  overallRiskAssessment: {
    /** 风险评分 (0-100) */
    score: number;
    /** 风险等级 */
    level: 'low' | 'medium' | 'high' | 'critical';
    /** 风险描述 */
    description: string;
    /** 建议 */
    recommendations: string[];
  };
}

/** 观察模式工具统一返回结构 */
export interface ObserveFlowToolResult {
  success: boolean;
  message?: string;
  error?: string;
  tooltype: 'observe_flow';
  data?: ObserveFlowReport;
}

/**
 * 观察模式工具 - 收集和分析页面脚本
 */
export async function observeFlow(
  params: ObserveFlowOptions & {url?: string} = {},
): Promise<ObserveFlowToolResult> {
  const {url: paramUrl, ...options} = params;

  try {
    logger.info('Starting observe_flow tool...');
    const startTime = Date.now();

    const url =
      paramUrl ?? getRuntime().contextProvider!.getSelectedPage?.()?.url?.() ?? undefined;

    // 验证必要的上下文
    if (!url) {
      return {
        success: false,
        error:
          '缺少 url 参数，且当前没有选中的页面。请提供 --url 参数或先导航到目标页面。',
        tooltype: 'observe_flow',
      };
    }

    // 1. 收集页面脚本
    const collectResult = await collectScripts(url, options);
    logger.info(`Collected ${collectResult.files.length} scripts`);

    // 2. 分析每个脚本
    const scriptAnalysis = analyzeScripts(collectResult.files);
    logger.info(`Analyzed ${scriptAnalysis.length} scripts`);

    // 3. 分析依赖关系
    const dependencies = analyzeDependencies(collectResult.files);
    logger.info('Dependency analysis completed');

    // 4. 检测加密算法
    const cryptoDetection = detectCryptoPatterns(collectResult.files);
    logger.info(
      `Crypto detection: ${cryptoDetection.algorithms.length} algorithms found`,
    );

    // 5. 检测混淆代码
    const obfuscationDetection = detectObfuscationPatterns(
      collectResult.files,
      scriptAnalysis,
    );
    logger.info(
      `Obfuscation detection: ${obfuscationDetection.types.length} types found`,
    );

    // 6. 生成风险评估
    const riskAssessment = assessOverallRisk(
      scriptAnalysis,
      cryptoDetection,
      obfuscationDetection,
    );
    logger.info(
      `Risk assessment: ${riskAssessment.level} (${riskAssessment.score}/100)`,
    );

    const duration = Date.now() - startTime;

    const report: ObserveFlowReport = {
      url,
      scriptCount: collectResult.files.length,
      totalSize: collectResult.totalSize,
      collectTime: duration,
      scriptAnalysis,
      dependencies,
      cryptoDetection,
      obfuscationDetection,
      overallRiskAssessment: riskAssessment,
    };

    logger.info(`observe_flow completed in ${duration}ms`);

    return {
      success: true,
      message: `观察模式完成：收集 ${report.scriptCount} 个脚本，发现 ${cryptoDetection.algorithms.length} 种加密算法，${obfuscationDetection.types.length} 种混淆类型`,
      tooltype: 'observe_flow',
      data: report,
    };
  } catch (error) {
    logger.error('observe_flow tool failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      tooltype: 'observe_flow',
    };
  }
}

/**
 * 收集页面脚本
 */
async function collectScripts(
  url: string,
  options: ObserveFlowOptions,
): Promise<{
  files: Array<{url: string; content: string; size: number; type: string}>;
  totalSize: number;
}> {
  // 优先使用 CodeCollector 进行真实收集
  const collector = getRuntime().contextProvider!.collector;
  if (collector) {
    try {
      const result = await collector.collect({
        url,
        includeInline: options.includeInline ?? true,
        includeExternal: options.includeExternal ?? true,
        includeDynamic: options.includeDynamic ?? false,
        includeServiceWorker: options.includeServiceWorker ?? false,
        includeWebWorker: options.includeWebWorker ?? false,
        maxFileSize: options.maxFileSize ?? 100 * 1024,
        maxTotalSize: options.maxTotalSize ?? 512 * 1024,
        timeout: options.timeout ?? 30000,
        dynamicWaitMs: options.dynamicWaitMs ?? 3000,
        smartMode: options.mode ?? 'full',
        compress: options.compress ?? false,
      });
      return {
        files: result.files.map(f => ({
          url: f.url,
          content: f.content,
          size: f.size,
          type: f.type,
        })),
        totalSize: result.totalSize,
      };
    } catch (collectorError) {
      logger.warn(
        'CodeCollector 收集失败，降级为仅返回空结果: ' +
          (collectorError instanceof Error
            ? collectorError.message
            : String(collectorError)),
      );
    }
  }

  // 降级：如果 collector 不可用，返回空结果并附带原因
  logger.warn(
    'observe_flow: CodeCollector 未初始化（runtime.collector 不存在），返回空脚本列表。',
  );
  return {files: [], totalSize: 0};
}

/**
 * 分析脚本列表
 */
function analyzeScripts(
  files: Array<{url: string; content: string; size: number; type: string}>,
): ScriptAnalysis[] {
  return files.map(file => analyzeSingleScript(file));
}

/**
 * 分析单个脚本
 */
function analyzeSingleScript(file: {
  url: string;
  content: string;
  size: number;
  type: string;
}): ScriptAnalysis {
  const {url, content, size, type} = file;

  // 检测加密
  const hasEncryption = detectEncryption(content);
  const cryptoAlgorithms = extractCryptoAlgorithms(content);

  // 检测 API 调用
  const hasAPI = detectAPI(content);

  // 检测混淆
  const hasObfuscation = detectObfuscation(content);

  // 提取函数
  const functions = extractFunctions(content);

  // 提取导入
  const imports = extractImports(content);

  // 生成预览
  const preview = generatePreview(content);

  // 计算风险评分
  const riskScore = calculateScriptRiskScore({
    hasEncryption,
    hasAPI,
    hasObfuscation,
    cryptoAlgorithms,
  });

  return {
    url,
    type,
    size,
    hasEncryption,
    hasAPI,
    hasObfuscation,
    cryptoAlgorithms,
    functions,
    imports,
    preview,
    riskScore,
  };
}

/**
 * 分析依赖关系
 */
function analyzeDependencies(
  files: Array<{url: string; content: string; size: number; type: string}>,
): DependencyInfo {
  const nodes: DependencyInfo['nodes'] = [];
  const edges: DependencyInfo['edges'] = [];
  const entryPoints: string[] = [];
  const thirdPartyLibs: string[] = [];

  // 构建节点
  files.forEach(file => {
    nodes.push({
      id: file.url,
      url: file.url,
      type: file.type,
    });

    // 检测入口文件
    if (isEntryPoint(file.url, file.content)) {
      entryPoints.push(file.url);
    }

    // 检测第三方库
    const libs = detectThirdPartyLibs(file.content);
    libs.forEach(lib => {
      if (!thirdPartyLibs.includes(lib)) {
        thirdPartyLibs.push(lib);
      }
    });
  });

  // 构建边（依赖关系）
  files.forEach(file => {
    const imports = extractImports(file.content);
    imports.forEach(imp => {
      // 查找匹配的目标文件
      const targetFile = files.find(
        f => f.url.includes(imp) || f.url.endsWith(imp),
      );
      if (targetFile) {
        edges.push({
          from: file.url,
          to: targetFile.url,
          type: 'import',
        });
      }
    });
  });

  return {nodes, edges, entryPoints, thirdPartyLibs};
}

/**
 * 检测加密模式
 */
function detectCryptoPatterns(
  files: Array<{url: string; content: string; size: number; type: string}>,
): {algorithms: string[]; libraries: string[]; confidence: number} {
  const allAlgorithms = new Set<string>();
  const allLibraries = new Set<string>();
  let totalConfidence = 0;
  let count = 0;

  files.forEach(file => {
    // 检测加密库
    const libs = detectCryptoLibraries(file.content);
    libs.forEach(lib => allLibraries.add(lib));

    // 检测算法
    const algos = extractCryptoAlgo(file.content);
    algos.forEach(algo => allAlgorithms.add(algo));

    // 计算置信度
    if (algos.length > 0 || libs.length > 0) {
      totalConfidence += 0.8; // 有检测结果则置信度 0.8
      count++;
    }
  });

  return {
    algorithms: Array.from(allAlgorithms),
    libraries: Array.from(allLibraries),
    confidence: count > 0 ? totalConfidence / count : 0,
  };
}

/**
 * 检测混淆模式
 */
function detectObfuscationPatterns(
  files: Array<{url: string; content: string; size: number; type: string}>,
  scriptAnalysis: ScriptAnalysis[],
): {hasObfuscation: boolean; types: string[]; affectedFiles: string[]} {
  const types = new Set<string>();
  const affectedFiles: string[] = [];

  scriptAnalysis.forEach(analysis => {
    if (analysis.hasObfuscation) {
      affectedFiles.push(analysis.url);

      // 识别具体混淆类型
      const obfTypes = identifyObfuscationType(analysis);
      obfTypes.forEach(t => types.add(t));
    }
  });

  return {
    hasObfuscation: affectedFiles.length > 0,
    types: Array.from(types),
    affectedFiles,
  };
}

/**
 * 总体风险评估
 */
function assessOverallRisk(
  scriptAnalysis: ScriptAnalysis[],
  cryptoDetection: {
    algorithms: string[];
    libraries: string[];
    confidence: number;
  },
  obfuscationDetection: {hasObfuscation: boolean; types: string[]},
): {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendations: string[];
} {
  let score = 0;
  const recommendations: string[] = [];

  // 加密检测加分
  if (cryptoDetection.algorithms.length > 0) {
    score += 20;
    recommendations.push('检查加密算法的使用是否符合安全最佳实践');
  }

  // 自定义加密库加分
  if (cryptoDetection.libraries.some(lib => !isStandardCryptoLib(lib))) {
    score += 15;
    recommendations.push('检测到非标准加密库，建议审查其实现');
  }

  // 混淆检测加分
  if (obfuscationDetection.hasObfuscation) {
    score += 30;
    recommendations.push('检测到代码混淆，可能需要反混淆分析');

    // 严重混淆类型额外加分
    if (
      obfuscationDetection.types.some(t =>
        ['vm-protection', 'control-flow-flattening'].includes(t),
      )
    ) {
      score += 20;
    }
  }

  // 高风险脚本比例
  const highRiskScripts = scriptAnalysis.filter(s => s.riskScore > 70).length;
  if (highRiskScripts > scriptAnalysis.length * 0.3) {
    score += 15;
    recommendations.push('高比例脚本存在风险特征，建议重点分析');
  }

  // 确定风险等级
  let level: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (score >= 80) level = 'critical';
  else if (score >= 60) level = 'high';
  else if (score >= 30) level = 'medium';

  const description = generateRiskDescription(
    level,
    cryptoDetection,
    obfuscationDetection,
    scriptAnalysis,
  );

  if (recommendations.length === 0) {
    recommendations.push('未发现明显风险特征');
  }

  return {
    score: Math.min(100, score),
    level,
    description,
    recommendations,
  };
}

// ==================== 辅助函数 ====================

/**
 * 检测是否包含加密相关代码
 */
function detectEncryption(content: string): boolean {
  const patterns = [
    /crypto|encrypt|decrypt|cipher|aes|rsa|md5|sha256|sha512/i,
    /CryptoJS|forge|sjcl|bcrypt|scrypt/i,
    /btoa|atob|Base64/i,
    /createHash|createCipher|createDecipher/i,
  ];
  return patterns.some(pattern => pattern.test(content));
}

/**
 * 检测是否包含 API 调用
 */
function detectAPI(content: string): boolean {
  const patterns = [
    /fetch\s*\(/,
    /XMLHttpRequest/,
    /axios|request|ajax/i,
    /\.get\(|\.post\(|\.put\(|\.delete\(/,
  ];
  return patterns.some(pattern => pattern.test(content));
}

/**
 * 检测是否混淆
 */
function detectObfuscation(content: string): boolean {
  const lines = content.split('\n');
  const avgLineLength = content.length / (lines.length || 1);

  // 平均行长度过长可能是混淆
  if (avgLineLength > 200) return true;

  // 常见混淆特征
  if (/\\x[0-9a-f]{2}/i.test(content)) return true; // 十六进制编码
  if (/\\u[0-9a-f]{4}/i.test(content)) return true; // Unicode 编码
  if (/eval\s*\(/i.test(content)) return true; // eval 调用
  if (/Function\s*\(/i.test(content)) return true; // Function 构造器
  if (/\[\s*['"][0-9]+['"]\s*\]/i.test(content)) return true; // 数组索引访问

  return false;
}

/**
 * 提取加密算法
 */
function extractCryptoAlgo(content: string): string[] {
  const algorithms: string[] = [];
  const patterns: Array<{pattern: RegExp; name: string}> = [
    {pattern: /\bAES\b/i, name: 'AES'},
    {pattern: /\bDES\b/i, name: 'DES'},
    {pattern: /\bRSA\b/i, name: 'RSA'},
    {pattern: /\bMD5\b/i, name: 'MD5'},
    {pattern: /\bSHA(1|256|384|512)\b/i, name: 'SHA'},
    {pattern: /\bHMAC\b/i, name: 'HMAC'},
    {pattern: /\bECB|CBC|CFB|OFB|CTR|GCM\b/i, name: 'Mode'},
    {pattern: /\bPKCS7|PKCS5|ZeroPadding\b/i, name: 'Padding'},
  ];

  patterns.forEach(({pattern, name}) => {
    if (pattern.test(content) && !algorithms.includes(name)) {
      algorithms.push(name);
    }
  });

  return algorithms;
}

/**
 * 提取加密算法（带详细位置）
 */
function extractCryptoAlgorithms(content: string): string[] {
  return extractCryptoAlgo(content);
}

/**
 * 检测加密库
 */
function detectCryptoLibraries(content: string): string[] {
  const libraries: string[] = [];
  const patterns: Array<{pattern: RegExp; name: string}> = [
    {pattern: /CryptoJS/i, name: 'CryptoJS'},
    {pattern: /JSEncrypt/i, name: 'JSEncrypt'},
    {pattern: /forge\./i, name: 'node-forge'},
    {pattern: /sjcl/i, name: 'SJCL'},
    {pattern: /bcrypt/i, name: 'bcrypt'},
    {pattern: /crypto-js/i, name: 'crypto-js'},
    {pattern: /webcrypto|crypto\.subtle/i, name: 'WebCrypto'},
    {pattern: /sm-crypto/i, name: 'SM-Crypto'},
  ];

  patterns.forEach(({pattern, name}) => {
    if (pattern.test(content) && !libraries.includes(name)) {
      libraries.push(name);
    }
  });

  return libraries;
}

/**
 * 提取函数名
 */
function extractFunctions(content: string): string[] {
  const functions: string[] = [];
  const patterns = [
    /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
    /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?function/g,
    /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\([^)]*\)\s*=>/g,
    /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s+)?function/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1] && !functions.includes(match[1])) {
        functions.push(match[1]);
      }
    }
  }

  return functions.slice(0, 30); // 最多 30 个
}

/**
 * 提取导入模块
 */
function extractImports(content: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1] && !imports.includes(match[1])) {
        imports.push(match[1]);
      }
    }
  }

  return imports.slice(0, 30); // 最多 30 个
}

/**
 * 生成代码预览
 */
function generatePreview(content: string, maxLines = 10): string {
  const lines = content.split('\n');
  const previewLines = lines.slice(0, maxLines);
  return previewLines.join('\n').substring(0, 500); // 最多 500 字符
}

/**
 * 检测第三方库
 */
function detectThirdPartyLibs(content: string): string[] {
  const libs: string[] = [];
  const patterns = [
    /jquery|jQuery|\$\.ajax/i,
    /react|React\.|useState|useEffect/i,
    /vue|Vue\.|createApp/i,
    /lodash|_\./i,
    /axios|axios\./i,
    /moment|moment\./i,
    /rxjs|RxJS|Observable/i,
  ];

  const libNames = [
    'jQuery',
    'React',
    'Vue',
    'Lodash',
    'Axios',
    'Moment',
    'RxJS',
  ];
  patterns.forEach((pattern, idx) => {
    if (pattern.test(content) && !libs.includes(libNames[idx]!)) {
      libs.push(libNames[idx]!);
    }
  });

  return libs;
}

/**
 * 判断是否为入口文件
 */
function isEntryPoint(url: string, content: string): boolean {
  const entryPatterns = [/main/i, /index/i, /app/i, /entry/i, /bootstrap/i];
  return (
    entryPatterns.some(pattern => pattern.test(url)) ||
    content.includes('webpackJsonp')
  );
}

/**
 * 识别混淆类型
 */
function identifyObfuscationType(analysis: ScriptAnalysis): string[] {
  const types: string[] = [];

  // VM 保护检测
  if (
    analysis.preview.includes('Function(') ||
    analysis.preview.includes('new Function')
  ) {
    types.push('vm-protection');
  }

  // 控制流平坦化
  if (
    analysis.preview.includes('case ') &&
    analysis.preview.includes('break') &&
    analysis.preview.includes('switch')
  ) {
    const switchCount = (analysis.preview.match(/case\s/g) || []).length;
    if (switchCount > 10) {
      types.push('control-flow-flattening');
    }
  }

  // 字符串数组加密
  if (analysis.preview.includes("['0x") || analysis.preview.includes('[0x')) {
    types.push('string-array-rotation');
  }

  // Unicode 编码混淆
  if (/\\u[0-9a-f]{4}/i.test(analysis.preview)) {
    types.push('unicode-obfuscation');
  }

  // 十六进制编码
  if (/\\x[0-9a-f]{2}/i.test(analysis.preview)) {
    types.push('hex-encoding');
  }

  return types;
}

/**
 * 计算脚本风险评分
 */
function calculateScriptRiskScore(analysis: {
  hasEncryption: boolean;
  hasAPI: boolean;
  hasObfuscation: boolean;
  cryptoAlgorithms: string[];
}): number {
  let score = 0;

  if (analysis.hasEncryption) score += 15;
  if (analysis.hasAPI) score += 10;
  if (analysis.hasObfuscation) score += 30;
  if (analysis.cryptoAlgorithms.length > 2) score += 15;

  return Math.min(100, score);
}

/**
 * 生成风险描述
 */
function generateRiskDescription(
  level: string,
  crypto: {algorithms: string[]; libraries: string[]; confidence: number},
  obfuscation: {hasObfuscation: boolean; types: string[]},
  scripts: ScriptAnalysis[],
): string {
  const parts: string[] = [];

  if (crypto.algorithms.length > 0) {
    parts.push(`检测到 ${crypto.algorithms.length} 种加密算法`);
  }
  if (crypto.libraries.length > 0) {
    parts.push(`使用 ${crypto.libraries.length} 个加密库`);
  }
  if (obfuscation.hasObfuscation) {
    parts.push(`发现 ${obfuscation.types.length} 种混淆类型`);
  }
  if (scripts.some(s => s.riskScore > 70)) {
    parts.push(`${scripts.filter(s => s.riskScore > 70).length} 个高风险脚本`);
  }

  const base = `总体风险等级：${level.toUpperCase()}`;
  return parts.length > 0 ? `${base} - ${parts.join(', ')}` : base;
}

/**
 * 判断是否为标准加密库
 */
function isStandardCryptoLib(lib: string): boolean {
  const standardLibs = [
    'CryptoJS',
    'WebCrypto',
    'SJCL',
    'node-forge',
    'crypto-js',
  ];
  return standardLibs.includes(lib);
}
