/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {ensureToolsMeta, searchTools} from '../../cli/tools-meta.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

interface ToolSearchHit {
  name: string;
  description: string;
  domain: string;
  profile: string;
}

export const searchToolsMeta = defineTool({
  name: 'search_tools',
  description:
    'Find reverse-engineering tools by natural language query. Returns tool name, description, domain and profile. Use this when the active profile does not yet expose the tool you need; the result tells you which tool to ask the operator to enable.',
  annotations: {category: ToolCategory.DATA, readOnlyHint: true},
  schema: {
    query: zod
      .string()
      .min(1)
      .describe('Natural language description of what you want to do.'),
    limit: zod
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Max results (default 10).'),
  },
  handler: async (request, response) => {
    await ensureToolsMeta();
    const {query, limit = 10} = request.params;
    const results = await searchTools(query);
    const hits: ToolSearchHit[] = results.slice(0, limit).map(t => ({
      name: t.name,
      description: t.description,
      domain: t.domain,
      profile: t.profile,
    }));
    response.appendResponseLine(JSON.stringify(hits, null, 2));
  },
});
