#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const TOOLS_META_PATH = resolve(ROOT, 'src', 'cli', 'tools-meta.ts');
const OUTPUT_DIR = resolve(ROOT, 'scripts', 'call_tool');
const RESERVED_FILES = new Set([
  'README.md',
  '_shared.js',
  '_generate-call-tool-scripts.mjs',
]);

function extractObjects(tsSource) {
  const anchor = 'export const TOOLS_META: ToolMeta[] = [';
  const start = tsSource.indexOf(anchor);
  if (start === -1) {
    throw new Error('未找到 TOOLS_META 定义');
  }

  const listStart = tsSource.indexOf('[', start);
  const listEnd = tsSource.indexOf('];', listStart);
  const listContent = tsSource.slice(listStart + 1, listEnd);

  const objects = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let stringChar = '';
  let escaping = false;

  for (const char of listContent) {
    if (inString) {
      current += char;
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }

    if (char === '{') {
      depth += 1;
    }

    if (depth > 0) {
      current += char;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && current.trim()) {
        objects.push(current.trim());
        current = '';
      }
    }
  }

  return objects;
}

function extractString(block, field) {
  const match = block.match(new RegExp(`${field}:\\s*'([^']*)'`, 's'));
  return match ? match[1] : '';
}

function extractSchema(block) {
  const match = block.match(/schema:\s*\{([^}]*)\}/s);
  if (!match) {
    return {};
  }

  const entries = match[1]
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const pair = part.match(/([A-Za-z0-9_]+):\s*'([^']+)'/);
      return pair ? [pair[1], pair[2]] : null;
    })
    .filter(Boolean);

  return Object.fromEntries(entries);
}

function extractTools() {
  const source = readFileSync(TOOLS_META_PATH, 'utf8');
  return extractObjects(source).map(block => ({
    name: extractString(block, 'name'),
    description: extractString(block, 'description'),
    callMode: extractString(block, 'callMode'),
    schema: extractSchema(block),
  }));
}

function defaultValueForField(field, type) {
  if (type === 'number') {
    if (/timeout/i.test(field)) return 10000;
    if (/limit/i.test(field)) return 10;
    if (/idx|index/i.test(field)) return 0;
    if (/time/i.test(field)) return 1;
    return 1;
  }

  if (type === 'boolean') {
    return false;
  }

  const presets = [
    [/url/i, 'https://example.com'],
    [/selector/i, '#app'],
    [/path/i, 'C:/tmp/example.txt'],
    [/file/i, 'C:/tmp/example.txt'],
    [/text/i, 'example-text'],
    [/script/i, '() => document.title'],
    [/function/i, '() => document.title'],
    [/key/i, 'Enter'],
    [/type/i, 'navigate'],
    [/filter/i, 'keyword'],
    [/pattern/i, 'keyword'],
    [/mode/i, 'full'],
    [/format/i, 'json'],
    [/device/i, 'iPhone 14'],
    [/preset/i, 'none'],
    [/sessionid/i, 'demo-session'],
    [/taskid/i, 'demo-task'],
    [/taskslug/i, 'demo-task'],
    [/goal/i, 'demo-goal'],
    [/code/i, 'function demo() { return 1; }'],
    [/name/i, 'demo-name'],
    [/host/i, 'ws://127.0.0.1:5612'],
  ];

  for (const [pattern, value] of presets) {
    if (pattern.test(field)) {
      return value;
    }
  }

  return `example-${field}`;
}

function buildDefaultParams(schema) {
  const entries = Object.entries(schema);
  return Object.fromEntries(
    entries.map(([field, type]) => [field, defaultValueForField(field, type)]),
  );
}

function toScriptContent(tool) {
  const defaultParams = JSON.stringify(buildDefaultParams(tool.schema), null, 2)
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')
    .trimStart();
  const schema = JSON.stringify(tool.schema, null, 2)
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')
    .trimStart();

  return `#!/usr/bin/env node

import {runToolCase} from './_shared.js';

await runToolCase({
  toolName: '${tool.name}',
  description: '${tool.description.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}',
  callMode: '${tool.callMode || 'runtime'}',
  schema: ${schema},
  defaultParams: ${defaultParams},
});
`;
}

function cleanGeneratedFiles() {
  for (const entry of readdirSync(OUTPUT_DIR, {withFileTypes: true})) {
    if (!entry.isFile()) continue;
    if (RESERVED_FILES.has(entry.name)) continue;
    if (!entry.name.endsWith('.js')) continue;
    rmSync(join(OUTPUT_DIR, entry.name));
  }
}

function main() {
  mkdirSync(OUTPUT_DIR, {recursive: true});
  cleanGeneratedFiles();

  const tools = extractTools().filter(tool => tool.name);
  for (const tool of tools) {
    writeFileSync(
      join(OUTPUT_DIR, `${tool.name}.js`),
      toScriptContent(tool),
      'utf8',
    );
  }

  console.log(
    `generated ${tools.length} tool case scripts in scripts/call_tool`,
  );
}

main();
