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
  description:
    'Run environment diagnostics to check Node version, build output, AI configuration, and artifacts directory status.',
  annotations: {
    category: ToolCategory.DIAGNOSTICS,
    readOnlyHint: true,
  },
  schema: {
    checks: zod
      .array(zod.string())
      .optional()
      .describe(
        'Optional list of check names to run. If omitted, all checks run. Valid names: node_version, build_output, ai_provider_selection, artifacts_dir.',
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
