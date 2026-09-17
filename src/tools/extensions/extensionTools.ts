/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';

import {ExtensionSessionManager} from '../../modules/extension/host/ExtensionSessionManager.js';
import {getNativeHostPaths} from '../../modules/extension/host/NativeHostManifest.js';
import {zod} from '../../third_party/index.js';
import {createToolError, ErrorCodes} from '../../utils/errors.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const extensionStatus = defineTool({
  name: 'extension_status',
  description:
    '检查浏览器扩展连接器的状态，包括 Native Host 安装情况、扩展连接状态及受控标签页。',
  annotations: {
    title: '扩展连接器状态',
    category: ToolCategory.DIAGNOSTICS,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const {manifestPath, scriptPath} = getNativeHostPaths();
    const manifestInstalled = fs.existsSync(manifestPath);
    const scriptInstalled = fs.existsSync(scriptPath);

    const manager = ExtensionSessionManager.getInstance();
    const isConnected = manager.isConnected();

    let pingResult = null;
    if (isConnected) {
      try {
        pingResult = await manager.ping();
      } catch (err) {
        pingResult = {error: String(err)};
      }
    }

    const data = {
      nativeHostInstalled: manifestInstalled && scriptInstalled,
      manifestPath,
      scriptPath,
      connected: isConnected,
      ping: pingResult,
      claimedTabs: manager.getClaimedTabs(),
      attachedTabs: manager.getAttachedTabs(),
    };

    response.setStructuredContent({
      success: true,
      data,
      summary: `扩展连接器状态: Native Host=${data.nativeHostInstalled ? '已安装' : '未安装'}, 连接=${data.connected ? '已连接' : '未连接'}, 受控Tabs=${data.claimedTabs.length}`,
    });
  },
});

export const extensionListTabs = defineTool({
  name: 'extension_list_tabs',
  description:
    '通过已连接的浏览器扩展列出当前 Chrome 中打开的所有标签页（包含 ID、标题、URL、是否已认领）。',
  annotations: {
    title: '列出扩展标签页',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const manager = ExtensionSessionManager.getInstance();
    if (!manager.isConnected()) {
      throw createToolError(
        ErrorCodes.CONNECTION,
        '浏览器扩展尚未连接。请确保在 Chrome 中安装并启用了扩展程序。',
        {toolName: 'extension_list_tabs'},
      );
    }

    const tabs = await manager.listTabs();
    response.setStructuredContent({
      success: true,
      tabs,
      count: tabs.length,
    });
  },
});

export const extensionClaimTab = defineTool({
  name: 'extension_claim_tab',
  description:
    '认领用户浏览器中现有的标签页，将其加入受控租约并附加 CDP 调试器。',
  annotations: {
    title: '认领扩展标签页',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    tabId: zod
      .number()
      .int()
      .describe('要认领的 Chrome 标签页 ID（从 extension_list_tabs 获取）。'),
  },
  handler: async (request, response) => {
    const {tabId} = request.params;
    const manager = ExtensionSessionManager.getInstance();
    if (!manager.isConnected()) {
      throw createToolError(ErrorCodes.CONNECTION, '浏览器扩展尚未连接。', {
        toolName: 'extension_claim_tab',
      });
    }

    const result = await manager.claimTab(tabId);
    response.setStructuredContent({
      success: true,
      tabId,
      result,
      message: `成功认领标签页 ${tabId}: ${result.title || ''} (${result.url || ''})`,
    });
  },
});

export const extensionCreateTab = defineTool({
  name: 'extension_create_tab',
  description:
    '通过扩展在用户浏览器中新建一个受控标签页，并自动将其加入 Agent 彩色分组。',
  annotations: {
    title: '创建扩展标签页',
    category: ToolCategory.NAVIGATION,
    readOnlyHint: false,
  },
  schema: {
    url: zod
      .string()
      .optional()
      .describe('新建标签页的初始 URL，默认为 about:blank。'),
    active: zod
      .boolean()
      .optional()
      .describe('是否将新建标签页置为当前前台页面，默认为 true。'),
  },
  handler: async (request, response) => {
    const {url = 'about:blank', active = true} = request.params;
    const manager = ExtensionSessionManager.getInstance();
    if (!manager.isConnected()) {
      throw createToolError(ErrorCodes.CONNECTION, '浏览器扩展尚未连接。', {
        toolName: 'extension_create_tab',
      });
    }

    const result = await manager.createTab(url, active);
    response.setStructuredContent({
      success: true,
      result,
      message: `成功创建标签页 ${result.tabId} 并加入受控组: ${result.url}`,
    });
  },
});

export const extensionExecuteCdp = defineTool({
  name: 'extension_execute_cdp',
  description:
    '在指定受控标签页上执行任意原生 Chrome DevTools Protocol (CDP 1.3) 指令。',
  annotations: {
    title: '执行扩展 CDP 命令',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    tabId: zod.number().int().describe('目标标签页 ID。'),
    method: zod
      .string()
      .min(1)
      .describe('CDP 方法名称，例如 Runtime.evaluate 或 Network.getCookies。'),
    params: zod
      .record(zod.string(), zod.unknown())
      .optional()
      .describe('CDP 参数对象。'),
    sessionId: zod.string().optional().describe('可选的目标 CDP session ID。'),
  },
  handler: async (request, response) => {
    const {tabId, method, params = {}, sessionId} = request.params;
    const manager = ExtensionSessionManager.getInstance();
    if (!manager.isConnected()) {
      throw createToolError(ErrorCodes.CONNECTION, '浏览器扩展尚未连接。', {
        toolName: 'extension_execute_cdp',
      });
    }

    const result = await manager.executeCdp(tabId, method, params, sessionId);
    response.setStructuredContent({
      success: true,
      tabId,
      method,
      result,
    });
  },
});

export const extensionMoveMouse = defineTool({
  name: 'extension_move_mouse',
  description: '在指定受控标签页中拟人化平滑移动鼠标光标，并在到达后返回确认。',
  annotations: {
    title: '扩展拟人化鼠标移动',
    category: ToolCategory.INPUT,
    readOnlyHint: false,
  },
  schema: {
    tabId: zod.number().int().describe('目标标签页 ID。'),
    x: zod.number().describe('目标 X 坐标。'),
    y: zod.number().describe('目标 Y 坐标。'),
    durationMs: zod
      .number()
      .int()
      .min(10)
      .max(5000)
      .optional()
      .describe('动画持续时间毫秒，默认 120ms。'),
  },
  handler: async (request, response) => {
    const {tabId, x, y, durationMs = 120} = request.params;
    const manager = ExtensionSessionManager.getInstance();
    if (!manager.isConnected()) {
      throw createToolError(ErrorCodes.CONNECTION, '浏览器扩展尚未连接。', {
        toolName: 'extension_move_mouse',
      });
    }

    const result = await manager.moveMouse(tabId, x, y, durationMs);
    response.setStructuredContent({
      success: true,
      tabId,
      x,
      y,
      result,
    });
  },
});
