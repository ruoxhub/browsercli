/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ToolContextProvider} from '../../../src/worker/ToolContextProvider.js';
import {DefineToolContextFactory} from '../../../src/worker/DefineToolContextFactory.js';
import {listPages} from '../../../src/tools/navigation/listPages.js';
import {ToolResponseAccumulator} from '../../../src/worker/ToolResponseProcessor.js';

describe('listPages tool local verification', () => {
  it('handles empty pages without throwing unhandled error', async () => {
    const provider = new ToolContextProvider();
    const factory = new DefineToolContextFactory(provider);
    const context = factory.create();
    const response = new ToolResponseAccumulator();

    await listPages.handler({params: {}}, response, context);
    const result = response.toJSON();

    assert.ok(result.structuredContent);
    const structured = result.structuredContent as Record<string, unknown>;
    assert.strictEqual(structured.success, false);
    assert.match(structured.message as string, /没有选中的页面/);
  });
});
