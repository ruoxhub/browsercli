/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  buildCommandPatterns,
  buildToolCommand,
  getToolArgSpec,
  shieldLiteralArgs,
} from '../../../src/cli/cliCommands.js';
import {loadStaticToolsManifest} from '../../../src/cli/tools-manifest-loader.js';

describe('cliCommands (chrome-devtools style positional args)', () => {
  it('builds positional command patterns and usage for every tool in manifest', () => {
    const manifest = loadStaticToolsManifest();
    assert.ok(manifest && manifest.tools.length > 0);

    for (const tool of manifest.tools) {
      const {slots, positionalSuffix, usage} = buildToolCommand(
        tool.name,
        tool.argSpecs,
      );
      const [pattern] = buildCommandPatterns([tool.name], positionalSuffix);

      // Optional flags must only appear in usage, never in yargs command pattern
      assert.ok(
        !pattern.includes('--'),
        `${tool.name}: command pattern must not contain -- flags (${pattern})`,
      );

      // Variadic positional must always be the last token
      const variadicIdx = pattern.indexOf('..]');
      assert.ok(
        variadicIdx === -1 || variadicIdx === pattern.length - 3,
        `${tool.name}: variadic positional must be last (${pattern})`,
      );

      assert.ok(usage.startsWith(`$0 ${tool.name}`), usage);

      // Every required array arg must be variadic
      for (const [argName, spec] of Object.entries(tool.argSpecs ?? {})) {
        if (spec.required && spec.type === 'string[]') {
          assert.ok(
            slots.some(s => s.name === argName && s.variadic === true),
            `${tool.name}: required array arg ${argName} must be variadic`,
          );
        }
      }
    }
  });

  it('builds expected command patterns for key tools', () => {
    const manifest = loadStaticToolsManifest();
    assert.ok(manifest);
    const byName = new Map(manifest.tools.map(t => [t.name, t]));

    const selectPage = buildToolCommand(
      'select_page',
      byName.get('select_page')?.argSpecs,
    );
    assert.equal(selectPage.positionalSuffix, ' [pageId]');
    assert.match(selectPage.usage, /^\$0 select_page \[pageId\]/);
    assert.ok(selectPage.usage.includes('[--bringToFront]'));

    const newPage = buildToolCommand(
      'new_page',
      byName.get('new_page')?.argSpecs,
    );
    assert.equal(newPage.positionalSuffix, ' [url]');
    assert.match(newPage.usage, /^\$0 new_page <url>/);
    assert.ok(!newPage.usage.includes('[--url]'));

    const resizePage = buildToolCommand(
      'resize_page',
      byName.get('resize_page')?.argSpecs,
    );
    assert.equal(resizePage.positionalSuffix, ' [width] [height]');
    assert.equal(
      resizePage.usage,
      '$0 resize_page <width> <height> [--pageId]',
    );

    const waitFor = buildToolCommand(
      'wait_for',
      byName.get('wait_for')?.argSpecs,
    );
    assert.equal(waitFor.positionalSuffix, ' [text..]');
    assert.match(waitFor.usage, /^\$0 wait_for <text\.\.>/);
    assert.ok(waitFor.usage.includes('[--pageId]'));

    // Browser/stateless tools (other than select_page/close_page) must not gain --pageId
    const listPagesCmd = buildToolCommand(
      'list_pages',
      byName.get('list_pages')?.argSpecs,
    );
    assert.ok(!listPagesCmd.usage.includes('[--pageId]'));
    const diagnoseCmd = buildToolCommand(
      'diagnose_environment',
      byName.get('diagnose_environment')?.argSpecs,
    );
    assert.ok(!diagnoseCmd.usage.includes('[--pageId]'));
  });

  it('shieldLiteralArgs protects dash-prefixed positionals and skips leading -s and known options', () => {
    const manifest = loadStaticToolsManifest();
    assert.ok(manifest);
    const specs = new Map(
      manifest.tools.map(t => [t.name, getToolArgSpec(t.name, t.argSpecs)]),
    );
    const getSpec = (name: string) => specs.get(name);

    // Leading global -s before command name must skip session value
    const withSession = shieldLiteralArgs(
      ['-s', 'work', 'fill', '1_4', '--not-a-flag'],
      getSpec,
    );
    assert.equal(withSession.argv[0], '-s');
    assert.equal(withSession.argv[1], 'work');
    assert.equal(withSession.argv[2], 'fill');
    assert.equal(withSession.argv[3], '1_4');
    assert.ok(!withSession.argv[4].startsWith('-'));
    assert.equal(withSession.restore(withSession.argv[4]), '--not-a-flag');

    // Known flag --url must not be shielded
    const knownFlag = shieldLiteralArgs(
      ['new_page', '--url', 'https://example.com'],
      getSpec,
    );
    assert.deepEqual(knownFlag.argv, [
      'new_page',
      '--url',
      'https://example.com',
    ]);

    // Unknown dash token AFTER all positionals are filled is left unshielded
    const trailingUnknown = shieldLiteralArgs(
      ['fill', '1_4', 'hello', '--unknownFlag'],
      getSpec,
    );
    assert.deepEqual(trailingUnknown.argv, [
      'fill',
      '1_4',
      'hello',
      '--unknownFlag',
    ]);

    // Negative numbers remain unshielded
    const negativeNum = shieldLiteralArgs(['select_page', '-1'], getSpec);
    assert.deepEqual(negativeNum.argv, ['select_page', '-1']);
  });
});
