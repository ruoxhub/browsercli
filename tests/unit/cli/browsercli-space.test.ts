/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * `browser space list` — the CLI's own branches.
 *
 * `ego-spaces.test.ts` covers `queryEgoSpaces`/`parseResult`; nothing covered the
 * command that wraps them, so the sub-command rejection, the JSON shape, the
 * human table and the error mapping were all asserted only by hand. The query is
 * injected here (the same seam the module already offers via `runScript`), so
 * these tests need neither ego nor a daemon.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {AxiError} from 'axi-sdk-js';

import {runSpaceCommand} from '../../../src/cli/commands/browser.js';
import type {EgoSpaceSnapshot} from '../../../src/modules/browser/ego/ego-spaces.js';

const SNAPSHOT: EgoSpaceSnapshot = {
  spaces: [
    {
      id: 3,
      name: 'browsercli-abc',
      ownership: 'agent',
      createdBy: 'agent',
      profileId: 'Profile 7',
      profileName: 'ruoxing 2(Chrome)',
    },
    {
      id: 9,
      name: '',
      ownership: 'user',
      createdBy: 'user',
      profileId: 'Profile 1',
    },
  ],
  profiles: [
    {id: 'Profile 7', name: 'ruoxing 2(Chrome)', isDefault: false},
    {id: 'Profile 1', name: 'rx', isDefault: true},
  ],
};

const query = async (): Promise<EgoSpaceSnapshot> => SNAPSHOT;

describe('browser space list', () => {
  it('rejects a missing or unknown sub-command before querying ego', async () => {
    for (const rest of [[], ['ls'], ['list', 'extra']]) {
      let queried = false;
      await assert.rejects(
        async () =>
          runSpaceCommand(rest, {}, undefined, async () => {
            queried = true;
            return SNAPSHOT;
          }),
        (error: unknown) => {
          assert.ok(error instanceof AxiError, JSON.stringify(rest));
          assert.strictEqual(error.code, 'VALIDATION_ERROR');
          assert.match(error.message, /space 的子命令只有 list/);
          return true;
        },
        JSON.stringify(rest),
      );
      assert.strictEqual(queried, false, 'ego must not be asked');
    }
  });

  it('rejects an unknown flag', async () => {
    await assert.rejects(
      async () => runSpaceCommand(['list'], {nope: true}, undefined, query),
      (error: unknown) => {
        assert.ok(error instanceof AxiError);
        assert.match(error.message, /未知参数：--nope/);
        return true;
      },
    );
  });

  it('maps the snapshot to the JSON shape', async () => {
    const ctx = {
      session: 's1',
      connect: async () => {
        throw new Error('space list must not touch the daemon');
      },
    };
    const output = (await runSpaceCommand(
      ['list'],
      {json: true},
      ctx,
      query,
    )) as Record<string, unknown>;

    assert.equal(output['command'], 'browser');
    assert.equal(output['action'], 'space');
    assert.equal(output['subaction'], 'list');
    assert.equal(output['session'], 's1');
    assert.equal(output['status'], 'success');
    assert.deepEqual(output['spaces'], [
      {
        id: 3,
        name: 'browsercli-abc',
        ownership: 'agent',
        createdBy: 'agent',
        profileId: 'Profile 7',
        profileName: 'ruoxing 2(Chrome)',
      },
      {
        id: 9,
        name: '',
        ownership: 'user',
        createdBy: 'user',
        profileId: 'Profile 1',
        profileName: '',
      },
    ]);
    assert.equal(output['defaultProfileId'], 'Profile 1');
    // `profiles` is the single source for the profile list: it must not be
    // shadowed by a second, string[][] copy (the dead data this test pins).
    assert.deepEqual(output['profiles'], [
      {id: 'Profile 7', name: 'ruoxing 2(Chrome)', isDefault: false},
      {id: 'Profile 1', name: 'rx', isDefault: true},
    ]);
    assert.strictEqual(output['profileHeaders'], undefined);
  });

  it('renders the human table, marks unnamed spaces, and names the default profile', async () => {
    const output = (await runSpaceCommand(
      ['list'],
      {},
      undefined,
      query,
    )) as Record<string, unknown>;

    assert.deepEqual(output['headers'], ['ID', '名称', '归属', 'Profile']);
    assert.deepEqual(output['rows'], [
      ['3', 'browsercli-abc', 'agent', 'Profile 7 / ruoxing 2(Chrome)'],
      ['9', '(未命名)', 'user', 'Profile 1'],
    ]);
    assert.match(String(output['hint']), /Profile 1/);
    // One `profiles` key only, and it is the object array the renderer prints as
    // its own table.
    assert.ok(Array.isArray(output['profiles']));
    assert.deepEqual(
      (output['profiles'] as Array<{id: string}>)[1]?.id,
      'Profile 1',
    );
  });

  it('maps an ego query failure to a BROWSER_ERROR, not a validation error', async () => {
    await assert.rejects(
      async () =>
        runSpaceCommand(['list'], {}, undefined, async () => {
          throw new Error('ego lite 未安装或未找到 ego-browser CLI');
        }),
      (error: unknown) => {
        assert.ok(error instanceof AxiError);
        assert.strictEqual(error.code, 'BROWSER_ERROR');
        assert.match(error.message, /ego lite 未安装/);
        return true;
      },
    );
  });
});
