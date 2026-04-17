/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';

import {cliOptions} from '../build/src/cli.js';
import * as analyzerTools from '../build/src/tools/analyzer.js';
import * as antiDebugTools from '../build/src/tools/anti-debug/antiAntiDebug.js';
import * as bypassDebuggerTools from '../build/src/tools/anti-debug/bypassDebugger.js';
import {ToolCategory, labels} from '../build/src/tools/categories.js';
import * as codeTemplateTools from '../build/src/tools/code-templates.js';
import * as collectorTools from '../build/src/tools/collector.js';
import * as consoleTools from '../build/src/tools/console.js';
import * as hookCryptoJS from '../build/src/tools/crypto/hookCryptoJS.js';
import * as hookJSEncrypt from '../build/src/tools/crypto/hookJSEncrypt.js';
import * as hookSMCrypto from '../build/src/tools/crypto/hookSMCrypto.js';
import * as debuggerTools from '../build/src/tools/debugger.js';
import * as dialogTools from '../build/src/tools/dialog.js';
import * as domTools from '../build/src/tools/dom.js';
import * as emulationTools from '../build/src/tools/emulation.js';
import * as extensionsTools from '../build/src/tools/extensions.js';
import * as framesTools from '../build/src/tools/frames.js';
import * as hookAntiAntiHook from '../build/src/tools/hook/antiAntiHook.js';
import * as hookFixedWindowSize from '../build/src/tools/hook/fixedWindowSize.js';
import * as hookConsoleLog from '../build/src/tools/hook/hookConsoleLog.js';
import * as hookConsoleProtect from '../build/src/tools/hook/hookConsoleProtect.js';
import * as hookConsoleTable from '../build/src/tools/hook/hookConsoleTable.js';
import * as hookCookie from '../build/src/tools/hook/hookCookie.js';
import * as hookDateNow from '../build/src/tools/hook/hookDateNow.js';
import * as hookFetch from '../build/src/tools/hook/hookFetch.js';
import * as hookHistory from '../build/src/tools/hook/hookHistory.js';
import * as hookJsonParse from '../build/src/tools/hook/hookJsonParse.js';
import * as hookJsonStringify from '../build/src/tools/hook/hookJsonStringify.js';
import * as hookLocalStorage from '../build/src/tools/hook/hookLocalStorage.js';
import * as hookLocationHref from '../build/src/tools/hook/hookLocationHref.js';
import * as hookPerformanceNow from '../build/src/tools/hook/hookPerformanceNow.js';
import * as hookPromise from '../build/src/tools/hook/hookPromise.js';
import * as hookRandom from '../build/src/tools/hook/hookRandom.js';
import * as hookSessionStorage from '../build/src/tools/hook/hookSessionStorage.js';
import * as hookWebSocket from '../build/src/tools/hook/hookWebSocket.js';
import * as hookXhrOpen from '../build/src/tools/hook/hookXhrOpen.js';
import * as hookXhrSetRequestHeader from '../build/src/tools/hook/hookXhrSetRequestHeader.js';
import * as hookTools from '../build/src/tools/hook.js';
import * as inputTools from '../build/src/tools/input.js';
import * as networkTools from '../build/src/tools/network.js';
import * as pageTools from '../build/src/tools/page.js';
import * as pagesTools from '../build/src/tools/pages.js';
import * as performanceTools from '../build/src/tools/performance.js';
import * as rebuildTools from '../build/src/tools/rebuild.js';
import * as screenshotTools from '../build/src/tools/screenshot.js';
import * as scriptInjectorTools from '../build/src/tools/script-injector.js';
import * as scriptTools from '../build/src/tools/script.js';
import * as siteExperienceTools from '../build/src/tools/siteExperience.js';
import * as skillTools from '../build/src/tools/skill.js';
import * as stealthTools from '../build/src/tools/stealth.js';
import * as vJsTools from '../build/src/tools/v-jstools.js';
import * as vueDevtoolsTools from '../build/src/tools/vue/activateVueDevtools.js';
import * as vueClearGuardTools from '../build/src/tools/vue/clearVueGuards.js';
import * as vueRouteTools from '../build/src/tools/vue/getVueRoutes.js';
import * as websocketTools from '../build/src/tools/websocket.js';

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
    ...Object.values(networkTools),
    ...Object.values(pageTools),
    ...Object.values(pagesTools),
    ...Object.values(performanceTools),
    ...Object.values(rebuildTools),
    ...Object.values(screenshotTools),
    ...Object.values(scriptTools),
    ...Object.values(scriptInjectorTools),
    ...Object.values(siteExperienceTools),
    ...Object.values(skillTools),
    ...Object.values(stealthTools),
    ...Object.values(vJsTools),
    ...Object.values(vueDevtoolsTools),
    ...Object.values(vueClearGuardTools),
    ...Object.values(vueRouteTools),
    ...Object.values(websocketTools),
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
