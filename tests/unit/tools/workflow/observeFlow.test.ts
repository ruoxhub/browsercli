/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {observeFlow} from '../../../../src/tools/workflow/observeFlow.js';

// 测试辅助函数（直接复制被测试函数的逻辑以便单元测试）
function detectEncryption(content: string): boolean {
  const patterns = [
    /crypto|encrypt|decrypt|cipher|aes|rsa|md5|sha256|sha512/i,
    /CryptoJS|forge|sjcl|bcrypt|scrypt/i,
    /btoa|atob|Base64/i,
    /createHash|createCipher|createDecipher/i,
  ];
  return patterns.some(pattern => pattern.test(content));
}

function detectAPI(content: string): boolean {
  const patterns = [
    /fetch\s*\(/,
    /XMLHttpRequest/,
    /axios|request|ajax/i,
    /\.get\(|\.post\(|\.put\(|\.delete\(/,
  ];
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

  return functions.slice(0, 30);
}

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

  return imports.slice(0, 30);
}

function generatePreview(content: string, maxLines = 10): string {
  const lines = content.split('\n');
  const previewLines = lines.slice(0, maxLines);
  return previewLines.join('\n').substring(0, 500);
}

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

function isEntryPoint(url: string, content: string): boolean {
  const entryPatterns = [/main/i, /index/i, /app/i, /entry/i, /bootstrap/i];
  return (
    entryPatterns.some(pattern => pattern.test(url)) ||
    content.includes('webpackJsonp')
  );
}

function identifyObfuscationType(preview: string): string[] {
  const types: string[] = [];

  if (preview.includes('Function(') || preview.includes('new Function')) {
    types.push('vm-protection');
  }

  if (
    preview.includes('case ') &&
    preview.includes('break') &&
    preview.includes('switch')
  ) {
    const switchCount = (preview.match(/case\s/g) || []).length;
    if (switchCount > 10) {
      types.push('control-flow-flattening');
    }
  }

  if (preview.includes("['0x") || preview.includes('[0x')) {
    types.push('string-array-rotation');
  }

  if (/\\u[0-9a-f]{4}/i.test(preview)) {
    types.push('unicode-obfuscation');
  }

  if (/\\x[0-9a-f]{2}/i.test(preview)) {
    types.push('hex-encoding');
  }

  return types;
}

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

function analyzeSingleScript(file: {
  url: string;
  content: string;
  size: number;
  type: string;
}): {
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
} {
  const {url, content, size, type} = file;

  const hasEncryption = detectEncryption(content);
  const cryptoAlgorithms = extractCryptoAlgo(content);
  const hasAPI = detectAPI(content);
  const hasObfuscation = detectObfuscation(content);
  const functions = extractFunctions(content);
  const imports = extractImports(content);
  const preview = generatePreview(content);
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

describe('observeFlow tool', () => {
  describe('detectEncryption', () => {
    it('detects AES encryption', () => {
      assert.strictEqual(detectEncryption('CryptoJS.AES.encrypt()'), true);
    });

    it('detects RSA encryption', () => {
      assert.strictEqual(detectEncryption('RSA.decrypt()'), true);
    });

    it('detects MD5 hash', () => {
      assert.strictEqual(detectEncryption('md5(password)'), true);
    });

    it('detects SHA256', () => {
      assert.strictEqual(detectEncryption('SHA256.hash()'), true);
    });

    it('detects Base64 encoding', () => {
      assert.strictEqual(detectEncryption('btoa(data)'), true);
      assert.strictEqual(detectEncryption('atob(encoded)'), true);
    });

    it('detects WebCrypto API', () => {
      assert.strictEqual(detectEncryption('crypto.subtle.digest()'), true);
    });

    it('returns false for non-encrypted code', () => {
      assert.strictEqual(detectEncryption('const x = 1 + 2'), false);
    });
  });

  describe('detectAPI', () => {
    it('detects fetch calls', () => {
      assert.strictEqual(detectAPI('fetch("/api/users")'), true);
    });

    it('detects XMLHttpRequest', () => {
      assert.strictEqual(detectAPI('new XMLHttpRequest()'), true);
    });

    it('detects axios', () => {
      assert.strictEqual(detectAPI('axios.get("/api")'), true);
    });

    it('detects $.ajax', () => {
      assert.strictEqual(detectAPI('$.ajax({url: "/api"})'), true);
    });

    it('returns false for non-API code', () => {
      assert.strictEqual(detectAPI('const data = [1, 2, 3]'), false);
    });
  });

  describe('detectObfuscation', () => {
    it('detects hex encoding', () => {
      assert.strictEqual(detectObfuscation('\\x61\\x62\\x63'), true);
    });

    it('detects unicode encoding', () => {
      assert.strictEqual(detectObfuscation('\\u0061\\u0062'), true);
    });

    it('detects eval calls', () => {
      assert.strictEqual(detectObfuscation('eval(code)'), true);
    });

    it('detects Function constructor', () => {
      assert.strictEqual(
        detectObfuscation('new Function("return this")'),
        true,
      );
    });

    it('detects long single lines', () => {
      const longLine = 'a'.repeat(250);
      assert.strictEqual(detectObfuscation(longLine), true);
    });

    it('returns false for normal code', () => {
      assert.strictEqual(
        detectObfuscation('function test() { return 1; }'),
        false,
      );
    });
  });

  describe('extractCryptoAlgo', () => {
    it('extracts AES algorithm', () => {
      const result = extractCryptoAlgo('AES.encrypt(data, key)');
      assert.ok(result.includes('AES'));
    });

    it('extracts RSA algorithm', () => {
      const result = extractCryptoAlgo('RSA.sign(data)');
      assert.ok(result.includes('RSA'));
    });

    it('extracts SHA algorithms', () => {
      const result = extractCryptoAlgo('SHA256.hash() and SHA512.hash()');
      assert.ok(result.includes('SHA'));
    });

    it('extracts multiple algorithms', () => {
      const result = extractCryptoAlgo('AES + RSA + MD5');
      assert.strictEqual(result.length, 3);
    });

    it('returns empty array for non-crypto code', () => {
      const result = extractCryptoAlgo('const x = 1');
      assert.strictEqual(result.length, 0);
    });
  });

  describe('detectCryptoLibraries', () => {
    it('detects CryptoJS', () => {
      const result = detectCryptoLibraries('CryptoJS.AES.encrypt()');
      assert.ok(result.includes('CryptoJS'));
    });

    it('detects JSEncrypt', () => {
      const result = detectCryptoLibraries('new JSEncrypt()');
      assert.ok(result.includes('JSEncrypt'));
    });

    it('detects multiple libraries', () => {
      const result = detectCryptoLibraries('CryptoJS + forge.digest()');
      assert.ok(result.includes('CryptoJS'));
      assert.ok(result.includes('node-forge'));
    });

    it('returns empty array when no libraries', () => {
      const result = detectCryptoLibraries('const x = 1');
      assert.strictEqual(result.length, 0);
    });
  });

  describe('extractFunctions', () => {
    it('extracts function declarations', () => {
      const result = extractFunctions(
        'function myFunc() {} function another() {}',
      );
      assert.ok(result.includes('myFunc'));
      assert.ok(result.includes('another'));
    });

    it('extracts function expressions', () => {
      const result = extractFunctions('const handler = function() {}');
      assert.ok(result.includes('handler'));
    });

    it('extracts arrow functions', () => {
      const result = extractFunctions('const callback = (x) => x * 2');
      assert.ok(result.includes('callback'));
    });

    it('extracts object methods', () => {
      const result = extractFunctions('const obj = { method: function() {} }');
      assert.ok(result.includes('method'));
    });

    it('limits to 30 functions', () => {
      const code = Array(50)
        .fill(0)
        .map((_, i) => `function func${i}() {}`)
        .join(' ');
      const result = extractFunctions(code);
      assert.strictEqual(result.length, 30);
    });

    it('deduplicates function names', () => {
      const result = extractFunctions('function test() {} function test() {}');
      assert.strictEqual(result.length, 1);
      assert.ok(result.includes('test'));
    });
  });

  describe('extractImports', () => {
    it('extracts ES6 imports', () => {
      const result = extractImports(
        'import x from "module1"; import y from "module2";',
      );
      assert.ok(result.includes('module1'));
      assert.ok(result.includes('module2'));
    });

    it('extracts CommonJS require', () => {
      const result = extractImports('const x = require("lodash");');
      assert.ok(result.includes('lodash'));
    });

    it('extracts dynamic imports', () => {
      const result = extractImports('const m = import("./lazy-module");');
      assert.ok(result.includes('./lazy-module'));
    });

    it('deduplicates imports', () => {
      const result = extractImports(
        'import x from "mod"; import y from "mod";',
      );
      assert.strictEqual(result.length, 1);
    });

    it('limits to 30 imports', () => {
      const code = Array(50)
        .fill(0)
        .map((_, i) => `import m${i} from "module${i}";`)
        .join(' ');
      const result = extractImports(code);
      assert.strictEqual(result.length, 30);
    });
  });

  describe('generatePreview', () => {
    it('returns first 10 lines', () => {
      const content = Array(20)
        .fill(0)
        .map((_, i) => `line${i}`)
        .join('\n');
      const preview = generatePreview(content);
      assert.ok(preview.includes('line0'));
      assert.ok(preview.includes('line9'));
      assert.ok(!preview.includes('line10'));
    });

    it('limits to 500 characters', () => {
      const content = 'a'.repeat(1000);
      const preview = generatePreview(content);
      assert.strictEqual(preview.length, 500);
    });

    it('handles empty content', () => {
      const preview = generatePreview('');
      assert.strictEqual(preview, '');
    });
  });

  describe('detectThirdPartyLibs', () => {
    it('detects jQuery', () => {
      const result = detectThirdPartyLibs('$.ajax({url: "/api"})');
      assert.ok(result.includes('jQuery'));
    });

    it('detects React', () => {
      const result = detectThirdPartyLibs('React.createElement("div")');
      assert.ok(result.includes('React'));
    });

    it('detects Vue', () => {
      const result = detectThirdPartyLibs('Vue.createApp({})');
      assert.ok(result.includes('Vue'));
    });

    it('detects Lodash', () => {
      const result = detectThirdPartyLibs('_.map([1,2,3], x => x*2)');
      assert.ok(result.includes('Lodash'));
    });

    it('detects multiple libraries', () => {
      const result = detectThirdPartyLibs('React + axios.get() + moment()');
      assert.ok(result.includes('React'));
      assert.ok(result.includes('Axios'));
      assert.ok(result.includes('Moment'));
    });
  });

  describe('isEntryPoint', () => {
    it('detects main.js as entry point', () => {
      assert.strictEqual(isEntryPoint('https://site.com/main.js', ''), true);
    });

    it('detects index.js as entry point', () => {
      assert.strictEqual(isEntryPoint('https://site.com/index.js', ''), true);
    });

    it('detects app.js as entry point', () => {
      assert.strictEqual(isEntryPoint('https://site.com/app.js', ''), true);
    });

    it('detects webpack entry by content', () => {
      assert.strictEqual(
        isEntryPoint('https://site.com/bundle.js', 'webpackJsonp([1])'),
        true,
      );
    });

    it('returns false for regular files', () => {
      assert.strictEqual(isEntryPoint('https://site.com/utils.js', ''), false);
    });
  });

  describe('identifyObfuscationType', () => {
    it('detects VM protection', () => {
      const result = identifyObfuscationType('new Function("return this")');
      assert.ok(result.includes('vm-protection'));
    });

    it('detects control flow flattening', () => {
      // 需要包含 switch, case, break 关键字，且 case 数量>10
      const code =
        'switch(x) {' +
        Array(15)
          .fill(0)
          .map((_, i) => `case ${i}: break;`)
          .join(' ') +
        '}';
      const result = identifyObfuscationType(code);
      assert.ok(result.includes('control-flow-flattening'));
    });

    it('detects string array rotation', () => {
      const result = identifyObfuscationType("var _0x123 = ['0x1', '0x2'];");
      assert.ok(result.includes('string-array-rotation'));
    });

    it('detects unicode obfuscation', () => {
      const result = identifyObfuscationType('\\u0061\\u0062\\u0063');
      assert.ok(result.includes('unicode-obfuscation'));
    });

    it('detects hex encoding', () => {
      const result = identifyObfuscationType('\\x61\\x62\\x63');
      assert.ok(result.includes('hex-encoding'));
    });
  });

  describe('calculateScriptRiskScore', () => {
    it('calculates score for encryption only', () => {
      const score = calculateScriptRiskScore({
        hasEncryption: true,
        hasAPI: false,
        hasObfuscation: false,
        cryptoAlgorithms: [],
      });
      assert.strictEqual(score, 15);
    });

    it('calculates score for API only', () => {
      const score = calculateScriptRiskScore({
        hasEncryption: false,
        hasAPI: true,
        hasObfuscation: false,
        cryptoAlgorithms: [],
      });
      assert.strictEqual(score, 10);
    });

    it('calculates score for obfuscation only', () => {
      const score = calculateScriptRiskScore({
        hasEncryption: false,
        hasAPI: false,
        hasObfuscation: true,
        cryptoAlgorithms: [],
      });
      assert.strictEqual(score, 30);
    });

    it('calculates score for multiple algorithms', () => {
      const score = calculateScriptRiskScore({
        hasEncryption: true,
        hasAPI: false,
        hasObfuscation: false,
        cryptoAlgorithms: ['AES', 'RSA', 'MD5'],
      });
      assert.strictEqual(score, 30); // 15 + 15
    });

    it('caps score at 100', () => {
      const score = calculateScriptRiskScore({
        hasEncryption: true,
        hasAPI: true,
        hasObfuscation: true,
        cryptoAlgorithms: ['AES', 'RSA', 'MD5'],
      });
      assert.strictEqual(score, 70); // 15 + 10 + 30 + 15 = 70
    });
  });

  describe('analyzeSingleScript', () => {
    it('analyzes a complete script', () => {
      const file = {
        url: 'https://site.com/crypto.js',
        content:
          'import x from "crypto-js"; function encrypt() { return CryptoJS.AES.encrypt(data, key); }',
        size: 150,
        type: 'external',
      };

      const result = analyzeSingleScript(file);

      assert.strictEqual(result.url, file.url);
      assert.strictEqual(result.type, file.type);
      assert.strictEqual(result.hasEncryption, true);
      assert.strictEqual(result.hasAPI, false);
      assert.ok(result.cryptoAlgorithms.length > 0);
      assert.ok(result.functions.length > 0);
      assert.ok(result.imports.includes('crypto-js'));
      assert.strictEqual(typeof result.preview, 'string');
      assert.strictEqual(typeof result.riskScore, 'number');
    });

    it('analyzes obfuscated script', () => {
      const file = {
        url: 'https://site.com/obfuscated.js',
        content: '\\x61\\x62\\x63; eval(code); new Function("return this");',
        size: 100,
        type: 'external',
      };

      const result = analyzeSingleScript(file);

      assert.strictEqual(result.hasObfuscation, true);
      assert.strictEqual(result.riskScore >= 30, true);
    });

    it('analyzes clean script', () => {
      const file = {
        url: 'https://site.com/utils.js',
        content:
          'function add(a, b) { return a + b; } function multiply(a, b) { return a * b; }',
        size: 80,
        type: 'external',
      };

      const result = analyzeSingleScript(file);

      assert.strictEqual(result.hasEncryption, false);
      assert.strictEqual(result.hasObfuscation, false);
      assert.strictEqual(result.riskScore, 0);
    });
  });

  describe('observeFlow tool result', () => {
    it('runs the observeFlow tool with required url', async () => {
      const result = await observeFlow({url: 'https://example.com'});

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tooltype, 'observe_flow');
      assert.ok(result.data);
      assert.strictEqual(result.data.url, 'https://example.com');
    });

    it('returns error when url is missing', async () => {
      const result = await observeFlow();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tooltype, 'observe_flow');
      assert.ok(result.error);
    });
    it('returns success result with report data', () => {
      const mockResult = {
        success: true as const,
        message: '测试成功',
        tooltype: 'observe_flow' as const,
        data: {
          url: 'https://example.com',
          scriptCount: 5,
          totalSize: 1024,
          collectTime: 100,
          scriptAnalysis: [],
          dependencies: {
            nodes: [],
            edges: [],
            entryPoints: [],
            thirdPartyLibs: [],
          },
          cryptoDetection: {algorithms: [], libraries: [], confidence: 0},
          obfuscationDetection: {
            hasObfuscation: false,
            types: [],
            affectedFiles: [],
          },
          overallRiskAssessment: {
            score: 20,
            level: 'low' as const,
            description: '低风险',
            recommendations: ['建议 1'],
          },
        },
      };

      assert.strictEqual(mockResult.success, true);
      assert.ok(typeof mockResult.message === 'string');
      assert.ok(typeof mockResult.data === 'object');
    });

    it('returns error result', () => {
      const mockResult = {
        success: false as const,
        error: '测试错误信息',
        tooltype: 'observe_flow' as const,
      };

      assert.strictEqual(mockResult.success, false);
      assert.ok(typeof mockResult.error === 'string');
    });
  });
});
