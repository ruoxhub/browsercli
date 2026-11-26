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
const skillPath = path.join(repoRoot, 'skills/browsercli/SKILL.md');

describe('browsercli skill contract', () => {
  it('documents recovery and runtime tools with supported parameters', async () => {
    const skillContent = await readFile(skillPath, 'utf8');

    assert.match(skillContent, /get_script_source[\s\S]*?--filePath/);
    assert.match(skillContent, /get_script_source[\s\S]*?--startLine/);
    assert.match(skillContent, /get_script_source[\s\S]*?--endLine/);
    assert.doesNotMatch(
      skillContent,
      /get_script_source[^\n]*(--prettyPrint|--offset)/,
    );

    for (const command of [
      'browsercli screencast_start',
      'browsercli screencast_stop',
      'browsercli evaluate_script',
      'browsercli get_storage',
      'browsercli collect_wasm',
      'browsercli record_start',
      'browsercli record_stop',
    ]) {
      assert.ok(
        skillContent.includes(command),
        `missing browsercli docs: ${command}`,
      );
    }
  });

  it('indexes all registered tools in SKILL.md', async () => {
    const skillContent = await readFile(skillPath, 'utf8');

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

    assert.ok(registered.size > 0, 'tool registry is empty');

    for (const tool of registered) {
      assert.ok(
        skillContent.includes(tool),
        `SKILL.md missing registered tool: ${tool}`,
      );
    }
  });
});
