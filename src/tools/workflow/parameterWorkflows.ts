/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {getParameterWorkflowLibrary} from '../../modules/workflows/ParameterWorkflowLibrary.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const listParameterWorkflowsTool = defineTool({
  name: 'list_parameter_workflows',
  description:
    '列出可用于指导逆向工程与复现步骤的打包参数化工作流。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {},
  handler: async (_request, response) => {
    const library = await getParameterWorkflowLibrary();
    const items = await library.listWorkflows();
    response.setStructuredContent({
      success: true,
      message: `共 ${items.length} 个参数化工作流`,
      tooltype: 'list_parameter_workflows',
      data: {items},
    });
  },
});

export const getParameterWorkflowTool = defineTool({
  name: 'get_parameter_workflow',
  description: '按 ID 或别名获取一个打包的参数化工作流。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    id: zod
      .string()
      .min(1)
      .describe('工作流 ID 或别名，例如 `jd-h5st` 或 `h5st`。'),
  },
  handler: async (request, response) => {
    const library = await getParameterWorkflowLibrary();
    const doc = await library.getWorkflow(request.params.id);
    response.setStructuredContent({
      success: true,
      message: `已获取参数化工作流: ${doc.metadata.title}`,
      tooltype: 'get_parameter_workflow',
      data: {
        id: doc.metadata.id,
        title: doc.metadata.title,
        aliases: doc.metadata.aliases,
        category: doc.metadata.category,
        summary: doc.metadata.summary,
        parts: doc.parts,
        mutations: doc.mutations,
        workflow: doc.workflow,
      },
    });
  },
});

export const recommendParameterWorkflowTool = defineTool({
  name: 'recommend_parameter_workflow',
  description:
    '根据关键字、别名或简短自然语言查询，推荐最匹配的参数化工作流。',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    query: zod
      .string()
      .min(1)
      .describe(
        '关键字或简短查询，例如 `h5st` 或 `query token sign`。',
      ),
  },
  handler: async (request, response) => {
    const library = await getParameterWorkflowLibrary();
    const doc = await library.recommendWorkflow(request.params.query);
    response.setStructuredContent({
      success: true,
      message: `推荐参数化工作流: ${doc.metadata.title}`,
      tooltype: 'recommend_parameter_workflow',
      data: {
        id: doc.metadata.id,
        title: doc.metadata.title,
        aliases: doc.metadata.aliases,
        category: doc.metadata.category,
        summary: doc.metadata.summary,
        parts: doc.parts,
        mutations: doc.mutations,
        workflow: doc.workflow,
      },
    });
  },
});
