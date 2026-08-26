/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const stopMitmProxy = defineTool({
  name: 'stop_mitm_proxy',
  description: '停止 MITM 抓包代理并释放端口。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response) => {
    const result = await getRuntime().mitmModule.stop();
    response.setStructuredContent({...result, tooltype: 'stop_mitm_proxy'});
  },
});
