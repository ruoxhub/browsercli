/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';

import {ToolCategory, labels} from '../build/src/tools/categories.js';
import {GENERATED_TOOL_REGISTRY} from '../build/src/tools/generated-tools-index.js';

const OUTPUT_PATH = './docs/reference/tool-reference.md';

interface ToolDef {
  name: string;
  description: string;
  annotations: {category: ToolCategory; title?: string};
  schema: Record<string, unknown>;
}

async function allTools(): Promise<ToolDef[]> {
  return await Promise.all(
    GENERATED_TOOL_REGISTRY.map(async entry => {
      const moduleUrl = new URL(
        `../build/src/tools/${entry.modulePath.replace(/^\.\//, '')}`,
        import.meta.url,
      );
      const module = (await import(moduleUrl.href)) as Record<string, unknown>;
      return module[entry.handlerName] as ToolDef;
    }),
  );
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

async function generateDocs(): Promise<void> {
  const tools = uniqueToolsByName(await allTools()).sort((a, b) =>
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

  fs.writeFileSync(OUTPUT_PATH, `${markdown.trimEnd()}\n`);

  console.log(`Generated ${OUTPUT_PATH} with ${tools.length} tools.`);
}

await generateDocs();
