/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';

import {GENERATED_TOOL_REGISTRY} from '../../../src/tools/generated-tools-index.js';

const repoRoot = process.cwd();

describe('browsercli skill contract', () => {
  it('documents recovery and runtime tools with supported parameters across skill docs', async () => {
    const skillDir = path.join(repoRoot, 'skills/browsercli');
    const refDir = path.join(skillDir, 'references');
    const refFiles = await readdir(refDir);
    const allDocPaths = [
      path.join(skillDir, 'SKILL.md'),
      ...refFiles.map(f => path.join(refDir, f)),
    ];
    const docs = await Promise.all(allDocPaths.map(p => readFile(p, 'utf8')));
    const allContent = docs.join('\n');

    assert.match(allContent, /get_script_source[\s\S]*?--filePath/);
    assert.match(allContent, /get_script_source[\s\S]*?--startLine/);
    assert.match(allContent, /get_script_source[\s\S]*?--endLine/);
    assert.doesNotMatch(
      allContent,
      /get_script_source[^\n]*(--prettyPrint|--offset)/,
    );

    for (const command of [
      'browsercli jobs list',
      'browsercli jobs cancel',
      'browsercli video start',
      'browsercli call evaluate_script',
      'browsercli call get_storage',
      'browsercli call collect_wasm',
      '--captureBase64 <bool>',
      'browsercli call record_start',
      'browsercli call record_stop',
      'browsercli call video',
    ]) {
      assert.ok(
        allContent.includes(command),
        `missing browsercli docs: ${command}`,
      );
    }
  });

  it('indexes all registered tools in model.md', async () => {
    const modelContent = await readFile(
      path.join(repoRoot, 'skills/browsercli/references/model.md'),
      'utf8',
    );
    const modelTools = new Set<string>();
    for (const line of modelContent.split('\n')) {
      const match = line.match(/^\|\s*`([a-zA-Z0-9_]+)`\s*\|/);
      if (match) {
        modelTools.add(match[1]);
      }
    }

    const base = new URL('../../../../build/src/tools/', import.meta.url);
    const registered = new Set<string>();
    for (const entry of GENERATED_TOOL_REGISTRY) {
      const moduleUrl = new URL(entry.modulePath.replace(/^\.\//, ''), base)
        .href;
      const module = (await import(moduleUrl)) as Record<string, unknown>;
      const tool = module[entry.handlerName] as {name?: string} | undefined;
      if (!tool?.name) continue;
      registered.add(tool.name);
    }

    assert.equal(
      modelTools.size,
      registered.size,
      `Tool count mismatch: model.md has ${modelTools.size}, registered has ${registered.size}`,
    );

    for (const tool of registered) {
      assert.ok(
        modelTools.has(tool),
        `model.md missing registered tool: ${tool}`,
      );
    }
  });
});
