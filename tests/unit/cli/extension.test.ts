/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test, {describe} from 'node:test';

import {extensionCommand} from '../../../src/cli/commands/extension.js';

describe('CLI - extensionCommand', () => {
  test('should return status info in json mode', async () => {
    const output = await extensionCommand(['status', '--json'], {
      session: 'test-session',
      spawnFlags: [],
      connect: async () => {
        throw new Error('Not needed');
      },
    });

    const parsed = JSON.parse(output as string);
    assert.strictEqual(parsed.command, 'extension');
    assert.strictEqual(parsed.action, 'status');
    assert.ok(typeof parsed.nativeHostInstalled === 'boolean');
    assert.ok(typeof parsed.manifestPath === 'string');
  });

  test('should return extension path in json mode', async () => {
    const output = await extensionCommand(['path', '--json'], {
      session: 'test-session',
      spawnFlags: [],
      connect: async () => {
        throw new Error('Not needed');
      },
    });

    const parsed = JSON.parse(output as string);
    assert.ok(parsed.extensionDir.includes('chrome-extension'));
    assert.strictEqual(parsed.exists, true);
  });

  test('should throw VALIDATION_ERROR on unknown subcommand', async () => {
    await assert.rejects(
      async () => {
        await extensionCommand(['invalid-subcommand'], {
          session: 'test-session',
          spawnFlags: [],
          connect: async () => {
            throw new Error('Not needed');
          },
        });
      },
      (err: any) => {
        return err.code === 'VALIDATION_ERROR';
      },
    );
  });
});
