/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolMeta 注册表 — 从 defineTool 定义动态加载 name / description / schema
 *
 * 不再手动维护 TOOLS_META 数组。每个工具只需在此声明 modulePath + handlerName，
 * name / description / schema 从对应 defineTool 的导出自动提取。
 */

import {GENERATED_DOMAIN_MANIFESTS} from '../tools/generated-tools-index.js';
import type {ToolProfile} from '../tools/manifest.js';
import {
  ToolRegistry,
  type RegisteredToolEntry,
} from '../tools/registry/ToolRegistry.js';
import type {ToolDefinition} from '../tools/ToolDefinition.js';

import {ToolSearchEngine} from './tool-search-engine.js';
import {
  extractArgSpecsFromSchema,
  extractSchemaTypeMap,
  type ToolArgSpecMap,
} from './zod-introspect.js';

export type ToolCallMode = 'defineTool';

/**
 * 工具注册条目 — 仅声明模块路径与导出名，其余从 defineTool 自动提取
 */
export interface ToolRegistryEntry {
  modulePath: string;
  handlerName: string;
  domain: string;
  profile: ToolProfile;
  dependencies?: string[];
  prerequisites?: RegisteredToolEntry['prerequisites'];
  toolDependencies?: RegisteredToolEntry['toolDependencies'];
  sceneKeywords?: string[];
  workflowRule?: RegisteredToolEntry['workflowRule'];
}

/**
 * 完整工具元信息 — CLI 使用
 */
export interface ToolMeta {
  name: string;
  description: string;
  /** 简化类型映射 (key → 'string'|'number'|'boolean'|'string[]') */
  schema: Record<string, string>;
  /** 丰富的参数规格（含 required / enum / defaultValue / description） */
  argSpecs: ToolArgSpecMap;
  modulePath: string;
  handlerName: string;
  callMode: ToolCallMode;
  domain: string;
  profile: ToolProfile;
  dependencies?: string[];
  prerequisites?: ToolRegistryEntry['prerequisites'];
  toolDependencies?: ToolRegistryEntry['toolDependencies'];
  sceneKeywords?: string[];
  workflowRule?: ToolRegistryEntry['workflowRule'];
}

/**
 * 工具注册表 — name / description / schema 从 defineTool 自动提取
 *
 * Resolve the active tool profile from environment.
 *
 * | Profile     | Token cost (approx) | Purpose                                |
 * |-------------|---------------------|----------------------------------------|
 * | `search`    | ~500 tokens         | Only `search_tools`; LLM discovers     |
 * |             |                     | concrete tools on demand.              |
 * | `workflow`  | ~15K tokens         | Browser + reverse-engineering daily.   |
 * | `full`      | ~40K+ tokens        | Adds debugger, wasm, anti-debug, etc.  |
 *
 * Default: `full` to preserve current behaviour. Set
 * `JS_REVERSE_TOOL_PROFILE=workflow` (or `search`) to scope down.
 */
function getConfiguredToolProfile(): ToolProfile {
  const value = process.env.JS_REVERSE_TOOL_PROFILE;
  if (value === 'search' || value === 'workflow' || value === 'full') {
    return value;
  }
  return 'full';
}

const TOOL_REGISTRY: ToolRegistryEntry[] = new ToolRegistry(
  GENERATED_DOMAIN_MANIFESTS,
).listTools(getConfiguredToolProfile());

// ─── 动态加载缓存 ──────────────────────────────────────

let toolsMetaCache: ToolMeta[] | null = null;
let toolsByNameCache: Map<string, ToolMeta> | null = null;
let registryByHandlerNameCache: Map<string, ToolRegistryEntry> | null = null;

/**
 * 从 defineTool 模块中提取 ToolMeta
 */
async function loadToolMeta(
  entry: ToolRegistryEntry,
): Promise<ToolMeta | null> {
  try {
    const modulePath = `../tools${entry.modulePath.replace(/^\./, '')}`;
    const module = await import(modulePath);
    const handler = module[entry.handlerName];

    if (!handler) {
      console.warn(
        `[tools-meta] ${entry.modulePath} 中未找到导出 ${entry.handlerName}`,
      );
      return null;
    }

    // defineTool 返回 ToolDefinition 对象
    if (
      typeof handler === 'object' &&
      handler !== null &&
      typeof handler.handler === 'function'
    ) {
      const def = handler as ToolDefinition;
      const argSpecs = extractArgSpecsFromSchema(def.schema);
      const schemaTypeMap = extractSchemaTypeMap(def.schema);

      return {
        name: def.name,
        description: def.description,
        schema: schemaTypeMap,
        argSpecs,
        modulePath: entry.modulePath,
        handlerName: entry.handlerName,
        callMode: 'defineTool',
        domain: entry.domain,
        profile: entry.profile,
        dependencies: entry.dependencies,
        prerequisites: entry.prerequisites,
        toolDependencies: entry.toolDependencies,
        sceneKeywords: entry.sceneKeywords,
        workflowRule: entry.workflowRule,
      };
    }

    console.warn(
      `[tools-meta] ${entry.modulePath}:${entry.handlerName} 不是 defineTool 定义`,
    );
    return null;
  } catch (err) {
    console.warn(
      `[tools-meta] 加载 ${entry.modulePath}:${entry.handlerName} 失败: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

/**
 * 初始化/获取 ToolMeta 列表（懒加载 + 缓存）
 */
async function getToolsMeta(): Promise<ToolMeta[]> {
  if (toolsMetaCache) return toolsMetaCache;

  const results = await Promise.all(TOOL_REGISTRY.map(loadToolMeta));
  toolsMetaCache = results.filter((m): m is ToolMeta => m !== null);

  toolsByNameCache = new Map(toolsMetaCache.map(t => [t.name, t]));

  return toolsMetaCache;
}

/**
 * 同步获取已缓存的 ToolMeta 列表（未初始化时返回空数组）
 */
function getCachedToolsMeta(): ToolMeta[] {
  return toolsMetaCache ?? [];
}

/**
 * 同步获取已缓存的 ToolMeta name → meta 映射
 */
function getCachedToolsByName(): Map<string, ToolMeta> {
  return toolsByNameCache ?? new Map();
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function buildMinimalMeta(name: string, entry: ToolRegistryEntry): ToolMeta {
  return {
    name,
    description: '',
    schema: {},
    argSpecs: {},
    modulePath: entry.modulePath,
    handlerName: entry.handlerName,
    callMode: 'defineTool',
    domain: entry.domain,
    profile: entry.profile,
    dependencies: entry.dependencies,
    prerequisites: entry.prerequisites,
    toolDependencies: entry.toolDependencies,
    sceneKeywords: entry.sceneKeywords,
    workflowRule: entry.workflowRule,
  };
}

// ─── 公共 API ────────────────────────────────────────────

/**
 * 获取工具的完整元信息（异步，从 defineTool 提取）
 */
export async function getToolMetaAsync(
  name: string,
): Promise<ToolMeta | undefined> {
  const meta = await getToolsMeta();
  return meta.find(t => t.name === name);
}

/**
 * 获取工具的完整元信息（同步，依赖已初始化的缓存）
 *
 * 如果缓存未初始化，回退到从 TOOL_REGISTRY 中查找条目并
 * 返回仅包含 modulePath/handlerName 的最小 meta。
 * 在 CLI 调用场景中，通常先调用 ensureToolsMeta() 初始化缓存。
 */
export function getToolMeta(name: string): ToolMeta | undefined {
  const cached = getCachedToolsByName().get(name);
  if (cached) return cached;

  if (!registryByHandlerNameCache) {
    registryByHandlerNameCache = new Map(
      TOOL_REGISTRY.map(entry => [toSnakeCase(entry.handlerName), entry]),
    );
  }

  const entry = registryByHandlerNameCache.get(name);
  if (!entry) return undefined;

  return buildMinimalMeta(name, entry);
}

/**
 * 确保工具元信息已从 defineTool 加载（应在使用 getToolMeta 前调用）
 */
export async function ensureToolsMeta(): Promise<void> {
  await getToolsMeta();
}

/**
 * 获取所有工具名称
 */
export function getAllToolNames(): string[] {
  const cached = getCachedToolsMeta();
  if (cached.length > 0) {
    return cached.map(t => t.name);
  }
  // 回退：从注册表推导名称（需要 name，但还没加载）
  // 此处返回空数组，应先调用 ensureToolsMeta()
  return [];
}

/**
 * 搜索工具
 */
export async function searchTools(query: string): Promise<ToolMeta[]> {
  const meta = await getToolsMeta();
  return new ToolSearchEngine(meta).search(query);
}

/**
 * 获取所有已加载的 ToolMeta（同步，需先调用 ensureToolsMeta）
 */
export function getAllToolsMeta(): ToolMeta[] {
  return getCachedToolsMeta();
}
