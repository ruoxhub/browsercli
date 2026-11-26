/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 构建期生成纯静态 JSON 工具清单（ADR-0009）：
 * 供 CLI 在不加载 Patchright / Babel / Wabt 等重运行时的前提下完成命令发现与参数解析。
 */

import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const BUILD_TOOLS_DIR = path.join(process.cwd(), 'build', 'src', 'tools');
const MANIFEST_OUTPUT = path.join(BUILD_TOOLS_DIR, 'tools-manifest.json');

export async function generateToolsManifestJson(): Promise<number> {
  const toolsMetaUrl = pathToFileURL(
    path.join(BUILD_TOOLS_DIR, 'tools-meta.js'),
  ).href;
  const toolsMetaMod = (await import(toolsMetaUrl)) as {
    ensureToolsMeta: () => Promise<void>;
    getAllToolsMeta: () => unknown[];
  };

  await toolsMetaMod.ensureToolsMeta();
  const tools = toolsMetaMod.getAllToolsMeta();
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: tools.length,
    tools,
  };

  await writeFile(MANIFEST_OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return tools.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const count = await generateToolsManifestJson();
  console.log(`Generated build/src/tools/tools-manifest.json (${count} tools)`);
}
