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

describe('proxycli skill contract', () => {
  it('documents recovery and runtime tools with supported parameters', async () => {
    const skill = await readFile(
      path.join(repoRoot, 'skills/proxycli/SKILL.md'),
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
      'proxycli jobs list',
      'proxycli jobs cancel',
      'proxycli call evaluate_script',
      'proxycli call get_storage',
      'proxycli call collect_wasm',
      '--captureBase64 <bool>',
    ]) {
      assert.ok(skill.includes(command), `missing proxycli docs: ${command}`);
    }
  });
});
