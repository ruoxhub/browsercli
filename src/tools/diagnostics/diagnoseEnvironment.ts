/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {runEnvironmentDiagnostics} from '../../diagnostics/environment.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const diagnoseEnvironmentTool = defineTool({
  name: 'diagnose_environment',
  description: '运行环境诊断，检查 Node 版本、构建产物与 artifacts 目录状态。',
  annotations: {
    category: ToolCategory.DIAGNOSTICS,
    readOnlyHint: true,
  },
  schema: {
    checks: zod
      .array(zod.string())
      .optional()
      .describe(
        '可选的要运行的检查项名称列表；省略则运行全部检查。可选值：node_version、build_output、artifacts_dir。',
      ),
  },
  handler: async (request, response) => {
    const report = runEnvironmentDiagnostics();

    if (request.params.checks?.length) {
      const allowed = new Set(request.params.checks);
      report.checks = report.checks.filter(c => allowed.has(c.name));
      const hasFail = report.checks.some(c => c.status === 'fail');
      const hasWarn = report.checks.some(c => c.status === 'warn');
      report.status = hasFail ? 'fail' : hasWarn ? 'warn' : 'ok';
    }

    response.setStructuredContent({
      success: report.status !== 'fail',
      message: `环境诊断完成 (status: ${report.status})`,
      tooltype: 'diagnose_environment',
      data: report,
    });
  },
});
