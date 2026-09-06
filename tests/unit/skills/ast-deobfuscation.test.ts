/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const require = createRequire(import.meta.url);

describe('ast-deobfuscation decodeObfuscator compatibility pass', () => {
  it('normalizes safe OB constructs without evaluating source code', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ast-deobfuscation-'));
    const inputPath = path.join(tempDir, 'input.js');
    const outputPath = path.join(tempDir, 'output.js');

    try {
      await writeFile(
        inputPath,
        String.raw`var _0xobj = { answer: 1 };
_0xobj["label"] = "\x6f\x6b";
while (!![]) console.log("\x68\x69", 1 + 2);`,
        'utf8',
      );

      await execFileAsync(process.execPath, [
        path.join(
          repoRoot,
          'skills/ast-deobfuscation/scripts/decode-obfuscator-pass.js',
        ),
        inputPath,
        outputPath,
      ]);

      const output = await readFile(outputPath, 'utf8');
      assert.match(output, /["']?label["']?\s*:\s*["']ok["']/);
      assert.doesNotMatch(output, /_0xobj\[["']label["']\]\s*=/);
      assert.match(output, /while \(true\) \{/);
      assert.match(output, /console\.log\(["']hi["'], 3\)/);
    } finally {
      await rm(tempDir, {recursive: true, force: true});
    }
  });

  it('wires the pass into OB pipelines and documents its safety boundary', async () => {
    const [pipelineConfig, skill] = await Promise.all([
      readFile(
        path.join(
          repoRoot,
          'skills/ast-deobfuscation/scripts/pipeline-config.js',
        ),
        'utf8',
      ),
      readFile(
        path.join(repoRoot, 'skills/ast-deobfuscation/SKILL.md'),
        'utf8',
      ),
    ]);

    assert.match(pipelineConfig, /decode-obfuscator-pass\.js/);
    assert.match(pipelineConfig, /decodeObfuscatorPass/);
    const {buildPipeline} = require(
      path.join(
        repoRoot,
        'skills/ast-deobfuscation/scripts/pipeline-config.js',
      ),
    );
    for (const patternId of ['cn-bidding-ob', 'mps-ob']) {
      assert.ok(
        buildPipeline(patternId).some(
          (step: {id: string}) => step.id === 'decode_obfuscator_pass',
        ),
        `missing decodeObfuscator pass in ${patternId}`,
      );
    }
    for (const patternId of ['generic', 'reese84', 'dingxiang']) {
      assert.ok(
        buildPipeline(patternId).every(
          (step: {id: string}) => step.id !== 'decode_obfuscator_pass',
        ),
        `unexpected decodeObfuscator pass in ${patternId}`,
      );
    }
    assert.match(skill, /decodeObfuscator/);
    assert.match(skill, /eval/);
  });

  it('keeps the deeply nested decodeObfuscator demo parseable', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ast-deobfuscation-'));
    const outputPath = path.join(tempDir, 'output.js');

    try {
      await execFileAsync(process.execPath, [
        path.join(
          repoRoot,
          'skills/ast-deobfuscation/scripts/decode-obfuscator-pass.js',
        ),
        path.join(repoRoot, 'open-source/decodeObfuscator-main/input/demo.js'),
        outputPath,
      ]);
      await execFileAsync(process.execPath, ['--check', outputPath]);
    } finally {
      await rm(tempDir, {recursive: true, force: true});
    }
  });

  it('references current proxycli tools for source collection and runtime verification', async () => {
    const [skill, proxycliReference] = await Promise.all([
      readFile(
        path.join(repoRoot, 'skills/ast-deobfuscation/SKILL.md'),
        'utf8',
      ),
      readFile(
        path.join(
          repoRoot,
          'skills/ast-deobfuscation/references/proxycli-tools.md',
        ),
        'utf8',
      ),
    ]);

    assert.match(skill, /references\/proxycli-tools\.md/);
    assert.match(skill, /proxycli/);
    for (const command of [
      'proxycli status',
      'proxycli call list_pages',
      'proxycli call list_scripts',
      'proxycli call search_in_sources --query',
      'proxycli call get_script_source --scriptId',
      '--filePath',
      'proxycli call list_targets',
      'proxycli call dump_target_scripts --targetId',
      'proxycli call hook_function --target',
      'proxycli call get_hook_data',
      'proxycli call record_reverse_evidence',
    ]) {
      assert.ok(
        proxycliReference.includes(command),
        `missing proxycli reference: ${command}`,
      );
    }
    assert.doesNotMatch(proxycliReference, /--prettyPrint|--offset/);
  });
});
