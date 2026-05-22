/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';

import {cliOptions} from '../build/src/cli.js';
import * as analyzerTools from '../build/src/tools/analyzer/index.js';
import * as antiDebugTools from '../build/src/tools/anti-debug/antiAntiDebug.js';
import * as bypassDebuggerTools from '../build/src/tools/anti-debug/bypassDebugger.js';
import {ToolCategory, labels} from '../build/src/tools/categories.js';
import * as codeTemplateTools from '../build/src/tools/code-templates/index.js';
import * as collectorTools from '../build/src/tools/collector/index.js';
import * as consoleTools from '../build/src/tools/console/index.js';
import * as hookCryptoJS from '../build/src/tools/crypto/hookCryptoJS.js';
import * as hookJSEncrypt from '../build/src/tools/crypto/hookJSEncrypt.js';
import * as hookSMCrypto from '../build/src/tools/crypto/hookSMCrypto.js';
import * as debuggerTools from '../build/src/tools/debugger/index.js';
import * as dialogTools from '../build/src/tools/dialog/index.js';
import * as domTools from '../build/src/tools/dom/index.js';
import * as emulationTools from '../build/src/tools/emulation/index.js';
import * as extensionsTools from '../build/src/tools/extensions/index.js';
import * as framesTools from '../build/src/tools/frames/index.js';
import * as hookAntiAntiHook from '../build/src/tools/hook/antiAntiHook.js';
import * as hookConsoleLog from '../build/src/tools/hook/ConsoleLog.js';
import * as hookConsoleProtect from '../build/src/tools/hook/ConsoleProtect.js';
import * as hookConsoleTable from '../build/src/tools/hook/ConsoleTable.js';
import * as hookCookie from '../build/src/tools/hook/Cookie.js';
import * as hookDateNow from '../build/src/tools/hook/DateNow.js';
import * as hookFetch from '../build/src/tools/hook/Fetch.js';
import * as hookFixedWindowSize from '../build/src/tools/hook/fixedWindowSize.js';
import * as hookHistory from '../build/src/tools/hook/History.js';
import * as hookTools from '../build/src/tools/hook/index.js';
import * as hookJsonParse from '../build/src/tools/hook/JsonParse.js';
import * as hookJsonStringify from '../build/src/tools/hook/JsonStringify.js';
import * as hookLocalStorage from '../build/src/tools/hook/LocalStorage.js';
import * as hookLocationHref from '../build/src/tools/hook/LocationHref.js';
import * as hookPerformanceNow from '../build/src/tools/hook/PerformanceNow.js';
import * as hookPromise from '../build/src/tools/hook/Promise.js';
import * as hookRandom from '../build/src/tools/hook/Random.js';
import * as hookSessionStorage from '../build/src/tools/hook/SessionStorage.js';
import * as hookWebSocket from '../build/src/tools/hook/WebSocket.js';
import * as hookXhrOpen from '../build/src/tools/hook/XhrOpen.js';
import * as hookXhrSetRequestHeader from '../build/src/tools/hook/XhrSetRequestHeader.js';
import * as inputTools from '../build/src/tools/input/index.js';
import * as navigationTools from '../build/src/tools/navigation/index.js';
import * as networkTools from '../build/src/tools/network/index.js';
import * as pageTools from '../build/src/tools/page/index.js';
import * as performanceTools from '../build/src/tools/performance/index.js';
import * as pipelineTools from '../build/src/tools/pipeline/index.js';
import * as rebuildTools from '../build/src/tools/rebuild/index.js';
import * as screenshotTools from '../build/src/tools/screenshot/index.js';
import * as scriptTools from '../build/src/tools/script/index.js';
import * as siteExperienceTools from '../build/src/tools/site-experience/index.js';
import * as stealthTools from '../build/src/tools/stealth/index.js';
import * as wasmTools from '../build/src/tools/wasm/index.js';
import * as workflowTools from '../build/src/tools/workflow/index.js';

const OUTPUT_PATH = './docs/reference/tool-reference.md';
const README_PATH = './README.md';

interface ToolDef {
  name: string;
  description: string;
  annotations: {category: ToolCategory; title?: string};
  schema: Record<string, unknown>;
}

function allTools(): ToolDef[] {
  return [
    ...Object.values(analyzerTools),
    ...Object.values(antiDebugTools),
    ...Object.values(bypassDebuggerTools),
    ...Object.values(codeTemplateTools),
    ...Object.values(collectorTools),
    ...Object.values(consoleTools),
    ...Object.values(hookCryptoJS),
    ...Object.values(hookJSEncrypt),
    ...Object.values(hookSMCrypto),
    ...Object.values(debuggerTools),
    ...Object.values(dialogTools),
    ...Object.values(domTools),
    ...Object.values(emulationTools),
    ...Object.values(extensionsTools),
    ...Object.values(framesTools),
    ...Object.values(hookTools),
    ...Object.values(hookAntiAntiHook),
    ...Object.values(hookFixedWindowSize),
    ...Object.values(hookConsoleLog),
    ...Object.values(hookConsoleProtect),
    ...Object.values(hookConsoleTable),
    ...Object.values(hookCookie),
    ...Object.values(hookDateNow),
    ...Object.values(hookFetch),
    ...Object.values(hookHistory),
    ...Object.values(hookJsonParse),
    ...Object.values(hookJsonStringify),
    ...Object.values(hookLocalStorage),
    ...Object.values(hookLocationHref),
    ...Object.values(hookPerformanceNow),
    ...Object.values(hookPromise),
    ...Object.values(hookRandom),
    ...Object.values(hookSessionStorage),
    ...Object.values(hookWebSocket),
    ...Object.values(hookXhrOpen),
    ...Object.values(hookXhrSetRequestHeader),
    ...Object.values(inputTools),
    ...Object.values(navigationTools),
    ...Object.values(networkTools),
    ...Object.values(pageTools),
    ...Object.values(performanceTools),
    ...Object.values(pipelineTools),
    ...Object.values(rebuildTools),
    ...Object.values(screenshotTools),
    ...Object.values(scriptTools),
    ...Object.values(siteExperienceTools),
    ...Object.values(stealthTools),
    ...Object.values(wasmTools),
    ...Object.values(workflowTools),
  ] as ToolDef[];
}

function uniqueToolsByName(tools: ToolDef[]): ToolDef[] {
  const seen = new Set<string>();
  const deduped: ToolDef[] = [];
  for (const item of tools) {
    // Skip non-tool exports (functions, interfaces, constants, etc.)
    if (!item.annotations || !item.name) continue;
    if (seen.has(item.name)) {
      continue;
    }
    seen.add(item.name);
    deduped.push(item);
  }
  return deduped;
}

function generateConfigOptionsMarkdown(): string {
  let markdown = '';
  for (const [optionName, optionConfig] of Object.entries(cliOptions)) {
    if (optionConfig.hidden) continue;
    const aliasText = optionConfig.alias ? `, \`-${optionConfig.alias}\`` : '';
    const description = optionConfig.description || optionConfig.describe || '';

    markdown += `- **\`--${optionName}\`${aliasText}**\n`;
    markdown += `  ${description}\n`;
    markdown += `  - **Type:** ${optionConfig.type}\n`;
    if (optionConfig.choices) {
      markdown += `  - **Choices:** ${optionConfig.choices.map(c => `\`${c}\``).join(', ')}\n`;
    }
    if (optionConfig.default !== undefined) {
      markdown += `  - **Default:** \`${optionConfig.default}\`\n`;
    }
    markdown += '\n';
  }

  return markdown.trim();
}

function updateReadmeBlock(
  beginMarker: string,
  endMarker: string,
  content: string,
): void {
  const readmeContent = fs.readFileSync(README_PATH, 'utf8');
  const beginIndex = readmeContent.indexOf(beginMarker);
  const endIndex = readmeContent.indexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1) {
    return;
  }

  const before = readmeContent.substring(0, beginIndex + beginMarker.length);
  const after = readmeContent.substring(endIndex);
  const updated = `${before}\n\n${content}\n\n${after}`;
  fs.writeFileSync(README_PATH, updated);
}

function generateDocs(): void {
  const tools = uniqueToolsByName(allTools()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const categories = new Map<string, ToolDef[]>();

  for (const tool of tools) {
    const category = tool.annotations.category;
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category)!.push(tool);
  }

  const categoryOrder = Object.values(ToolCategory);
  let markdown = `<!-- AUTO GENERATED DO NOT EDIT - run 'npm run docs' to update-->\n\n# Chrome DevTools MCP Tool Reference\n\n> 快速按逆向目标查工具，请先看：[\`reverse-task-index.md\`](./reverse-task-index.md)\n\n`;

  for (const category of categoryOrder) {
    const toolsInCategory = categories.get(category) || [];
    if (toolsInCategory.length === 0) continue;
    markdown += `- **[${labels[category]}](#${labels[category].toLowerCase().replace(/\s+/g, '-')})** (${toolsInCategory.length} tools)\n`;
    for (const tool of toolsInCategory) {
      markdown += `  - [\`${tool.name}\`](#${tool.name.toLowerCase()})\n`;
    }
  }

  markdown += '\n';

  for (const category of categoryOrder) {
    const toolsInCategory = categories.get(category) || [];
    if (toolsInCategory.length === 0) continue;

    markdown += `## ${labels[category]}\n\n`;
    for (const tool of toolsInCategory) {
      const toolTitle = tool.annotations?.title || tool.name;
      markdown += `### \`${tool.name}\` — ${toolTitle}\n\n`;
      markdown += `**Description:** ${tool.description}\n\n`;

      const params = Object.keys(tool.schema || {});
      if (params.length > 0) {
        markdown += '**Parameters:**\n\n';
        for (const p of params) {
          markdown += `- \`${p}\`\n`;
        }
        markdown += '\n';
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, markdown);

  const toolsTOC = Array.from(categories.entries())
    .map(([category, categoryTools]) => {
      const lines = [
        `- **${labels[category as ToolCategory]}** (${categoryTools.length} tools)`,
      ];
      for (const tool of categoryTools) {
        lines.push(
          `  - [\`${tool.name}\`](docs/reference/tool-reference.md#${tool.name.toLowerCase()})`,
        );
      }
      return lines.join('\n');
    })
    .join('\n');

  updateReadmeBlock(
    '<!-- BEGIN AUTO GENERATED TOOLS -->',
    '<!-- END AUTO GENERATED TOOLS -->',
    toolsTOC,
  );
  updateReadmeBlock(
    '<!-- BEGIN AUTO GENERATED OPTIONS -->',
    '<!-- END AUTO GENERATED OPTIONS -->',
    generateConfigOptionsMarkdown(),
  );

  console.log(`Generated ${OUTPUT_PATH} with ${tools.length} tools.`);
}

generateDocs();
