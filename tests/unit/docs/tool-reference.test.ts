/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';

import {GENERATED_TOOL_REGISTRY} from '../../../src/tools/generated-tools-index.js';

const repoRoot = process.cwd();
const TOOL_REFERENCE = 'docs/reference/tool-reference.md';

/**
 * Resolve every tool name the registry actually exports, by importing each
 * manifest entry's module and reading its `name`.
 */
async function registryToolNames(): Promise<string[]> {
  const base = new URL('../../../../build/src/tools/', import.meta.url);
  const names: string[] = [];
  for (const entry of GENERATED_TOOL_REGISTRY) {
    const moduleUrl = new URL(entry.modulePath.replace(/^\.\//, ''), base).href;
    const module = (await import(moduleUrl)) as Record<string, unknown>;
    const tool = module[entry.handlerName] as {name?: string} | undefined;
    if (!tool?.name) continue;
    names.push(tool.name);
  }
  return [...new Set(names)].sort();
}

/** Tool names documented in the generated reference, in document order. */
async function documentedToolNames(): Promise<string[]> {
  const markdown = await readFile(path.join(repoRoot, TOOL_REFERENCE), 'utf8');
  return [...markdown.matchAll(/^### `([a-z0-9_]+)`/gm)].map(m => m[1]);
}

describe('tool reference documentation', () => {
  it('documents exactly the tools the registry registers', async () => {
    const registered = await registryToolNames();
    const documented = (await documentedToolNames()).sort();

    assert.deepEqual(
      documented,
      registered,
      `${TOOL_REFERENCE} is out of date. Run \`npm run docs:generate\` to regenerate it.`,
    );
  });

  it('matches the tool count stated in the header', async () => {
    const markdown = await readFile(
      path.join(repoRoot, TOOL_REFERENCE),
      'utf8',
    );
    assert.ok(
      markdown.includes('AUTO GENERATED DO NOT EDIT'),
      'tool-reference.md must stay a generated file',
    );
    assert.equal(
      new Set(await documentedToolNames()).size,
      (await registryToolNames()).length,
      'duplicate tool name in tool-reference.md',
    );
  });
});
