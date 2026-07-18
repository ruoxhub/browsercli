/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import {ToolCategory} from '../categories.js';
import {SIGNATURE_HEADER_PATTERN} from '../network/constants.js';
import type {RequestInitiator} from '../network/types.js';
import {defineTool} from '../ToolDefinition.js';

function findSignatureIndicators(headers: Record<string, string>): string[] {
  return Object.keys(headers).filter(key => SIGNATURE_HEADER_PATTERN.test(key));
}

function redactHeaders(
  headers: Record<string, string>,
  includeSensitiveValues: boolean,
): Record<string, string> {
  if (includeSensitiveValues) {
    return headers;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SIGNATURE_HEADER_PATTERN.test(key) ? '[redacted]' : value,
    ]),
  );
}

async function readPausedFrames(contextProvider: ToolContextProvider) {
  try {
    const debuggerContext = await contextProvider.getDebuggerContext();
    const pausedState = debuggerContext.getPausedState();
    if (!pausedState) {
      return [];
    }

    return pausedState.callFrames.map(frame => ({
      callFrameId: frame.callFrameId,
      functionName: frame.functionName ?? '',
      url: frame.url ?? '',
      lineNumber: frame.location?.lineNumber ?? 0,
      columnNumber: frame.location?.columnNumber ?? 0,
    }));
  } catch {
    return [];
  }
}

function buildNextActions(input: {
  requestUrlPattern: string;
  headerKeyword: string;
  hasRequests: boolean;
  hasPausedFrames: boolean;
}): string[] {
  const urlHint = input.requestUrlPattern || '*';
  const headerHint = input.headerKeyword || 'sign/token/auth/nonce';

  return [
    input.hasRequests
      ? `调用 list_network_requests 并设置 headerFilter="${headerHint}" 复核签名请求`
      : '先触发登录、下单、分页等目标业务动作，再重新运行 trace_signature_generation',
    `调用 xhr_to_js_breakpoint，参数包含 urlPattern="${urlHint}"，在请求发送前暂停`,
    input.hasPausedFrames
      ? '调用 evaluate_on_callframe 检查局部变量、this、headers、body、sign/token/nonce'
      : '命中断点后调用 get_paused_info，再调用 evaluate_on_callframe 查看局部变量',
    '调用 export_session_report 输出请求指纹、调试步骤、证据和剩余缺口',
  ];
}

/**
 * 签名追踪工作流
 */
export const traceSignatureGeneration = defineTool({
  name: 'trace_signature_generation',
  description:
    '签名追踪工作流：根据请求头/URL 线索，关联网络请求、Hook 诊断、XHR 断点与调用帧检查',
  annotations: {category: ToolCategory.REVERSE_ENGINEERING, readOnlyHint: true},
  schema: {
    requestUrlPattern: zod
      .string()
      .optional()
      .describe('用于过滤请求的 URL 模式'),
    headerKeyword: zod
      .string()
      .optional()
      .describe('用于过滤签名相关请求头的关键字'),
    maxResults: zod
      .number()
      .optional()
      .describe('最大结果数（默认：10）'),
    includeSensitiveValues: zod
      .boolean()
      .optional()
      .describe('包含敏感的请求头值'),
    taskId: zod.string().optional().describe('用于证据追踪的任务 ID'),
  },
  handler: async (request, response, _context) => {
    const params = request.params;
    const requestUrlPattern = params.requestUrlPattern ?? '';
    const headerKeyword = (params.headerKeyword ?? '').toLowerCase();
    const maxResults = Math.max(1, Math.floor(params.maxResults ?? 10));
    const includeSensitiveValues = params.includeSensitiveValues === true;

    const contextProvider = getRuntime().contextProvider!;
    const selectedPage = contextProvider.getSelectedPage();
    const pages = contextProvider.getPages();
    const pageIndex =
      selectedPage && !selectedPage.isClosed()
        ? pages.indexOf(selectedPage)
        : -1;

    if (pageIndex < 0) {
      response.setStructuredContent({
        success: true,
        message: '签名追踪完成，当前无活跃页面，请先打开或选择页面',
        tooltype: 'trace_signature_generation',
        data: {
          requestFingerprints: [],
          pausedFrames: [],
          evidence: {requestHeaders: [], initiators: []},
          nextActions: [
            '先通过 new_page 或 navigate_page 打开目标页面',
            '触发登录、下单、分页等目标业务动作',
            '重新运行 trace_signature_generation',
          ],
          gaps: ['无活跃页面，无法获取网络请求'],
          taskId: params.taskId,
        },
      });
      return;
    }

    let requests;
    try {
      requests = contextProvider.getNetworkRequests(false, pageIndex);
    } catch {
      requests = [];
    }
    requests = requests
      .filter(request => {
        if (requestUrlPattern && !request.url().includes(requestUrlPattern)) {
          return false;
        }
        if (!headerKeyword) {
          return true;
        }
        return Object.entries(request.headers()).some(([key, value]) =>
          `${key}: ${value}`.toLowerCase().includes(headerKeyword),
        );
      })
      .slice(0, maxResults);

    const requestFingerprints = requests.map(request => {
      const headers = request.headers();
      return {
        reqid: contextProvider.getNetworkRequestStableId(request),
        method: request.method(),
        url: request.url(),
        signatureIndicators: findSignatureIndicators(headers),
      };
    });

    const evidence = {
      requestHeaders: requests.map(request =>
        redactHeaders(request.headers(), includeSensitiveValues),
      ),
      initiators: requests
        .map(request => contextProvider.getRequestInitiator(request))
        .filter((item): item is RequestInitiator => Boolean(item)),
    };

    const pausedFrames = await readPausedFrames(contextProvider);
    const nextActions = buildNextActions({
      requestUrlPattern,
      headerKeyword,
      hasRequests: requests.length > 0,
      hasPausedFrames: pausedFrames.length > 0,
    });

    response.setStructuredContent({
      success: true,
      message:
        requests.length > 0
          ? `签名追踪完成，匹配 ${requests.length} 个请求`
          : '签名追踪完成，尚未匹配请求；请先触发目标业务动作',
      tooltype: 'trace_signature_generation',
      data: {
        requestFingerprints,
        pausedFrames,
        evidence,
        nextActions,
        gaps:
          requests.length === 0 ? ['未发现匹配请求，无法关联签名生成链路'] : [],
        taskId: params.taskId,
      },
    });
  },
});
