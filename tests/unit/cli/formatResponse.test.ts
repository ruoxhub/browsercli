/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {decode} from '@toon-format/toon';

import {
  formatToolResponse,
  formatToolResponseAsMarkdown,
  formatToolResponseAsToon,
  isOutputFormat,
  renderStructuredAsToon,
} from '../../../src/cli/formatResponse.js';
import {getToonEncode} from '../../../src/third_party/toon.js';

describe('formatResponse (md / json / toon)', () => {
  it('validates output formats accurately', () => {
    assert.equal(isOutputFormat('md'), true);
    assert.equal(isOutputFormat('json'), true);
    assert.equal(isOutputFormat('toon'), true);
    assert.equal(isOutputFormat('xml'), false);
    assert.equal(isOutputFormat(undefined), false);
  });

  it('loads @toon-format/toon encoder lazily via getToonEncode', async () => {
    const encode = await getToonEncode();
    const out = encode({name: 'Ada', count: 3});
    assert.deepEqual(decode(out), {name: 'Ada', count: 3});
  });

  it('renders structured tabular payload using TOON without JSON fencing', async () => {
    const result = {
      structuredContent: {
        success: true,
        message: 'Listed 2 requests',
        network: {
          total: 2,
          requests: [
            {
              reqid: 1,
              method: 'GET',
              url: 'https://example.com/a',
              status: 200,
            },
            {
              reqid: 2,
              method: 'POST',
              url: 'https://example.com/b',
              status: 201,
            },
          ],
        },
      },
    };

    const toon = await formatToolResponse(
      'list_network_requests',
      result,
      'toon',
    );
    assert.match(toon, /^# list_network_requests/m);
    assert.match(toon, /Listed 2 requests/);
    assert.doesNotMatch(toon, /```json/);
    assert.match(toon, /requests\[2\]\{reqid,method,url,status\}:/);
    assert.match(toon, /1,GET,"https:\/\/example\.com\/a",200/);
    assert.match(toon, /2,POST,"https:\/\/example\.com\/b",201/);

    const md = formatToolResponseAsMarkdown('list_network_requests', result);
    assert.match(md, /```json/);
    assert.ok(toon.length < md.length);
  });

  it('renders snapshot (filePath / textOutline / structured object) and consoleErrors in TOON', async () => {
    const withOutline = await formatToolResponseAsToon('click', {
      structuredContent: {
        success: true,
        message: 'Clicked button',
        snapshot: {
          snapshotId: 'snap-1',
          nodeCount: 2,
          textOutline: 'uid=1_0 root\n  uid=1_1 button "Submit"',
        },
        consoleErrors: ['ReferenceError: x', 'TypeError: y'],
        data: {ok: true, retries: 0},
      },
    });
    assert.match(withOutline, /# click/);
    assert.match(withOutline, /## Snapshot\n```text\nuid=1_0 root/);
    assert.match(withOutline, /## Console Errors/);
    assert.match(withOutline, /ReferenceError: x/);
    assert.match(withOutline, /ok: true/);
    assert.match(withOutline, /retries: 0/);

    const withFile = await formatToolResponseAsToon('take_snapshot', {
      structuredContent: {
        success: true,
        snapshot: {snapshotId: 'snap-2', nodeCount: 10, filePath: '/tmp/a.txt'},
      },
    });
    assert.match(
      withFile,
      /- Snapshot: `snap-2` \(10 nodes\) -> `\/tmp\/a\.txt`/,
    );

    const withTreeSnapshot = await formatToolResponseAsToon('take_snapshot', {
      structuredContent: {
        success: true,
        snapshot: {uid: '1_0', role: 'RootWebArea', name: 'Demo'},
      },
    });
    assert.match(withTreeSnapshot, /## Snapshot/);
    assert.match(withTreeSnapshot, /role: RootWebArea/);
  });

  it('handles raw strings, arrays, primitives, and custom encoder injection', async () => {
    assert.equal(
      await formatToolResponseAsToon('echo', 'plain text'),
      'plain text',
    );
    assert.equal(await formatToolResponseAsToon('num', 42), '42');
    assert.equal(await formatToolResponseAsToon('nil', null), '');

    const arrOut = await formatToolResponseAsToon('list_items', [
      {id: 1, tag: 'a'},
      {id: 2, tag: 'b'},
    ]);
    assert.deepEqual(decode(arrOut), [
      {id: 1, tag: 'a'},
      {id: 2, tag: 'b'},
    ]);

    const injected = renderStructuredAsToon(
      'custom',
      {structuredContent: {data: {k: 'v'}}},
      val => `CUSTOM(${JSON.stringify(val)})`,
    );
    assert.equal(injected, '# custom\n\nCUSTOM({"k":"v"})');
  });

  it('defaults to toon and supports explicit md and json output via formatToolResponse', async () => {
    const payload = {structuredContent: {success: true, data: {x: 1}}};
    const defaultOut = await formatToolResponse('eval', payload);
    assert.match(defaultOut, /x: 1/);
    assert.doesNotMatch(defaultOut, /```json/);

    const jsonOut = await formatToolResponse('eval', payload, 'json');
    assert.deepEqual(JSON.parse(jsonOut), payload);

    const mdOut = await formatToolResponse('eval', payload, 'md');
    assert.match(mdOut, /```json/);
  });
});
