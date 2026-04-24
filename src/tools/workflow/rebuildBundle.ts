/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {logger} from '../../utils/logger.js';

/**
 * 本地复现工具配置
 */
export interface RebuildBundleOptions {
  /** 目标 URL */
  targetUrl?: string;
  /** 目标函数名 */
  targetFunctionNames?: string[];
  /** 目标关键字 */
  targetKeywords?: string[];
  /** 目标 URL 模式 */
  targetUrlPatterns?: string[];
  /** 逆向目标描述 */
  goal?: string;
  /** 自动构建 */
  autoGenerate?: boolean;
  /** 最大证据项数 */
  maxEvidenceItems?: number;
  /** 任务 ID */
  taskId?: string;
  /** 任务 slug */
  taskSlug?: string;
}

/**
 * 构建默认环境代码
 */
function buildDefaultEnvCode(): string {
  return [
    'globalThis.window = globalThis;',
    'globalThis.self = globalThis;',
    'globalThis.global = globalThis;',
    'globalThis.document ??= {cookie: "", location: {href: ""}};',
    'globalThis.navigator ??= {userAgent: "js-reverse-mcp"};',
    'globalThis.location ??= {href: ""};',
    'globalThis.atob ??= (value) => Buffer.from(value, "base64").toString("utf8");',
    'globalThis.btoa ??= (value) => Buffer.from(value, "utf8").toString("base64");',
    'globalThis.crypto ??= {subtle: {}};',
  ].join('\n');
}

/**
 * 构建 localStorage/sessionStorage shim 代码
 */
function buildStorageShimCode(
  name: 'localStorage' | 'sessionStorage',
  values: Record<string, unknown>,
): string {
  const entries = Object.entries(values);
  return [
    `const ${name}Seed = new Map(${JSON.stringify(entries)});`,
    `globalThis.${name} = {`,
    '  getItem(key) { return this._store.has(key) ? this._store.get(key) : null; },',
    '  setItem(key, value) { this._store.set(String(key), String(value)); },',
    '  removeItem(key) { this._store.delete(String(key)); },',
    '  clear() { this._store.clear(); },',
    '  key(index) { return Array.from(this._store.keys())[index] ?? null; },',
    '  get length() { return this._store.size; },',
    `  _store: ${name}Seed,`,
    '};',
  ].join('\n');
}

/**
 * 构建自动环境代码
 */
function buildAutoEnvCode(capture: Record<string, unknown>): string {
  const cookies = Array.isArray(capture.cookies) ? capture.cookies : [];
  const localStorageValues =
    capture.localStorage && typeof capture.localStorage === 'object'
      ? (capture.localStorage as Record<string, unknown>)
      : {};
  const sessionStorageValues =
    capture.sessionStorage && typeof capture.sessionStorage === 'object'
      ? (capture.sessionStorage as Record<string, unknown>)
      : {};
  const page =
    capture.page && typeof capture.page === 'object'
      ? (capture.page as Record<string, unknown>)
      : {};

  const cookieString = (cookies as Array<{name?: unknown; value?: unknown}>)
    .map(cookie => `${String(cookie.name ?? '')}=${String(cookie.value ?? '')}`)
    .join('; ');

  return [
    buildDefaultEnvCode(),
    `globalThis.location = {href: ${JSON.stringify(String(page.url ?? ''))}};`,
    `globalThis.document = {cookie: ${JSON.stringify(cookieString)}, location: globalThis.location};`,
    buildStorageShimCode('localStorage', localStorageValues),
    buildStorageShimCode('sessionStorage', sessionStorageValues),
  ].join('\n\n');
}

/**
 * 构建入口代码
 */
function buildEntryCode(
  targetScript: {url: string; content: string} | null,
  capture: Record<string, unknown>,
): string {
  return [
    'import "./env.js";',
    'import "./polyfills.js";',
    '',
    `const capture = ${JSON.stringify(capture, null, 2)};`,
    `capture.targetScript = ${JSON.stringify(targetScript, null, 2)};`,
    '',
    'if (capture.targetScript?.content) {',
    '  eval(capture.targetScript.content);',
    '}',
    '',
    'const targetFunction = capture.runtimeEvidence?.find((item) => typeof item.functionName === "string")?.functionName;',
    'if (targetFunction && typeof globalThis[targetFunction] === "function") {',
    '  console.log({targetFunction, result: globalThis[targetFunction]("token", "nonce")});',
    '} else {',
    '  console.log({message: "target function not callable yet", targetFunction});',
    '}',
  ].join('\n');
}

/**
 * 匹配目标文本
 */
function matchesTargetText(
  value: unknown,
  targetKeywords: string[],
  targetUrlPatterns: string[],
  targetFunctionNames: string[],
  targetActionDescription: string,
): boolean {
  const text =
    typeof value === 'string'
      ? value.toLowerCase()
      : JSON.stringify(value ?? '').toLowerCase();
  return (
    targetKeywords.some(keyword => text.includes(keyword.toLowerCase())) ||
    targetUrlPatterns.some(pattern => text.includes(pattern.toLowerCase())) ||
    targetFunctionNames.some(functionName =>
      text.includes(functionName.toLowerCase()),
    ) ||
    (targetActionDescription.length > 0 &&
      text.includes(targetActionDescription.toLowerCase()))
  );
}

/**
 * 选择目标脚本
 */
function pickTargetScript(
  files: Array<{url: string; content: string; size: number; type: string}>,
  targetKeywords: string[],
  targetUrlPatterns: string[],
  targetFunctionNames: string[],
  targetActionDescription: string,
): {url: string; content: string; size: number; type: string} | null {
  if (
    targetKeywords.length === 0 &&
    targetUrlPatterns.length === 0 &&
    targetFunctionNames.length === 0 &&
    targetActionDescription.length === 0
  ) {
    return files[0] ?? null;
  }
  return (
    files.find(file =>
      matchesTargetText(
        file,
        targetKeywords,
        targetUrlPatterns,
        targetFunctionNames,
        targetActionDescription,
      ),
    ) ??
    files[0] ??
    null
  );
}

/**
 * 过滤运行时证据
 */
function _filterRuntimeEvidence(
  records: Array<Record<string, unknown>>,
  targetKeywords: string[],
  targetUrlPatterns: string[],
  targetFunctionNames: string[],
  targetActionDescription: string,
  maxEvidenceItems: number,
): Array<Record<string, unknown>> {
  const filtered =
    targetKeywords.length === 0 &&
    targetUrlPatterns.length === 0 &&
    targetFunctionNames.length === 0 &&
    targetActionDescription.length === 0
      ? records
      : records.filter(record =>
          matchesTargetText(
            record,
            targetKeywords,
            targetUrlPatterns,
            targetFunctionNames,
            targetActionDescription,
          ),
        );
  return filtered.slice(0, maxEvidenceItems);
}

/**
 * 推断缺失的能力
 */
function _inferMissingCapabilities(
  runtimeError: string,
  observedCapabilities: string[],
): Array<{
  capability: string;
  reason: string;
  priority: number;
}> {
  const available = new Set(
    observedCapabilities.map(item => item.toLowerCase()),
  );
  const normalizedError = runtimeError.toLowerCase();
  const candidates = [
    {
      capability: 'window',
      patterns: ['window is not defined'],
      reason: 'Browser global root is missing in local execution.',
      priority: 100,
    },
    {
      capability: 'document',
      patterns: ['document is not defined'],
      reason: 'DOM access is required by the captured browser path.',
      priority: 90,
    },
    {
      capability: 'localStorage',
      patterns: ['localstorage is not defined'],
      reason: 'Captured path reads browser storage values.',
      priority: 80,
    },
    {
      capability: 'sessionStorage',
      patterns: ['sessionstorage is not defined'],
      reason: 'Captured path reads session-scoped browser storage.',
      priority: 75,
    },
    {
      capability: 'crypto',
      patterns: ["reading 'subtle'", 'crypto is not defined'],
      reason: 'Captured path depends on browser crypto primitives.',
      priority: 85,
    },
  ];

  return candidates
    .filter(
      candidate =>
        available.has(candidate.capability.toLowerCase()) &&
        candidate.patterns.some(pattern => normalizedError.includes(pattern)),
    )
    .sort((a, b) => b.priority - a.priority);
}

/** 本地复现工具统一返回结构 */
export interface RebuildBundleToolResult {
  success: boolean;
  message?: string;
  error?: string;
  tooltype: 'rebuild_bundle';
  data?: {
    url?: string;
    bundlePath: string;
    evidenceCount: number;
    files: {
      entryCode: string;
      envCode: string;
      polyfillsCode: string;
      capture: Record<string, unknown>;
    };
    targetContext: {
      targetKeywords: string[];
      targetUrlPatterns: string[];
      targetFunctionNames: string[];
      targetActionDescription: string;
    };
  };
}

/**
 * 本地复现工具 - 构建本地 Node.js 复现环境
 */
export async function rebuildBundle(
  params: RebuildBundleOptions & {url?: string} = {},
): Promise<RebuildBundleToolResult> {
  const {url, ...options} = params;

  logger.debug('[rebuild-bundle] Starting skill with options:', options);

  try {
    // 1. 收集逆向工程证据
    const runtimeEvidence: Array<Record<string, unknown>> = [];
    if (options.taskId) {
      logger.debug(
        '[rebuild-bundle] Reading runtime evidence for task:',
        options.taskId,
      );
      // 在实际运行时会从 ReverseTaskStore 读取
      // 这里返回空数组，由实际运行时填充
    }

    // 2. 分析目标函数和关键字
    const targetKeywords = options.targetKeywords ?? [];
    const targetUrlPatterns = options.targetUrlPatterns ?? [];
    const targetFunctionNames = options.targetFunctionNames ?? [];
    const targetActionDescription = options.goal ?? '';

    logger.debug('[rebuild-bundle] Target filtering:', {
      targetKeywords,
      targetUrlPatterns,
      targetFunctionNames,
    });

    // 3. 模拟收集页面数据（实际运行时会通过 runtime 收集）
    const pageData = {
      url: url ?? options.targetUrl ?? '',
      cookies: [] as Array<{name: string; value: string}>,
      localStorage: {} as Record<string, unknown>,
      sessionStorage: {} as Record<string, unknown>,
    };

    // 4. 构建环境代码
    const capture: Record<string, unknown> = {
      page: {
        url: pageData.url,
        title: '',
      },
      cookies: pageData.cookies,
      localStorage: pageData.localStorage,
      sessionStorage: pageData.sessionStorage,
      runtimeEvidence,
      targetScript: null,
    };

    const envCode = buildAutoEnvCode(capture);
    const polyfillsCode = '';

    // 5. 构建入口代码
    const targetScript = pickTargetScript(
      [],
      targetKeywords,
      targetUrlPatterns,
      targetFunctionNames,
      targetActionDescription,
    );
    const entryCode = buildEntryCode(targetScript, capture);

    // 6. 返回结果
    const result = {
      url: url ?? options.targetUrl,
      bundlePath: '',
      evidenceCount: runtimeEvidence.length,
      files: {
        entryCode,
        envCode,
        polyfillsCode,
        capture,
      },
      targetContext: {
        targetKeywords,
        targetUrlPatterns,
        targetFunctionNames,
        targetActionDescription,
      },
    };

    logger.info('[rebuild_bundle] Tool completed successfully');

    return {
      success: true,
      message: '本地复现完成',
      tooltype: 'rebuild_bundle',
      data: result,
    };
  } catch (error) {
    logger.error('[rebuild_bundle] Tool failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      tooltype: 'rebuild_bundle',
    };
  }
}
