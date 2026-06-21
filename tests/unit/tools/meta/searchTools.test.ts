/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {searchToolsMeta} from '../../../../src/tools/meta/searchTools.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

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

  it('handler returns structured tool hits through response', async () => {
    const response = new ToolResponseAccumulator();

    await searchToolsMeta.handler(
      {params: {query: 'screenshot', limit: 3}},
      response,
      {} as never,
    );

    const result = response.toJSON();
    const structured = result.structuredContent as {
      success: boolean;
      tooltype: string;
      data: {hits: Array<{name: string}>};
    };
    assert.strictEqual(structured.success, true);
    assert.strictEqual(structured.tooltype, 'search_tools');
    assert.ok(Array.isArray(structured.data.hits));
    assert.ok(structured.data.hits.length <= 3);
  });
});
