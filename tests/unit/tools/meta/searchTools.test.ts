/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {searchToolsMeta} from '../../../../src/tools/meta/searchTools.js';

interface FakeResponseLike {
  appendResponseLine(value: string): void;
}

function createFakeResponse(): {
  response: FakeResponseLike;
  lines: string[];
} {
  const lines: string[] = [];
  const response: FakeResponseLike = {
    appendResponseLine(value: string) {
      lines.push(value);
    },
  };
  return {response, lines};
}

describe('searchToolsMeta', () => {
  it('exposes defineTool shape with correct name and category', () => {
    assert.strictEqual(searchToolsMeta.name, 'search_tools');
    assert.strictEqual(searchToolsMeta.annotations.readOnlyHint, true);
    assert.ok(
      typeof searchToolsMeta.description === 'string' &&
        searchToolsMeta.description.length > 0,
    );
  });

  it('schema declares query string and optional limit', () => {
    const keys = Object.keys(searchToolsMeta.schema);
    assert.ok(keys.includes('query'));
    assert.ok(keys.includes('limit'));
  });

  it('handler returns JSON list of matching tools through response', async () => {
    const {response, lines} = createFakeResponse();

    await searchToolsMeta.handler(
      {params: {query: 'screenshot', limit: 3}},
      response as never,
      {} as never,
    );

    const payload = lines.join('\n');
    const parsed = JSON.parse(payload) as Array<{name: string}>;
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length <= 3);
  });
});
