/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import * as proxyTools from '../../../../src/tools/proxy/index.js';

const EXPECTED_TOOLS = [
  'start_mitm_proxy',
  'stop_mitm_proxy',
  'list_mitm_requests',
  'get_mitm_request',
  'clear_mitm_requests',
  'export_mitm_ca',
  'mitm_add_rule',
  'mitm_list_rules',
  'mitm_remove_rule',
  'mitm_clear_rules',
  'mitm_export_har',
  'mitm_add_host_filter',
  'mitm_list_host_filters',
  'mitm_remove_host_filter',
  'mitm_clear_host_filters',
];

interface ToolLike {
  name: string;
  annotations: {category: string};
}

/** index.js 以 camelCase handler 名 re-export，这里按 definition.name（snake_case）建立索引。 */
const toolsByName = new Map<string, ToolLike>();
for (const exported of Object.values(proxyTools)) {
  if (
    exported &&
    typeof exported === 'object' &&
    'name' in exported &&
    'annotations' in exported
  ) {
    const tool = exported as ToolLike;
    toolsByName.set(tool.name, tool);
  }
}

describe('proxy tools', () => {
  for (const toolName of EXPECTED_TOOLS) {
    it(`${toolName} 已注册且 category 为 network`, () => {
      const tool = toolsByName.get(toolName);
      assert.ok(tool, `${toolName} 应存在`);
      assert.strictEqual(tool.name, toolName);
      assert.strictEqual(tool.annotations.category, 'network');
    });
  }
});
