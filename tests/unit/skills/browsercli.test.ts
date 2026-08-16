/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';

const repoRoot = process.cwd();

describe('browsercli skill contract', () => {
  it('documents recovery and runtime tools with supported parameters', async () => {
    const skill = await readFile(
      path.join(repoRoot, 'skills/browsercli/SKILL.md'),
      'utf8',
    );
    const sourceCommand = skill
      .split('\n')
      .find(line => line.includes('call get_script_source'));

    assert.ok(sourceCommand);
    assert.match(sourceCommand, /--filePath/);
    assert.match(sourceCommand, /--startLine/);
    assert.match(sourceCommand, /--endLine/);
    assert.doesNotMatch(sourceCommand, /--prettyPrint|--offset/);

    for (const command of [
      'browsercli jobs list',
      'browsercli jobs cancel',
      'browsercli call evaluate_script',
      'browsercli call get_storage',
      'browsercli call collect_wasm',
      '--captureBase64 <bool>',
    ]) {
      assert.ok(skill.includes(command), `missing browsercli docs: ${command}`);
    }
  });
});
