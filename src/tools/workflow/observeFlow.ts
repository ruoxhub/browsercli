/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

/**
 * 观察模式工具 - 收集和分析页面脚本
 */
export const observeFlow = defineTool({
  name: 'observe_flow',
  description: 'Observe mode: collect and analyze page scripts, identify encryption and obfuscation, generate risk assessment report',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    url: zod.string().optional().describe('Target URL to observe'),
    includeDynamic: zod.boolean().optional().describe('Include dynamic scripts'),
    includeExternal: zod.boolean().optional().describe('Include external scripts'),
    includeInline: zod.boolean().optional().describe('Include inline scripts'),
    includeServiceWorker: zod.boolean().optional().describe('Include Service Worker scripts'),
    includeWebWorker: zod.boolean().optional().describe('Include Web Worker scripts'),
    maxFileSize: zod.number().optional().describe('Maximum file size in bytes'),
    maxTotalSize: zod.number().optional().describe('Maximum total size in bytes'),
    mode: zod.enum(['summary', 'priority', 'incremental', 'full']).optional().describe('Collection mode'),
    smartMode: zod.boolean().optional().describe('Enable smart mode'),
    dynamicWaitMs: zod.number().optional().describe('Dynamic script wait time in ms'),
    priorities: zod.array(zod.string()).optional().describe('Priority URL patterns'),
    compress: zod.boolean().optional().describe('Compress code'),
    timeout: zod.number().optional().describe('Timeout in ms'),
  },
  handler: async (request, response, context) => {
    const options = request.params;
    const paramUrl = options.url;

    try {
      logger.info('Starting observe_flow tool...');
      const startTime = Date.now();

      const url =
        paramUrl ?? context.getSelectedPage()?.url?.() ?? undefined;

      if (!url) {
        response.appendResponseLine('```json');
        response.appendResponseLine(
          JSON.stringify(
            {
              success: false,
              error: '缺少 url 参数，且当前没有选中的页面。请提供 url 参数或先导航到目标页面。',
              tooltype: 'observe_flow',
            },
            null,
            2,
          ),
        );
        response.appendResponseLine('```');
        return;
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
      logger.info(`Crypto detection: ${cryptoDetection.algorithms.length} algorithms found`);

      // 5. 检测混淆代码
      const obfuscationDetection = detectObfuscationPatterns(collectResult.files, scriptAnalysis);
      logger.info(`Obfuscation detection: ${obfuscationDetection.types.length} types found`);

      // 6. 生成风险评估
      const riskAssessment = assessOverallRisk(scriptAnalysis, cryptoDetection, obfuscationDetection);
      logger.info(`Risk assessment: ${riskAssessment.level} (${riskAssessment.score}/100)`);

      const duration = Date.now() - startTime;

      const report = {
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

      response.setStructuredContent({
          success: true,
          message: `观察模式完成：收集 ${report.scriptCount} 个脚本，发现 ${cryptoDetection.algorithms.length} 种加密算法，${obfuscationDetection.types.length} 种混淆类型`,
          tooltype: 'observe_flow',
          data: report
      });
    } catch (error) {
      logger.error('observe_flow tool failed', error);
      response.setStructuredContent({
        success: false,
        message: error instanceof Error ? error.message : String(error),
        tooltype: 'observe_flow',
      });
    }
  },
});

// ==================== 辅助类型和函数 ====================

export interface ScriptAnalysis {
  url: string;
  type: string;
  size: number;
  hasEncryption: boolean;
  hasAPI: boolean;
  hasObfuscation: boolean;
  cryptoAlgorithms: string[];
  functions: string[];
  imports: string[];
  preview: string;
  riskScore: number;
}

export interface DependencyInfo {
  nodes: Array<{id: string; url: string; type: string}>;
  edges: Array<{from: string; to: string; type: string}>;
  entryPoints: string[];
  thirdPartyLibs: string[];
}

async function collectScripts(
  url: string,
  options: Record<string, unknown>,
): Promise<{
  files: Array<{url: string; content: string; size: number; type: string}>;
  totalSize: number;
}> {
  const collector = getRuntime().contextProvider!.collector;
  if (collector) {
    try {
      const result = await collector.collect({
        url,
        includeInline: (options.includeInline as boolean) ?? true,
        includeExternal: (options.includeExternal as boolean) ?? true,
        includeDynamic: (options.includeDynamic as boolean) ?? false,
        includeServiceWorker: (options.includeServiceWorker as boolean) ?? false,
        includeWebWorker: (options.includeWebWorker as boolean) ?? false,
        maxFileSize: (options.maxFileSize as number) ?? 100 * 1024,
        maxTotalSize: (options.maxTotalSize as number) ?? 512 * 1024,
        timeout: (options.timeout as number) ?? 30000,
        dynamicWaitMs: (options.dynamicWaitMs as number) ?? 3000,
        smartMode: (options.mode as 'summary' | 'priority' | 'incremental' | 'full') ?? 'full',
        compress: (options.compress as boolean) ?? false,
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
          (collectorError instanceof Error ? collectorError.message : String(collectorError)),
      );
    }
  }

  logger.warn('observe_flow: CodeCollector 未初始化，返回空脚本列表。');
  return {files: [], totalSize: 0};
}

function analyzeScripts(
  files: Array<{url: string; content: string; size: number; type: string}>,
): ScriptAnalysis[] {
  return files.map(file => analyzeSingleScript(file));
}

function analyzeSingleScript(file: {
  url: string;
  content: string;
  size: number;
  type: string;
}): ScriptAnalysis {
  const {url, content, size, type} = file;
  const hasEncryption = detectEncryption(content);
  const cryptoAlgorithms = extractCryptoAlgo(content);
  const hasAPI = detectAPI(content);
  const hasObfuscation = detectObfuscation(content);
  const functions = extractFunctions(content);
  const imports = extractImports(content);
  const preview = generatePreview(content);
  const riskScore = calculateScriptRiskScore({hasEncryption, hasAPI, hasObfuscation, cryptoAlgorithms});

  return {url, type, size, hasEncryption, hasAPI, hasObfuscation, cryptoAlgorithms, functions, imports, preview, riskScore};
}

function analyzeDependencies(
  files: Array<{url: string; content: string; size: number; type: string}>,
): DependencyInfo {
  const nodes: DependencyInfo['nodes'] = [];
  const edges: DependencyInfo['edges'] = [];
  const entryPoints: string[] = [];
  const thirdPartyLibs: string[] = [];

  files.forEach(file => {
    nodes.push({id: file.url, url: file.url, type: file.type});
    if (isEntryPoint(file.url, file.content)) {
      entryPoints.push(file.url);
    }
    const libs = detectThirdPartyLibs(file.content);
    libs.forEach(lib => {
      if (!thirdPartyLibs.includes(lib)) thirdPartyLibs.push(lib);
    });
  });

  files.forEach(file => {
    const imports = extractImports(file.content);
    imports.forEach(imp => {
      const targetFile = files.find(f => f.url.includes(imp) || f.url.endsWith(imp));
      if (targetFile) edges.push({from: file.url, to: targetFile.url, type: 'import'});
    });
  });

  return {nodes, edges, entryPoints, thirdPartyLibs};
}

function detectCryptoPatterns(
  files: Array<{url: string; content: string; size: number; type: string}>,
): {algorithms: string[]; libraries: string[]; confidence: number} {
  const allAlgorithms = new Set<string>();
  const allLibraries = new Set<string>();
  let totalConfidence = 0;
  let count = 0;

  files.forEach(file => {
    const libs = detectCryptoLibraries(file.content);
    libs.forEach(lib => allLibraries.add(lib));
    const algos = extractCryptoAlgo(file.content);
    algos.forEach(algo => allAlgorithms.add(algo));
    if (algos.length > 0 || libs.length > 0) {
      totalConfidence += 0.8;
      count++;
    }
  });

  return {
    algorithms: Array.from(allAlgorithms),
    libraries: Array.from(allLibraries),
    confidence: count > 0 ? totalConfidence / count : 0,
  };
}

function detectObfuscationPatterns(
  files: Array<{url: string; content: string; size: number; type: string}>,
  scriptAnalysis: ScriptAnalysis[],
): {hasObfuscation: boolean; types: string[]; affectedFiles: string[]} {
  const types = new Set<string>();
  const affectedFiles: string[] = [];

  scriptAnalysis.forEach(analysis => {
    if (analysis.hasObfuscation) {
      affectedFiles.push(analysis.url);
      const obfTypes = identifyObfuscationType(analysis);
      obfTypes.forEach(t => types.add(t));
    }
  });

  return {hasObfuscation: affectedFiles.length > 0, types: Array.from(types), affectedFiles};
}

function assessOverallRisk(
  scriptAnalysis: ScriptAnalysis[],
  cryptoDetection: {algorithms: string[]; libraries: string[]; confidence: number},
  obfuscationDetection: {hasObfuscation: boolean; types: string[]},
): {score: number; level: string; description: string; recommendations: string[]} {
  let score = 0;
  const recommendations: string[] = [];

  if (cryptoDetection.algorithms.length > 0) {
    score += 20;
    recommendations.push('检查加密算法的使用是否符合安全最佳实践');
  }
  if (cryptoDetection.libraries.some(lib => !isStandardCryptoLib(lib))) {
    score += 15;
    recommendations.push('检测到非标准加密库，建议审查其实现');
  }
  if (obfuscationDetection.hasObfuscation) {
    score += 30;
    recommendations.push('检测到代码混淆，可能需要反混淆分析');
    if (obfuscationDetection.types.some(t => ['vm-protection', 'control-flow-flattening'].includes(t))) {
      score += 20;
    }
  }
  const highRiskScripts = scriptAnalysis.filter(s => s.riskScore > 70).length;
  if (highRiskScripts > scriptAnalysis.length * 0.3) {
    score += 15;
    recommendations.push('高比例脚本存在风险特征，建议重点分析');
  }

  let level = 'low';
  if (score >= 80) level = 'critical';
  else if (score >= 60) level = 'high';
  else if (score >= 30) level = 'medium';

  if (recommendations.length === 0) recommendations.push('未发现明显风险特征');

  return {score: Math.min(100, score), level, description: `总体风险等级：${level.toUpperCase()}`, recommendations};
}

function detectEncryption(content: string): boolean {
  const patterns = [/crypto|encrypt|decrypt|cipher|aes|rsa|md5|sha256|sha512/i, /CryptoJS|forge|sjcl|bcrypt|scrypt/i, /btoa|atob|Base64/i, /createHash|createCipher|createDecipher/i];
  return patterns.some(pattern => pattern.test(content));
}

function detectAPI(content: string): boolean {
  const patterns = [/fetch\s*\(/, /XMLHttpRequest/, /axios|request|ajax/i, /\.get\(|\.post\(|\.put\(|\.delete\(/];
  return patterns.some(pattern => pattern.test(content));
}

function detectObfuscation(content: string): boolean {
  const lines = content.split('\n');
  const avgLineLength = content.length / (lines.length || 1);
  if (avgLineLength > 200) return true;
  if (/\\x[0-9a-f]{2}/i.test(content)) return true;
  if (/\\u[0-9a-f]{4}/i.test(content)) return true;
  if (/eval\s*\(/i.test(content)) return true;
  if (/Function\s*\(/i.test(content)) return true;
  if (/\[\s*['"][0-9]+['"]\s*\]/i.test(content)) return true;
  return false;
}

function extractCryptoAlgo(content: string): string[] {
  const algorithms: string[] = [];
  const patterns: Array<{pattern: RegExp; name: string}> = [
    {pattern: /\bAES\b/i, name: 'AES'}, {pattern: /\bDES\b/i, name: 'DES'},
    {pattern: /\bRSA\b/i, name: 'RSA'}, {pattern: /\bMD5\b/i, name: 'MD5'},
    {pattern: /\bSHA(1|256|384|512)\b/i, name: 'SHA'}, {pattern: /\bHMAC\b/i, name: 'HMAC'},
    {pattern: /\bECB|CBC|CFB|OFB|CTR|GCM\b/i, name: 'Mode'}, {pattern: /\bPKCS7|PKCS5|ZeroPadding\b/i, name: 'Padding'},
  ];
  patterns.forEach(({pattern, name}) => {
    if (pattern.test(content) && !algorithms.includes(name)) algorithms.push(name);
  });
  return algorithms;
}

function detectCryptoLibraries(content: string): string[] {
  const libraries: string[] = [];
  const patterns: Array<{pattern: RegExp; name: string}> = [
    {pattern: /CryptoJS/i, name: 'CryptoJS'}, {pattern: /JSEncrypt/i, name: 'JSEncrypt'},
    {pattern: /forge\./i, name: 'node-forge'}, {pattern: /sjcl/i, name: 'SJCL'},
    {pattern: /bcrypt/i, name: 'bcrypt'}, {pattern: /crypto-js/i, name: 'crypto-js'},
    {pattern: /webcrypto|crypto\.subtle/i, name: 'WebCrypto'}, {pattern: /sm-crypto/i, name: 'SM-Crypto'},
  ];
  patterns.forEach(({pattern, name}) => {
    if (pattern.test(content) && !libraries.includes(name)) libraries.push(name);
  });
  return libraries;
}

function extractFunctions(content: string): string[] {
  const functions: string[] = [];
  const patterns = [/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g, /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?function/g, /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\([^)]*\)\s*=>/g, /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s+)?function/g];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1] && !functions.includes(match[1])) functions.push(match[1]);
    }
  }
  return functions.slice(0, 30);
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const patterns = [/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g, /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1] && !imports.includes(match[1])) imports.push(match[1]);
    }
  }
  return imports.slice(0, 30);
}

function generatePreview(content: string, maxLines = 10): string {
  const lines = content.split('\n');
  const previewLines = lines.slice(0, maxLines);
  return previewLines.join('\n').substring(0, 500);
}

function detectThirdPartyLibs(content: string): string[] {
  const libs: string[] = [];
  const patterns = [/jquery|jQuery|\$\.ajax/i, /react|React\.|useState|useEffect/i, /vue|Vue\.|createApp/i, /lodash|_\./i, /axios|axios\./i, /moment|moment\./i, /rxjs|RxJS|Observable/i];
  const libNames = ['jQuery', 'React', 'Vue', 'Lodash', 'Axios', 'Moment', 'RxJS'];
  patterns.forEach((pattern, idx) => {
    if (pattern.test(content) && !libs.includes(libNames[idx]!)) libs.push(libNames[idx]!);
  });
  return libs;
}

function isEntryPoint(url: string, content: string): boolean {
  const entryPatterns = [/main/i, /index/i, /app/i, /entry/i, /bootstrap/i];
  return entryPatterns.some(pattern => pattern.test(url)) || content.includes('webpackJsonp');
}

function identifyObfuscationType(analysis: ScriptAnalysis): string[] {
  const types: string[] = [];
  if (analysis.preview.includes('Function(') || analysis.preview.includes('new Function')) types.push('vm-protection');
  if (analysis.preview.includes('case ') && analysis.preview.includes('break') && analysis.preview.includes('switch')) {
    const switchCount = (analysis.preview.match(/case\s/g) || []).length;
    if (switchCount > 10) types.push('control-flow-flattening');
  }
  if (analysis.preview.includes("['0x") || analysis.preview.includes('[0x')) types.push('string-array-rotation');
  if (/\\u[0-9a-f]{4}/i.test(analysis.preview)) types.push('unicode-obfuscation');
  if (/\\x[0-9a-f]{2}/i.test(analysis.preview)) types.push('hex-encoding');
  return types;
}

function calculateScriptRiskScore(analysis: {hasEncryption: boolean; hasAPI: boolean; hasObfuscation: boolean; cryptoAlgorithms: string[]}): number {
  let score = 0;
  if (analysis.hasEncryption) score += 15;
  if (analysis.hasAPI) score += 10;
  if (analysis.hasObfuscation) score += 30;
  if (analysis.cryptoAlgorithms.length > 2) score += 15;
  return Math.min(100, score);
}

function isStandardCryptoLib(lib: string): boolean {
  const standardLibs = ['CryptoJS', 'WebCrypto', 'SJCL', 'node-forge', 'crypto-js'];
  return standardLibs.includes(lib);
}
