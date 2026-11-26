/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {DomainManifest, ToolEntry} from '../src/tools/manifest.js';

const REPO_ROOT = process.cwd();
const TOOLS_ROOT = path.join(REPO_ROOT, 'src/tools');
const GENERATED_INDEX_PATH = path.join(TOOLS_ROOT, 'generated-tools-index.ts');

const DOMAIN_DESCRIPTIONS: Record<string, string> = {
  'anti-debug': 'Anti-debugging detection and bypass tools.',
  collector: 'Code and script collection tools.',
  console: 'Browser console inspection tools.',
  css: 'CSS cascade inspection tools.',
  debugger: 'Debugger protocol inspection and breakpoint tools.',
  dialog: 'Browser dialog handling tools.',
  dom: 'DOM inspection and querying tools.',
  emulation: 'Device, CPU, network, and viewport emulation tools.',
  frames: 'Frame listing and selection tools.',
  hook: 'JavaScript runtime hook creation and management tools.',
  input: 'User input simulation tools.',
  navigation: 'Browser page navigation tools.',
  network: 'Network and WebSocket inspection tools.',
  page: 'Page interaction and state tools.',
  pipeline: 'Analysis pipeline example tools.',
  screencast: 'Browser page screencast (video) recording tools.',
  screenshot: 'Page screenshot capture tool.',
  script: 'Page script evaluation tools.',
  wasm: 'WebAssembly reverse engineering tools.',
};

function extractRegistryBlock(source: string, sourcePath: string): string {
  const marker = 'const TOOL_REGISTRY';
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Cannot find ${marker} in ${sourcePath}`);
  }

  const assignment = source.indexOf('=', start);
  if (assignment === -1) {
    throw new Error(`Cannot find registry assignment in ${sourcePath}`);
  }

  const arrayStart = source.indexOf('[', assignment);
  if (arrayStart === -1) {
    throw new Error(`Cannot find registry array start in ${sourcePath}`);
  }

  let depth = 0;
  for (let i = arrayStart; i < source.length; i++) {
    const char = source[i];
    if (char === '[') depth++;
    if (char === ']') {
      depth--;
      if (depth === 0) {
        return source.slice(arrayStart, i + 1);
      }
    }
  }

  throw new Error(`Cannot find registry array end in ${sourcePath}`);
}

function parseRegistryEntries(source: string, sourcePath: string): ToolEntry[] {
  const registryBlock = extractRegistryBlock(source, sourcePath);
  return parseToolEntries(registryBlock);
}

function parseToolEntries(source: string): ToolEntry[] {
  const entryPattern =
    /modulePath:\s*'([^']+)'\s*,\s*handlerName:\s*'([^']+)'(?:\s*,\s*profile:\s*'([^']+)')?/g;
  const entries: ToolEntry[] = [];

  for (const match of source.matchAll(entryPattern)) {
    entries.push({
      modulePath: match[1],
      handlerName: match[2],
      ...(match[3] && {profile: match[3] as ToolEntry['profile']}),
    });
  }

  if (entries.length === 0) {
    throw new Error('No tool registry entries found');
  }

  return entries;
}

function getDomainName(entry: ToolEntry): string {
  const normalized = entry.modulePath.replace(/^\.\//, '');
  const [domain] = normalized.split('/');
  if (!domain) {
    throw new Error(`Cannot infer domain for ${entry.modulePath}`);
  }
  return domain;
}

function groupEntriesByDomain(entries: ToolEntry[]): Map<string, ToolEntry[]> {
  const grouped = new Map<string, ToolEntry[]>();

  for (const entry of entries) {
    const domain = getDomainName(entry);
    const domainEntries = grouped.get(domain) ?? [];
    domainEntries.push(entry);
    grouped.set(domain, domainEntries);
  }

  return grouped;
}

interface LoadedDomainManifest {
  manifest: DomainManifest;
  importPath: string;
}

function extractManifestBlock(source: string, sourcePath: string): string {
  const marker = /export\s+const\s+manifest\s*=\s*\{/.exec(source);
  if (!marker || marker.index === undefined) {
    return source;
  }
  const start = source.indexOf('{', marker.index);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && (inSingle || inDouble || inTemplate)) {
      escaped = true;
      continue;
    }
    if (!inDouble && !inTemplate && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate;
      continue;
    }
    if (inSingle || inDouble || inTemplate) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Cannot find closing brace for manifest in ${sourcePath}`);
}

function parseManifest(source: string, sourcePath: string): DomainManifest {
  const block = extractManifestBlock(source, sourcePath);
  const nameMatch = block.match(/name:\s*'([^']+)'/);
  const descriptionMatch = block.match(/description:\s*'([^']+)'/);
  const profileMatch = block.match(/profile:\s*'([^']+)'/);
  if (!nameMatch) {
    throw new Error(`Cannot find manifest name in ${sourcePath}`);
  }

  return {
    name: nameMatch[1],
    description: descriptionMatch?.[1] ?? `${nameMatch[1]} tools.`,
    ...(profileMatch && {
      profile: profileMatch[1] as DomainManifest['profile'],
    }),
    tools: parseToolEntries(block),
  };
}

function renderToolEntry(entry: ToolEntry, indent = '    '): string {
  return [
    `${indent}{`,
    `${indent}  modulePath: '${entry.modulePath}',`,
    `${indent}  handlerName: '${entry.handlerName}',`,
    ...(entry.profile ? [`${indent}  profile: '${entry.profile}',`] : []),
    `${indent}}`,
  ].join('\n');
}

function renderManifest(manifest: DomainManifest): string {
  const tools = manifest.tools
    .map(entry => `${renderToolEntry(entry)},`)
    .join('\n');
  const profileLine = manifest.profile
    ? `  profile: '${manifest.profile}',\n`
    : '';
  const dependenciesLine = manifest.dependencies
    ? `  dependencies: ${JSON.stringify(manifest.dependencies)},\n`
    : '';

  return `/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: '${manifest.name}',
  description: '${manifest.description}',
${profileLine}${dependenciesLine}  tools: [
${tools}
  ],
} satisfies DomainManifest;
`;
}

function renderGeneratedIndex(manifests: LoadedDomainManifest[]): string {
  const manifestImports = manifests
    .map(
      ({manifest, importPath}) =>
        `import {manifest as ${toManifestIdentifier(manifest.name)}} from '${importPath}';`,
    )
    .join('\n');

  const toolImportMap = new Map<string, string[]>();
  for (const {manifest} of manifests) {
    for (const entry of manifest.tools) {
      const list = toolImportMap.get(entry.modulePath) ?? [];
      if (!list.includes(entry.handlerName)) {
        list.push(entry.handlerName);
      }
      toolImportMap.set(entry.modulePath, list);
    }
  }

  let aliasCounter = 0;
  const staticHandlerImports: string[] = [];
  const staticHandlerEntries: string[] = [];
  for (const [modulePath, handlerNames] of [...toolImportMap.entries()].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const specifiers = handlerNames.map(handlerName => {
      const alias = `_tool_${aliasCounter++}_${handlerName}`;
      staticHandlerEntries.push(
        `  '${modulePath}:${handlerName}': ${alias} as AnyToolDefinition,`,
      );
      return `${handlerName} as ${alias}`;
    });
    staticHandlerImports.push(
      `import {${specifiers.join(', ')}} from '${modulePath}';`,
    );
  }

  const manifestNames = manifests
    .map(({manifest}) => toManifestIdentifier(manifest.name))
    .join(',\n  ');
  const registryEntries = manifests
    .flatMap(({manifest}) => manifest.tools)
    .map(entry => `${renderToolEntry(entry, '  ')},`)
    .join('\n');

  return `/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generated by scripts/generate-tools-index.ts. Do not edit manually.
 */

import type {AnyToolDefinition} from './ToolDefinition.js';
${manifestImports}
${staticHandlerImports.join('\n')}

export const GENERATED_DOMAIN_MANIFESTS = [
  ${manifestNames},
] as const;

export const GENERATED_TOOL_REGISTRY = [
${registryEntries}
] as const;

/**
 * Daemon 侧静态工具注册表（ADR-0009）：
 * 所有注册工具在编译期静态校验并 O(1) 解析，消灭运行时动态 import()。
 */
export const STATIC_TOOL_HANDLERS: Readonly<Record<string, AnyToolDefinition>> =
  {
${staticHandlerEntries.join('\n')}
  };
`;
}

function toManifestIdentifier(domain: string): string {
  return `${domain.replace(/[^a-zA-Z0-9]+(.)/g, (_, char: string) => char.toUpperCase())}Manifest`;
}

async function writeDomainManifests(
  grouped: Map<string, ToolEntry[]>,
): Promise<DomainManifest[]> {
  const manifests: DomainManifest[] = [];

  for (const [domain, tools] of [...grouped.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const manifest: DomainManifest = {
      name: domain,
      description: DOMAIN_DESCRIPTIONS[domain] ?? `${domain} tools.`,
      tools,
    };
    const manifestPath = path.join(TOOLS_ROOT, domain, 'manifest.ts');
    await mkdir(path.dirname(manifestPath), {recursive: true});
    await writeFile(manifestPath, renderManifest(manifest), 'utf8');
    manifests.push(manifest);
  }

  return manifests;
}

async function readDomainManifests(): Promise<LoadedDomainManifest[]> {
  const entries = await readdir(TOOLS_ROOT, {withFileTypes: true});
  const manifests: LoadedDomainManifest[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (
        entry.name === 'manifest.ts' ||
        entry.name === 'generated-tools-index.ts'
      ) {
        continue;
      }
      const filePath = path.join(TOOLS_ROOT, entry.name);
      const source = await readFile(filePath, 'utf8');
      if (
        !/export\s+const\s+manifest\s*=\s*\{/.test(source) ||
        !/satisfies\s+DomainManifest/.test(source)
      ) {
        continue;
      }
      const baseName = entry.name.slice(0, -3);
      manifests.push({
        manifest: parseManifest(source, filePath),
        importPath: `./${baseName}.js`,
      });
      continue;
    }

    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(TOOLS_ROOT, entry.name, 'manifest.ts');
    try {
      const source = await readFile(manifestPath, 'utf8');
      manifests.push({
        manifest: parseManifest(source, manifestPath),
        importPath: `./${entry.name}/manifest.js`,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }

  return manifests.sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name),
  );
}

async function main(): Promise<void> {
  let manifests = await readDomainManifests();

  if (manifests.length === 0) {
    const toolsMetaPath = path.join(REPO_ROOT, 'src/cli/tools-meta.ts');
    const source = await readFile(toolsMetaPath, 'utf8');
    const entries = parseRegistryEntries(source, toolsMetaPath);
    const grouped = groupEntriesByDomain(entries);
    const written = await writeDomainManifests(grouped);
    manifests = written.map(manifest => ({
      manifest,
      importPath: `./${manifest.name}/manifest.js`,
    }));
  }

  await writeFile(
    GENERATED_INDEX_PATH,
    renderGeneratedIndex(manifests),
    'utf8',
  );
  const toolCount = manifests.reduce(
    (total, {manifest}) => total + manifest.tools.length,
    0,
  );
  console.log(
    `Generated ${manifests.length} manifests with ${toolCount} tools`,
  );
}

await main();
