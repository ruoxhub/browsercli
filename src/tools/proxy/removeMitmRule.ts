/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {RemoveMitmRuleParams} from '../../modules/proxy/index.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const removeMitmRule = defineTool({
  name: 'mitm_remove_rule',
  description: '按 id 移除一条 MITM 改写规则。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    id: zod.string().describe('要移除的规则 id。'),
  },
  handler: async (request, response) => {
    const result = getRuntime().mitmModule.removeRule(
      request.params as RemoveMitmRuleParams,
    );
    response.setStructuredContent({...result, tooltype: 'mitm_remove_rule'});
  },
});
