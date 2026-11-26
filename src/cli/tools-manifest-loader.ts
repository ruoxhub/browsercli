/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI 侧零依赖工具清单读取器（ADR-0009）：
 * 直接读取构建期生成的纯 JSON `tools-manifest.json`，不触发任何浏览器/逆向运行时导入。
 */

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import type {ToolMeta} from './tool-meta-types.js';

export interface StaticToolsManifestFile {
  version: number;
  generatedAt: string;
  count: number;
  tools: ToolMeta[];
}

let cachedManifest: StaticToolsManifestFile | null | undefined;

export function getToolsManifestPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, '../tools/tools-manifest.json');
}

export function loadStaticToolsManifest(): StaticToolsManifestFile | null {
  if (cachedManifest !== undefined) {
    return cachedManifest;
  }
  const manifestPath = getToolsManifestPath();
  if (!existsSync(manifestPath)) {
    cachedManifest = null;
    return null;
  }
  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as StaticToolsManifestFile;
    if (Array.isArray(parsed?.tools)) {
      cachedManifest = parsed;
      return parsed;
    }
  } catch {
    // 损坏时静默回退到 daemon RPC
  }
  cachedManifest = null;
  return null;
}

export function resetStaticToolsManifestCache(): void {
  cachedManifest = undefined;
}
