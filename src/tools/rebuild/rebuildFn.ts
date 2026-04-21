/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BuildDefaultEnvCodeResult,
  ToStorageShimCodeParams,
  ToStorageShimCodeResult,
  BuildAutoEnvCodeParams,
  BuildAutoEnvCodeResult,
  BuildAutoEntryCodeParams,
  BuildAutoEntryCodeResult,
  AppendTargetContextNotesParams,
  AppendTargetContextNotesResult,
  MatchesTargetTextParams,
  MatchesTargetTextResult,
  FilterRuntimeEvidenceParams,
  FilterRuntimeEvidenceResult,
  PickTargetScriptParams,
  PickTargetScriptResult,
  InferMissingCapabilitiesParams,
  InferMissingCapabilitiesResult,
  MissingCapability,
  WriteArtifactFileParams,
  WriteArtifactFileResult,
} from './types.js';

import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {CodeFile} from '../../types/index.js';

// ─── 纯函数（无 Puppeteer 依赖） ────────────────────────

/**
 * 生成默认浏览器环境补丁代码。
 *
 * 包含 window/self/global/document/navigator/location/atob/btoa/crypto 等基础 shim。
 *
 * @returns 结构化结果对象，data.code 为生成的代码字符串
 */
export function buildDefaultEnvCode(): BuildDefaultEnvCodeResult {
  const code = [
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

  return {
    success: true,
    message: '默认环境代码生成成功',
    tooltype: 'build_default_env',
    logFormat: 'simple',
    data: {code},
  };
}

/**
 * 生成 localStorage/sessionStorage 的 shim 代码。
 *
 * @param params - 包含 name（存储类型）和 values（初始值）
 * @returns 结构化结果对象，data.code 为生成的代码字符串
 */
export function toStorageShimCode(
  params: ToStorageShimCodeParams,
): ToStorageShimCodeResult {
  const {name, values} = params;
  const entries = Object.entries(values);
  const code = [
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

  return {
    success: true,
    message: `${name} shim 代码生成成功`,
    tooltype: 'to_storage_shim',
    logFormat: 'simple',
    data: {code, name},
  };
}

/**
 * 从浏览器捕获数据生成完整环境代码。
 *
 * 整合默认环境、Cookie、localStorage、sessionStorage 等。
 *
 * @param params - 包含 capture（浏览器捕获数据）
 * @returns 结构化结果对象，data.code 为生成的代码字符串
 */
export function buildAutoEnvCode(
  params: BuildAutoEnvCodeParams,
): BuildAutoEnvCodeResult {
  const {capture} = params;
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

  const defaultEnv = buildDefaultEnvCode();
  const localShim = toStorageShimCode({
    name: 'localStorage',
    values: localStorageValues,
  });
  const sessionShim = toStorageShimCode({
    name: 'sessionStorage',
    values: sessionStorageValues,
  });

  const code = [
    defaultEnv.data.code,
    `globalThis.location = {href: ${JSON.stringify(page.url ?? '')}};`,
    `globalThis.document = {cookie: ${JSON.stringify(cookies.map(cookie => `${String((cookie as Record<string, unknown>).name ?? '')}=${String((cookie as Record<string, unknown>).value ?? '')}`).join('; '))}, location: globalThis.location};`,
    localShim.data.code,
    sessionShim.data.code,
  ].join('\n\n');

  return {
    success: true,
    message: '自动环境代码生成成功',
    tooltype: 'build_auto_env',
    logFormat: 'simple',
    data: {code},
  };
}

/**
 * 生成入口脚本代码。
 *
 * 入口脚本导入 env.js、polyfills.js，注入捕获数据，并尝试执行目标函数。
 *
 * @param params - 包含 targetScript 和 capture
 * @returns 结构化结果对象，data.code 为生成的代码字符串
 */
export function buildAutoEntryCode(
  params: BuildAutoEntryCodeParams,
): BuildAutoEntryCodeResult {
  const {targetScript, capture} = params;
  const code = [
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

  return {
    success: true,
    message: targetScript
      ? `入口代码生成成功，目标脚本: ${targetScript.url}`
      : '入口代码生成成功，无目标脚本',
    tooltype: 'build_auto_entry',
    logFormat: 'simple',
    data: {code},
  };
}

/**
 * 向 notes 列表追加目标上下文信息。
 *
 * @param params - 包含 notes 和各项目标上下文参数
 * @returns 结构化结果对象，data.notes 为追加后的列表
 */
export function appendTargetContextNotes(
  params: AppendTargetContextNotesParams,
): AppendTargetContextNotesResult {
  const {
    notes,
    targetKeywords,
    targetUrlPatterns,
    targetFunctionNames,
    targetActionDescription,
  } = params;
  const result = [
    ...notes,
    `targetKeywords: ${targetKeywords.length > 0 ? targetKeywords.join(', ') : '(none)'}`,
    `targetUrlPatterns: ${targetUrlPatterns.length > 0 ? targetUrlPatterns.join(', ') : '(none)'}`,
    `targetFunctionNames: ${targetFunctionNames.length > 0 ? targetFunctionNames.join(', ') : '(none)'}`,
    `targetActionDescription: ${targetActionDescription.length > 0 ? targetActionDescription : '(none)'}`,
  ];

  return {
    success: true,
    message: '目标上下文 notes 追加成功',
    tooltype: 'append_target_context_notes',
    logFormat: 'simple',
    data: {notes: result},
  };
}

/**
 * 检测值是否匹配目标文本。
 *
 * 将值转为小写文本后，与关键词/URL模式/函数名/操作描述进行匹配。
 *
 * @param params - 包含 value 和各项目标匹配参数
 * @returns 结构化结果对象，data.matched 为是否匹配
 */
export function matchesTargetText(
  params: MatchesTargetTextParams,
): MatchesTargetTextResult {
  const {
    value,
    targetKeywords,
    targetUrlPatterns,
    targetFunctionNames,
    targetActionDescription,
  } = params;
  const text =
    typeof value === 'string'
      ? value.toLowerCase()
      : JSON.stringify(value ?? '').toLowerCase();
  const matched =
    targetKeywords.some(keyword => text.includes(keyword.toLowerCase())) ||
    targetUrlPatterns.some(pattern => text.includes(pattern.toLowerCase())) ||
    targetFunctionNames.some(fn => text.includes(fn.toLowerCase())) ||
    (targetActionDescription.length > 0 &&
      text.includes(targetActionDescription.toLowerCase()));

  return {
    success: true,
    message: matched ? '匹配到目标文本' : '未匹配到目标文本',
    tooltype: 'matches_target_text',
    logFormat: 'simple',
    data: {matched},
  };
}

/**
 * 按目标条件过滤运行时证据记录。
 *
 * @param params - 包含 records 和各项过滤条件
 * @returns 结构化结果对象，data.filtered 为过滤后的记录
 */
export function filterRuntimeEvidence(
  params: FilterRuntimeEvidenceParams,
): FilterRuntimeEvidenceResult {
  const {
    records,
    targetKeywords,
    targetUrlPatterns,
    targetFunctionNames,
    targetActionDescription,
    maxEvidenceItems,
  } = params;

  const hasTargets =
    targetKeywords.length > 0 ||
    targetUrlPatterns.length > 0 ||
    targetFunctionNames.length > 0 ||
    targetActionDescription.length > 0;

  const filtered = hasTargets
    ? records.filter(record => {
        const text = JSON.stringify(record).toLowerCase();
        return (
          targetKeywords.some(keyword =>
            text.includes(keyword.toLowerCase()),
          ) ||
          targetUrlPatterns.some(pattern =>
            text.includes(pattern.toLowerCase()),
          ) ||
          targetFunctionNames.some(fn =>
            text.includes(fn.toLowerCase()),
          ) ||
          (targetActionDescription.length > 0 &&
            text.includes(targetActionDescription.toLowerCase()))
        );
      })
    : records;

  const sliced = filtered.slice(0, maxEvidenceItems);

  return {
    success: true,
    message: `证据过滤完成，${records.length} → ${sliced.length} 条`,
    tooltype: 'filter_runtime_evidence',
    logFormat: 'simple',
    data: {
      filtered: sliced,
      totalBefore: records.length,
      totalAfter: sliced.length,
    },
  };
}

/**
 * 从代码文件列表中选取目标脚本。
 *
 * 按目标条件匹配，无匹配则返回第一个文件。
 *
 * @param params - 包含 files 和各项目标匹配参数
 * @returns 结构化结果对象，data.script 为选中的脚本（可能为 null）
 */
export function pickTargetScript(
  params: PickTargetScriptParams,
): PickTargetScriptResult {
  const {
    files,
    targetKeywords,
    targetUrlPatterns,
    targetFunctionNames,
    targetActionDescription,
  } = params;

  if (files.length === 0) {
    return {
      success: true,
      message: '无代码文件可选',
      tooltype: 'pick_target_script',
      logFormat: 'simple',
      data: {script: null, index: -1},
    };
  }

  const hasTargets =
    targetKeywords.length > 0 ||
    targetUrlPatterns.length > 0 ||
    targetFunctionNames.length > 0 ||
    targetActionDescription.length > 0;

  if (!hasTargets) {
    return {
      success: true,
      message: `默认选择第一个脚本: ${files[0].url}`,
      tooltype: 'pick_target_script',
      logFormat: 'simple',
      data: {script: files[0], index: 0},
    };
  }

  const matchIndex = files.findIndex(file => {
    const text = JSON.stringify(file).toLowerCase();
    return (
      targetKeywords.some(keyword => text.includes(keyword.toLowerCase())) ||
      targetUrlPatterns.some(pattern => text.includes(pattern.toLowerCase())) ||
      targetFunctionNames.some(fn => text.includes(fn.toLowerCase())) ||
      (targetActionDescription.length > 0 &&
        text.includes(targetActionDescription.toLowerCase()))
    );
  });

  const resolvedIndex = matchIndex >= 0 ? matchIndex : 0;
  const script = files[resolvedIndex];

  return {
    success: true,
    message:
      matchIndex >= 0
        ? `匹配到目标脚本: ${script.url}`
        : `未匹配到目标脚本，回退到第一个: ${script.url}`,
    tooltype: 'pick_target_script',
    logFormat: 'simple',
    data: {script, index: resolvedIndex},
  };
}

/**
 * 从运行时错误推断缺失的浏览器能力。
 *
 * @param params - 包含 runtimeError 和 observedCapabilities
 * @returns 结构化结果对象，data.missing 为缺失能力列表（按优先级排序）
 */
export function inferMissingCapabilities(
  params: InferMissingCapabilitiesParams,
): InferMissingCapabilitiesResult {
  const {runtimeError, observedCapabilities} = params;
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

  const missing = candidates
    .filter(
      candidate =>
        available.has(candidate.capability.toLowerCase()) &&
        candidate.patterns.some(pattern => normalizedError.includes(pattern)),
    )
    .sort((a, b) => b.priority - a.priority);

  return {
    success: true,
    message: `推断完成，发现 ${missing.length} 个缺失能力`,
    tooltype: 'infer_missing_capabilities',
    logFormat: 'simple',
    data: {missing},
  };
}

/**
 * 将内容写入任务产物文件。
 *
 * 自动创建所需目录结构。
 *
 * @param params - 包含 taskDir、relativePath 和 content
 * @returns 结构化结果对象，data.filePath 为写入的绝对路径
 */
export async function writeArtifactFile(
  params: WriteArtifactFileParams,
): Promise<WriteArtifactFileResult> {
  const {taskDir, relativePath, content} = params;
  const filePath = path.join(taskDir, relativePath);

  try {
    await mkdir(path.dirname(filePath), {recursive: true});
    await writeFile(filePath, content, 'utf8');
    return {
      success: true,
      message: `文件写入成功: ${relativePath}`,
      tooltype: 'write_artifact_file',
      logFormat: 'simple',
      data: {filePath},
    };
  } catch (error) {
    return {
      success: false,
      message: `文件写入失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'write_artifact_file',
    };
  }
}
