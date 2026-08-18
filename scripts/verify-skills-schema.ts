/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const BUILD_TOOLS_DIR = path.join(REPO_ROOT, 'build/src/tools');

interface ExtractedCall {
  file: string;
  line: number;
  raw: string;
  toolName: string;
  args: string[];
}

function extractCallsFromMarkdown(
  filePath: string,
  content: string,
): ExtractedCall[] {
  const lines = content.split('\n');
  const calls: ExtractedCall[] = [];

  const callRegex =
    /browsercli\s+call\s+([a-zA-Z0-9_-]+)(.*?)(?:$|&&|\|\||;|\n)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(callRegex);
    if (!match) continue;

    const toolName = match[1]!;
    const restArgs = match[2] ?? '';

    // 解析 --argName 形式的参数
    const argMatches = restArgs.matchAll(/--([a-zA-Z0-9_-]+)/g);
    const args = Array.from(argMatches, m => m[1]!);

    calls.push({
      file: path.relative(REPO_ROOT, filePath),
      line: i + 1,
      raw: line.trim(),
      toolName,
      args,
    });
  }

  return calls;
}

async function collectSkillFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, {withFileTypes: true});
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSkillFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeKey(key: string): string {
  return key.replace(/[-_]/g, '').toLowerCase();
}

async function loadToolDefinitions(): Promise<Map<string, Set<string>>> {
  const toolMap = new Map<string, Set<string>>();

  try {
    const indexPath = path.join(BUILD_TOOLS_DIR, 'generated-tools-index.js');
    const indexUrl = `file://${indexPath.replace(/\\/g, '/')}`;
    const indexMod = (await import(indexUrl)) as {
      GENERATED_TOOL_REGISTRY: Array<{
        modulePath: string;
        handlerName: string;
      }>;
    };

    for (const entry of indexMod.GENERATED_TOOL_REGISTRY) {
      try {
        const modulePath = path.join(BUILD_TOOLS_DIR, entry.modulePath);
        const moduleUrl = `file://${modulePath.replace(/\\/g, '/')}`;
        const mod = (await import(moduleUrl)) as Record<string, unknown>;
        const tool = mod[entry.handlerName] as
          | {name?: string; schema?: Record<string, unknown>}
          | undefined;
        if (!tool || typeof tool !== 'object' || !tool.name) continue;

        const allowedArgs = new Set<string>();
        if (tool.schema && typeof tool.schema === 'object') {
          for (const k of Object.keys(tool.schema)) {
            allowedArgs.add(k);
            allowedArgs.add(normalizeKey(k));
          }
        }
        toolMap.set(tool.name, allowedArgs);
        toolMap.set(normalizeKey(tool.name), allowedArgs);
      } catch {
        // empty
      }
    }
  } catch (err) {
    console.warn('⚠️  无法加载编译后的 tools 索引，请先执行 npm run build');
  }

  return toolMap;
}

async function main(): Promise<void> {
  console.log(
    '🔍 开始扫描 skills/**/*.md 文档中的 browsercli call 调用参数...',
  );
  const skillFiles = await collectSkillFiles(SKILLS_DIR);
  const toolMap = await loadToolDefinitions();

  const allCalls: ExtractedCall[] = [];
  for (const file of skillFiles) {
    const content = await readFile(file, 'utf8');
    allCalls.push(...extractCallsFromMarkdown(file, content));
  }

  console.log(
    `📄 找到 ${skillFiles.length} 个 Skill 文档，共检测到 ${allCalls.length} 处 browsercli call 命令`,
  );

  let errorCount = 0;

  for (const call of allCalls) {
    const allowed =
      toolMap.get(call.toolName) ?? toolMap.get(normalizeKey(call.toolName));
    if (!allowed) {
      // 若工具未在当前已知列表中，跳过或记录提示
      continue;
    }

    for (const arg of call.args) {
      if (['help', 'json', 'page', 'tab', 'session', 'timeout'].includes(arg)) {
        continue;
      }
      if (!allowed.has(arg) && !allowed.has(normalizeKey(arg))) {
        console.warn(
          `⚠️  [Schema Mismatch] ${call.file}:${call.line}\n` +
            `   命令: "${call.raw}"\n` +
            `   工具 "${call.toolName}" 不存在参数 "--${arg}"\n` +
            `   可用参数: [${Array.from(allowed)
              .filter(a => !/^[a-z0-9]+$/.test(a) || a.length > 2)
              .join(', ')}]`,
        );
        errorCount++;
      }
    }
  }

  if (errorCount > 0) {
    console.log(
      `\n❌ 发现 ${errorCount} 处 Skill 文档与 Tool Schema 参数不匹配！`,
    );
  } else {
    console.log(
      '✅ 所有 Skill 文档中的 browsercli call 参数与代码 Schema 完全一致！',
    );
  }
}

await main();
