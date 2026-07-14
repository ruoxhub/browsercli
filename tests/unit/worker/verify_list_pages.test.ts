/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {listPages} from '../../../src/tools/navigation/listPages.js';
import {
  ToolContextProvider,
  DefineToolContextFactory,
} from '../../../src/worker/ToolContext.js';
import {ToolResponseAccumulator} from '../../../src/worker/ToolResponse.js';

describe('listPages tool local verification', () => {
  it('handles empty pages without throwing unhandled error', async () => {
    const provider = new ToolContextProvider();
    const factory = new DefineToolContextFactory(provider);
    const context = factory.create();
    const response = new ToolResponseAccumulator();

    await listPages.handler({params: {}}, response, context);
    const result = response.toJSON();

    assert.ok(result.structuredContent);
    const structured = result.structuredContent as {
      success: boolean;
      message: string;
      tooltype: string;
      data: {pageInfos: unknown[]; selectedIndex: number};
    };
    assert.strictEqual(structured.success, true);
    assert.match(structured.message, /当前没有打开的页面/);
    assert.strictEqual(structured.tooltype, 'list_pages');
    assert.ok(Array.isArray(structured.data.pageInfos));
    assert.strictEqual(structured.data.pageInfos.length, 0);
  });
});
