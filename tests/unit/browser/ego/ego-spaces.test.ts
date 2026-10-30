/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * `browser space list` is the answer to the question `--profile` raises: which
 * profile ids exist and which one a space already uses. It runs against ego
 * directly (no daemon), so the tests drive `queryEgoSpaces` with an injected
 * runner and pin the two things that make or break it:
 *
 *   1. the marker contract — ego's runtime cannot have its `console` replaced,
 *      and it mixes its own diagnostics into the same stream, so the result is a
 *      marker-prefixed line and a missing marker must be an ERROR, never an
 *      empty table that reads as "you have no spaces";
 *   2. the shape mapping — ids stay numbers, optional fields survive as absent.
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  parseResult,
  queryEgoSpaces,
  type EgoSpaceQueryOptions,
} from '../../../../src/modules/browser/ego/ego-spaces.js';

const MARKER = '__EGO_SPACES__';

function payload(value: unknown): string {
  return `${MARKER}${JSON.stringify(value)}`;
}

describe('parseResult', () => {
  it('reads the marker line and maps spaces and profiles', () => {
    const raw = [
      'some unrelated diagnostic from ego',
      payload({
        spaces: [
          {
            id: 3,
            name: 'browsercli-abc',
            ownership: 'agent',
            createdBy: 'agent',
            profileId: 'Profile 7',
            profileName: 'ruoxing 2(Chrome)',
          },
        ],
        profiles: [
          {id: 'Profile 7', name: 'ruoxing 2(Chrome)', isDefault: false},
        ],
      }),
    ].join('\n');

    const snapshot = parseResult(raw);
    assert.equal(snapshot.spaces.length, 1);
    assert.equal(snapshot.spaces[0]?.id, 3);
    assert.equal(snapshot.spaces[0]?.profileId, 'Profile 7');
    assert.equal(snapshot.profiles.length, 1);
    assert.equal(snapshot.profiles[0]?.isDefault, false);
  });

  it('uses the LAST marker so earlier chatter cannot shadow the result', () => {
    const raw = [
      payload({spaces: [{id: 1}], profiles: []}),
      payload({spaces: [{id: 2}], profiles: []}),
    ].join('\n');
    assert.equal(parseResult(raw).spaces[0]?.id, 2);
  });

  it('throws when ego reported an error inside the marker', () => {
    assert.throws(
      () =>
        parseResult(
          payload({error: 'no active browser', spaces: [], profiles: []}),
        ),
      /no active browser/,
    );
  });

  it('throws rather than returning an empty list when the marker is absent', () => {
    // This is the failure mode that matters: an empty table would tell the user
    // they have no task spaces, when the truth is the query never completed.
    assert.throws(
      () => parseResult('TypeError: boom\nsome stack'),
      /没有返回任务空间数据/,
    );
  });

  it('throws on malformed JSON after the marker', () => {
    assert.throws(() => parseResult(`${MARKER}{not json`), /无法解析/);
  });

  it('drops rows with the wrong id type instead of inventing one', () => {
    const raw = payload({
      spaces: [
        {id: 'not-a-number', name: 'bad'},
        {id: 5, name: 'ok'},
      ],
      profiles: [
        {id: 7, name: 'bad'},
        {id: 'Profile 1', name: 'ok'},
      ],
    });
    const snapshot = parseResult(raw);
    assert.deepEqual(
      snapshot.spaces.map(space => space.id),
      [5],
    );
    assert.deepEqual(
      snapshot.profiles.map(profile => profile.id),
      ['Profile 1'],
    );
  });

  it('treats a missing arrays as empty rather than crashing', () => {
    const snapshot = parseResult(payload({}));
    assert.deepEqual(snapshot.spaces, []);
    assert.deepEqual(snapshot.profiles, []);
  });
});

describe('queryEgoSpaces', () => {
  it('fails with an actionable message when ego is not installed', async () => {
    await assert.rejects(
      () => queryEgoSpaces({binary: null}),
      /ego lite 未安装|EGO_BROWSER_CLI/,
    );
  });

  it('fails rather than reporting zero spaces when the script never ran', async () => {
    const options: EgoSpaceQueryOptions = {
      binary: process.execPath,
      runScript: async () => 'ego-browser: command not found',
    };
    await assert.rejects(() => queryEgoSpaces(options), /没有返回任务空间数据/);
  });

  it('returns the parsed snapshot from the injected runner', async () => {
    const options: EgoSpaceQueryOptions = {
      binary: process.execPath,
      runScript: async () =>
        payload({
          spaces: [{id: 9, name: 'unit-test'}],
          profiles: [{id: 'Profile 1', name: 'rx', isDefault: true}],
        }),
    };
    const snapshot = await queryEgoSpaces(options);
    assert.equal(snapshot.spaces[0]?.id, 9);
    assert.equal(snapshot.profiles[0]?.isDefault, true);
  });

  it('refuses to run a script the caller did not ask for', async () => {
    // The injected runner must receive the query script, not an empty string:
    // a silent empty script would produce "no spaces" for every machine.
    let seen = '';
    await queryEgoSpaces({
      binary: process.execPath,
      runScript: async (_binary, script) => {
        seen = script;
        return payload({spaces: [], profiles: []});
      },
    });
    assert.match(seen, /listTaskSpaces/);
    assert.match(seen, /listProfiles/);
    assert.match(seen, /emit\(/);
  });

  it('forwards timeoutMs to runScript', async () => {
    let capturedTimeout: number | undefined;
    await queryEgoSpaces({
      binary: process.execPath,
      timeoutMs: 12_345,
      runScript: async (_binary, _script, timeoutMs) => {
        capturedTimeout = timeoutMs;
        return payload({spaces: [], profiles: []});
      },
    });
    assert.equal(capturedTimeout, 12_345);
  });
});
