/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const clearMitmRules = defineTool({
  name: 'mitm_clear_rules',
  description: '清空全部 MITM 改写规则。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response) => {
    const result = getRuntime().mitmModule.clearRules();
    response.setStructuredContent({...result, tooltype: 'mitm_clear_rules'});
  },
});
