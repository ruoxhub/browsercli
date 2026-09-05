/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 本地镜像 `src/tools/tools-meta.ts` + `src/tools/zod-introspect.ts` 的类型。
 *
 * 纯远程 CLI 通过 `GET /api/v1/tools` 获取 `ToolMeta[]`，其字段与 worker 侧
 * `ToolMeta` 完全一致。这里定义一个自包含的子集（不依赖任何 worker 模块），
 * 仅包含 CLI 渲染所需的字段，且保持字段名/形状一致以便直接反序列化。
 */

export type ToolArgType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'object';

export interface ToolArgSpec {
  type: ToolArgType;
  required: boolean;
  defaultValue?: unknown;
  enum?: string[];
  description: string;
}

export type ToolArgSpecMap = Record<string, ToolArgSpec>;

export interface ToolRuntimeRequirements {
  browser?: 'connected';
  page?: 'selected';
  frame?: 'selected';
  debugger?: 'available' | 'paused' | 'running';
  ai?: 'optional' | 'required';
  nativeTools?: string[];
  recovery?: boolean;
}

export interface ToolMeta {
  name: string;
  description: string;
  /** 简化类型映射 (key → 'string'|'number'|'boolean'|'string[]') */
  schema: Record<string, string>;
  /** 丰富的参数规格（含 required / enum / defaultValue / description） */
  argSpecs: ToolArgSpecMap;
  modulePath: string;
  handlerName: string;
  callMode: 'defineTool';
  domain: string;
  profile: string;
  dependencies?: string[];
  prerequisites?: unknown;
  toolDependencies?: unknown;
  sceneKeywords?: string[];
  workflowRule?: unknown;
  requirements?: ToolRuntimeRequirements;
}
