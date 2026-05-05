/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {Runtime} from '../../runtime.js';
import type {CodeFile} from '../../types/index.js';

import type {AutoBundleOptions, AutoBundleResult, MissingCapability} from './types.js';

// ─── 纯函数（无 Puppeteer 依赖） ────────────────────────

/**
 * 生成默认浏览器环境补丁代码。
 *
 * 包含 window/self/global/document/navigator/location/atob/btoa/crypto 等基础 shim。
 */
export function buildDefaultEnvCode(): string {
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
 * 生成 localStorage/sessionStorage 的 shim 代码。
 */
export function toStorageShimCode(
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
 * 从浏览器捕获数据生成完整环境代码。
 *
 * 整合默认环境、Cookie、localStorage、sessionStorage 等。
 */
export function buildAutoEnvCode(capture: Record<string, unknown>): string {
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

  return [
    buildDefaultEnvCode(),
    `globalThis.location = {href: ${JSON.stringify(page.url ?? '')}};`,
    `globalThis.document = {cookie: ${JSON.stringify(cookies.map(cookie => `${String((cookie as Record<string, unknown>).name ?? '')}=${String((cookie as Record<string, unknown>).value ?? '')}`).join('; '))}, location: globalThis.location};`,
    toStorageShimCode('localStorage', localStorageValues),
    toStorageShimCode('sessionStorage', sessionStorageValues),
  ].join('\n\n');
}

/**
 * 生成入口脚本代码。
 *
 * 入口脚本导入 env.js、polyfills.js，注入捕获数据，并尝试执行目标函数。
 */
export function buildAutoEntryCode(
  targetScript: CodeFile | undefined,
  capture: Record<string, unknown>,
): string {
  return [
    'import "./env.js";',
    'import "./polyfills.js";',
    '',
    `const capture = ${JSON.stringify(capture, null, 2)};`,
    `capture.targetScript = ${JSON.stringify(targetScript ?? null, null, 2)};`,
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
 * 向 notes 列表追加目标上下文信息。
 */
export function appendTargetContextNotes(
  notes: string[],
  options: {
    targetKeywords: string[];
    targetUrlPatterns: string[];
    targetFunctionNames: string[];
    targetActionDescription: string;
  },
): string[] {
  return [
    ...notes,
    `targetKeywords: ${options.targetKeywords.length > 0 ? options.targetKeywords.join(', ') : '(none)'}`,
    `targetUrlPatterns: ${options.targetUrlPatterns.length > 0 ? options.targetUrlPatterns.join(', ') : '(none)'}`,
    `targetFunctionNames: ${options.targetFunctionNames.length > 0 ? options.targetFunctionNames.join(', ') : '(none)'}`,
    `targetActionDescription: ${options.targetActionDescription.length > 0 ? options.targetActionDescription : '(none)'}`,
  ];
}

/**
 * 检测值是否匹配目标文本。
 */
export function matchesTargetText(
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
    targetFunctionNames.some(fn => text.includes(fn.toLowerCase())) ||
    (targetActionDescription.length > 0 &&
      text.includes(targetActionDescription.toLowerCase()))
  );
}

/**
 * 按目标条件过滤运行时证据记录。
 */
export function filterRuntimeEvidence(
  records: Record<string, unknown>[],
  targetKeywords: string[],
  targetUrlPatterns: string[],
  targetFunctionNames: string[],
  targetActionDescription: string,
  maxEvidenceItems: number,
): Record<string, unknown>[] {
  const hasTargets =
    targetKeywords.length > 0 ||
    targetUrlPatterns.length > 0 ||
    targetFunctionNames.length > 0 ||
    targetActionDescription.length > 0;

  const filtered = hasTargets
    ? records.filter(record =>
        matchesTargetText(
          record,
          targetKeywords,
          targetUrlPatterns,
          targetFunctionNames,
          targetActionDescription,
        ),
      )
    : records;

  return filtered.slice(0, maxEvidenceItems);
}

/**
 * 从代码文件列表中选取目标脚本。
 *
 * 按目标条件匹配，无匹配则返回第一个文件。
 */
export function pickTargetScript(
  files: CodeFile[],
  targetKeywords: string[],
  targetUrlPatterns: string[],
  targetFunctionNames: string[],
  targetActionDescription: string,
): CodeFile | undefined {
  if (files.length === 0) return undefined;

  const hasTargets =
    targetKeywords.length > 0 ||
    targetUrlPatterns.length > 0 ||
    targetFunctionNames.length > 0 ||
    targetActionDescription.length > 0;

  if (!hasTargets) return files[0];

  return (
    files.find(file =>
      matchesTargetText(
        file,
        targetKeywords,
        targetUrlPatterns,
        targetFunctionNames,
        targetActionDescription,
      ),
    ) ?? files[0]
  );
}

/**
 * 从运行时错误推断缺失的浏览器能力。
 */
export function inferMissingCapabilities(
  runtimeError: string,
  observedCapabilities: string[],
): MissingCapability[] {
  const available = new Set(
    observedCapabilities.map(item => item.toLowerCase()),
  );
  const normalizedError = runtimeError.toLowerCase();

  const candidates: MissingCapability[] = [
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

/**
 * 将内容写入任务产物文件。
 *
 * 自动创建所需目录结构。
 */
export async function writeArtifactFile(
  taskDir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(taskDir, relativePath);
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, content, 'utf8');
}

/**
 * 自动构建 Bundle：从浏览器收集数据和运行时证据，生成完整重建包。
 */
export async function buildAutoBundle(
  taskId: string,
  options: AutoBundleOptions,
  runtime: Runtime,
): Promise<AutoBundleResult> {
  const topPriority = runtime.collector.getTopPriorityFiles(1);
  const targetScript = pickTargetScript(
    topPriority.files,
    options.targetKeywords,
    options.targetUrlPatterns,
    options.targetFunctionNames,
    options.targetActionDescription,
  );
  const page = await runtime.pageController.getPage();
  const [cookies, localStorage, sessionStorage, runtimeEvidence] =
    await Promise.all([
      runtime.pageController.getCookies(),
      runtime.pageController.getLocalStorage(),
      runtime.pageController.getSessionStorage(),
      runtime.reverseTaskStore.readLog('runtime-evidence', taskId),
    ]);
  const filteredRuntimeEvidence = filterRuntimeEvidence(
    runtimeEvidence,
    options.targetKeywords,
    options.targetUrlPatterns,
    options.targetFunctionNames,
    options.targetActionDescription,
    options.maxEvidenceItems,
  );

  const capture = {
    page: {
      url: page.url(),
      title: await page.title(),
    },
    cookies,
    localStorage,
    sessionStorage,
    runtimeEvidence: filteredRuntimeEvidence,
    targetScript: targetScript ?? null,
  };

  return {
    entryCode: buildAutoEntryCode(targetScript, capture),
    envCode: buildAutoEnvCode(capture),
    polyfillsCode: '',
    capture,
    notes: appendTargetContextNotes(
      [
        targetScript
          ? `auto-selected target script: ${targetScript.url}`
          : 'no target script selected from collector',
        filteredRuntimeEvidence.length > 0
          ? `filtered runtime evidence records: ${filteredRuntimeEvidence.length}`
          : 'no runtime evidence records found after target filtering',
      ],
      options,
    ),
  };
}
