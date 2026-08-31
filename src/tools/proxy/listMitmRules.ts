/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const listMitmRules = defineTool({
  name: 'mitm_list_rules',
  description: '列出当前生效的全部 MITM 改写规则。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const result = getRuntime().mitmModule.listRules();
    response.setStructuredContent({...result, tooltype: 'mitm_list_rules'});
  },
});
