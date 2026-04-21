/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from '../../third_party/index.js';
import type {CodeFile} from '../../types/index.js';

// ─── 通用返回结构 ──────────────────────────────────────

/**
 * Rebuild 模块统一返回结构。
 *
 * 成功时 success=true，message 包含操作描述；
 * 失败时 success=false，message 包含错误描述。
 */
export interface RebuildResult {
  success: boolean;
  message: string;
  /** 工具类型标识 */
  tooltype: string;
  /** 使用的日志格式 */
  logFormat?: string;
}

// ─── buildDefaultEnvCode ───────────────────────────────

/** buildDefaultEnvCode 结果 */
export interface BuildDefaultEnvCodeResult extends RebuildResult {
  tooltype: 'build_default_env';
  data: {
    code: string;
  };
}

// ─── toStorageShimCode ─────────────────────────────────

/** toStorageShimCode 参数 */
export interface ToStorageShimCodeParams {
  /** 存储类型 */
  name: 'localStorage' | 'sessionStorage';
  /** 初始值 */
  values: Record<string, unknown>;
}

/** toStorageShimCode 结果 */
export interface ToStorageShimCodeResult extends RebuildResult {
  tooltype: 'to_storage_shim';
  data: {
    code: string;
    name: 'localStorage' | 'sessionStorage';
  };
}

// ─── buildAutoEnvCode ──────────────────────────────────

/** buildAutoEnvCode 参数 */
export interface BuildAutoEnvCodeParams {
  /** 浏览器捕获数据 */
  capture: Record<string, unknown>;
}

/** buildAutoEnvCode 结果 */
export interface BuildAutoEnvCodeResult extends RebuildResult {
  tooltype: 'build_auto_env';
  data: {
    code: string;
  };
}

// ─── buildAutoEntryCode ────────────────────────────────

/** buildAutoEntryCode 参数 */
export interface BuildAutoEntryCodeParams {
  /** 目标脚本 */
  targetScript?: CodeFile;
  /** 浏览器捕获数据 */
  capture: Record<string, unknown>;
}

/** buildAutoEntryCode 结果 */
export interface BuildAutoEntryCodeResult extends RebuildResult {
  tooltype: 'build_auto_entry';
  data: {
    code: string;
  };
}

// ─── appendTargetContextNotes ───────────────────────────

/** appendTargetContextNotes 参数 */
export interface AppendTargetContextNotesParams {
  /** 原始 notes */
  notes: string[];
  /** 目标关键词 */
  targetKeywords: string[];
  /** 目标 URL 模式 */
  targetUrlPatterns: string[];
  /** 目标函数名 */
  targetFunctionNames: string[];
  /** 目标操作描述 */
  targetActionDescription: string;
}

/** appendTargetContextNotes 结果 */
export interface AppendTargetContextNotesResult extends RebuildResult {
  tooltype: 'append_target_context_notes';
  data: {
    notes: string[];
  };
}

// ─── matchesTargetText ─────────────────────────────────

/** matchesTargetText 参数 */
export interface MatchesTargetTextParams {
  /** 待检测值 */
  value: unknown;
  /** 目标关键词 */
  targetKeywords: string[];
  /** 目标 URL 模式 */
  targetUrlPatterns: string[];
  /** 目标函数名 */
  targetFunctionNames: string[];
  /** 目标操作描述 */
  targetActionDescription: string;
}

/** matchesTargetText 结果 */
export interface MatchesTargetTextResult extends RebuildResult {
  tooltype: 'matches_target_text';
  data: {
    matched: boolean;
  };
}

// ─── filterRuntimeEvidence ─────────────────────────────

/** filterRuntimeEvidence 参数 */
export interface FilterRuntimeEvidenceParams {
  /** 运行时证据记录 */
  records: Array<Record<string, unknown>>;
  /** 目标关键词 */
  targetKeywords: string[];
  /** 目标 URL 模式 */
  targetUrlPatterns: string[];
  /** 目标函数名 */
  targetFunctionNames: string[];
  /** 目标操作描述 */
  targetActionDescription: string;
  /** 最大返回条数 */
  maxEvidenceItems: number;
}

/** filterRuntimeEvidence 结果 */
export interface FilterRuntimeEvidenceResult extends RebuildResult {
  tooltype: 'filter_runtime_evidence';
  data: {
    filtered: Array<Record<string, unknown>>;
    totalBefore: number;
    totalAfter: number;
  };
}

// ─── pickTargetScript ──────────────────────────────────

/** pickTargetScript 参数 */
export interface PickTargetScriptParams {
  /** 代码文件列表 */
  files: CodeFile[];
  /** 目标关键词 */
  targetKeywords: string[];
  /** 目标 URL 模式 */
  targetUrlPatterns: string[];
  /** 目标函数名 */
  targetFunctionNames: string[];
  /** 目标操作描述 */
  targetActionDescription: string;
}

/** pickTargetScript 结果 */
export interface PickTargetScriptResult extends RebuildResult {
  tooltype: 'pick_target_script';
  data: {
    script: CodeFile | null;
    index: number;
  };
}

// ─── inferMissingCapabilities ──────────────────────────

/** inferMissingCapabilities 参数 */
export interface InferMissingCapabilitiesParams {
  /** 运行时错误信息 */
  runtimeError: string;
  /** 已观测到的浏览器能力 */
  observedCapabilities: string[];
}

/** 单个缺失能力 */
export interface MissingCapability {
  capability: string;
  /** 匹配运行时错误的模式列表 */
  patterns: string[];
  reason: string;
  priority: number;
}

/** inferMissingCapabilities 结果 */
export interface InferMissingCapabilitiesResult extends RebuildResult {
  tooltype: 'infer_missing_capabilities';
  data: {
    missing: MissingCapability[];
  };
}

// ─── buildAutoBundle (Frame-dependent) ─────────────────

/** buildAutoBundle 参数 */
export interface BuildAutoBundleParams {
  /** Puppeteer Frame 对象 */
  frame: Frame;
  /** 任务 ID */
  taskId: string;
  /** 目标关键词 */
  targetKeywords: string[];
  /** 目标 URL 模式 */
  targetUrlPatterns: string[];
  /** 目标函数名 */
  targetFunctionNames: string[];
  /** 目标操作描述 */
  targetActionDescription: string;
  /** 最大证据条数 */
  maxEvidenceItems: number;
}

/** buildAutoBundle 结果数据 */
export interface BuildAutoBundleData {
  entryCode: string;
  envCode: string;
  polyfillsCode: string;
  capture: Record<string, unknown>;
  notes: string[];
}

/** buildAutoBundle 结果 */
export interface BuildAutoBundleResult extends RebuildResult {
  tooltype: 'build_auto_bundle';
  data: BuildAutoBundleData;
}

// ─── writeArtifactFile ─────────────────────────────────

/** writeArtifactFile 参数 */
export interface WriteArtifactFileParams {
  /** 任务目录 */
  taskDir: string;
  /** 相对路径 */
  relativePath: string;
  /** 文件内容 */
  content: string;
}

/** writeArtifactFile 结果 */
export interface WriteArtifactFileResult extends RebuildResult {
  tooltype: 'write_artifact_file';
  data?: {
    filePath: string;
  };
}

/** 重新导出 Frame 类型 */
export type {Frame};
