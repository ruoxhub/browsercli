#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {Command} from 'commander';
import {sendCommand} from '../daemon/client.js';

/**
 * 从 Zod 类型推断 commander 参数格式
 */
export function getParameterType(zodType: any): string {
  const typeName = zodType.constructor.name.toLowerCase();

  if (typeName.includes('array')) {
    return 'string'; // 数组作为逗号分隔的字符串处理
  }
  if (typeName.includes('boolean')) {
    return 'boolean';
  }
  if (typeName.includes('number') || typeName.includes('int')) {
    return 'number';
  }
  if (typeName.includes('enum')) {
    return 'string';
  }
  // 默认作为字符串
  return 'string';
}

/**
 * 检查字段是否必填
 */
export function isOptional(zodType: any): boolean {
  const typeName = zodType.constructor.name.toLowerCase();
  // Optional 包装的类型
  if (typeName.includes('optional')) {
    return true;
  }
  // 有 default 值的类型
  if (typeName.includes('default')) {
    return true;
  }
  return false;
}

/**
 * 从工具 schema 生成 commander 选项
 */
export function registerToolSchema(
  cmd: Command,
  schema: Record<string, any>,
): void {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  for (const [paramName, paramDef] of Object.entries(schema)) {
    const optional = isOptional(paramDef);
    const paramType = getParameterType(paramDef);

    // 从 zod 描述提取人类可读的描述
    let description = paramName;
    if (paramDef && typeof paramDef === 'object' && paramDef.description) {
      description = paramDef.description;
    }

    if (paramType === 'boolean') {
      // 布尔类型使用 --flag 格式
      cmd.option(`--${paramName}`, description);
    } else if (optional) {
      // 可选参数使用 [--param] 格式
      cmd.option(`--${paramName} <value>`, description);
    } else {
      // 必填参数使用 <param> 格式
      cmd.argument(`<${paramName}>`, description);
    }
  }
}

/**
 * 格式化工具执行结果
 */
export function formatResult(result: {
  success: boolean;
  result?: string;
  error?: string;
}): string {
  if (!result.success) {
    return `执行失败：${result.error || '未知错误'}`;
  }
  if (result.result) {
    return result.result;
  }
  return '执行成功';
}

/**
 * 懒加载工具注册表 - 存储模块路径而非直接 import
 */
interface LazyToolDefinition {
  name: string;
  description: string;
  schema: Record<string, any>;
  modulePath: string;
  handlerName: string;
  aliases?: string[];
  requiresAI?: boolean;
  requiresBrowser?: boolean;
}

const LAZY_TOOLS: LazyToolDefinition[] = [
  {
    name: 'invoke_skill',
    description: '调用技能',
    schema: {},
    modulePath: './skill.js',
    handlerName: 'invokeSkill',
  },
  {
    name: 'list_skills',
    description: '列出所有技能',
    schema: {},
    modulePath: './skill.js',
    handlerName: 'listSkills',
  },
  {
    name: 'query_dom',
    description: '查询 DOM',
    schema: {},
    modulePath: './dom.js',
    handlerName: 'queryDom',
  },
  {
    name: 'get_dom_structure',
    description: '获取 DOM 结构',
    schema: {},
    modulePath: './dom.js',
    handlerName: 'getDomStructure',
  },
  {
    name: 'find_clickable_elements',
    description: '查找可点击元素',
    schema: {},
    modulePath: './dom.js',
    handlerName: 'findClickableElements',
  },
  {
    name: 'list_network_requests',
    description: '列出网络请求',
    schema: {},
    modulePath: './network.js',
    handlerName: 'listNetworkRequests',
  },
  {
    name: 'get_network_request',
    description: '获取网络请求',
    schema: {},
    modulePath: './network.js',
    handlerName: 'getNetworkRequest',
  },
  {
    name: 'list_console_messages',
    description: '列出控制台消息',
    schema: {},
    modulePath: './console.js',
    handlerName: 'listConsoleMessages',
  },
  {
    name: 'get_console_message',
    description: '获取控制台消息',
    schema: {},
    modulePath: './console.js',
    handlerName: 'getConsoleMessage',
  },
  {
    name: 'list_websocket_connections',
    description: '列出 WebSocket 连接',
    schema: {},
    modulePath: './websocket.js',
    handlerName: 'listWebSocketConnections',
  },
  {
    name: 'get_websocket_messages',
    description: '获取 WebSocket 消息',
    schema: {},
    modulePath: './websocket.js',
    handlerName: 'getWebSocketMessages',
  },
  {
    name: 'analyze_websocket_messages',
    description: '分析 WebSocket 消息',
    schema: {},
    modulePath: './websocket.js',
    handlerName: 'analyzeWebSocketMessages',
  },
  {
    name: 'click',
    description: '点击元素',
    schema: {},
    modulePath: './input.js',
    handlerName: 'click',
  },
  {
    name: 'press_key',
    description: '按键',
    schema: {},
    modulePath: './input.js',
    handlerName: 'pressKey',
  },
  {
    name: 'fill_form',
    description: '填写表单',
    schema: {},
    modulePath: './input.js',
    handlerName: 'fillForm',
  },
  {
    name: 'upload_file',
    description: '上传文件',
    schema: {},
    modulePath: './input.js',
    handlerName: 'uploadFile',
  },
  {
    name: 'hover',
    description: '悬停',
    schema: {},
    modulePath: './input.js',
    handlerName: 'hover',
  },
  {
    name: 'drag',
    description: '拖拽',
    schema: {},
    modulePath: './input.js',
    handlerName: 'drag',
  },
  {
    name: 'click_element',
    description: '点击元素',
    schema: {},
    modulePath: './page.js',
    handlerName: 'clickElement',
  },
  {
    name: 'type_text',
    description: '输入文本',
    schema: {},
    modulePath: './page.js',
    handlerName: 'typeText',
  },
  {
    name: 'wait_for_element',
    description: '等待元素',
    schema: {},
    modulePath: './page.js',
    handlerName: 'waitForElement',
  },
  {
    name: 'scroll_by',
    description: '滚动页面',
    schema: {},
    modulePath: './page.js',
    handlerName: 'scrollBy',
  },
  {
    name: 'save_session_state',
    description: '保存会话状态',
    schema: {},
    modulePath: './page.js',
    handlerName: 'saveSessionState',
  },
  {
    name: 'restore_session_state',
    description: '恢复会话状态',
    schema: {},
    modulePath: './page.js',
    handlerName: 'restoreSessionState',
  },
  {
    name: 'list_session_states',
    description: '列出会话状态',
    schema: {},
    modulePath: './page.js',
    handlerName: 'listSessionStates',
  },
  {
    name: 'delete_session_state',
    description: '删除会话状态',
    schema: {},
    modulePath: './page.js',
    handlerName: 'deleteSessionState',
  },
  {
    name: 'dump_session_state',
    description: '导出会话状态',
    schema: {},
    modulePath: './page.js',
    handlerName: 'dumpSessionState',
  },
  {
    name: 'load_session_state',
    description: '加载会话状态',
    schema: {},
    modulePath: './page.js',
    handlerName: 'loadSessionState',
  },
  {
    name: 'check_browser_health',
    description: '检查浏览器健康状态',
    schema: {},
    modulePath: './page.js',
    handlerName: 'checkBrowserHealth',
  },
  {
    name: 'list_pages',
    description: '列出页面',
    schema: {},
    modulePath: './pages.js',
    handlerName: 'listPages',
  },
  {
    name: 'select_page',
    description: '选择页面',
    schema: {},
    modulePath: './pages.js',
    handlerName: 'selectPage',
  },
  {
    name: 'new_page',
    description: '新建页面',
    schema: {},
    modulePath: './pages.js',
    handlerName: 'newPage',
  },
  {
    name: 'screenshot',
    description: '截图',
    schema: {},
    modulePath: './screenshot.js',
    handlerName: 'screenshot',
  },
  {
    name: 'capture_video_frame',
    description: '捕获视频帧',
    schema: {},
    modulePath: './screenshot.js',
    handlerName: 'captureVideoFrame',
  },
  {
    name: 'emulate_mobile',
    description: '模拟移动设备',
    schema: {},
    modulePath: './emulation.js',
    handlerName: 'emulateMobile',
  },
  {
    name: 'emulate_network',
    description: '模拟网络',
    schema: {},
    modulePath: './emulation.js',
    handlerName: 'emulateNetwork',
  },
  {
    name: 'emulate_cpu',
    description: '模拟 CPU',
    schema: {},
    modulePath: './emulation.js',
    handlerName: 'emulateCpu',
  },
  {
    name: 'resize_page',
    description: '调整页面大小',
    schema: {},
    modulePath: './emulation.js',
    handlerName: 'resizePage',
  },
  {
    name: 'start_performance_trace',
    description: '开始性能追踪',
    schema: {},
    modulePath: './performance.js',
    handlerName: 'startPerformanceTrace',
  },
  {
    name: 'stop_performance_trace',
    description: '停止性能追踪',
    schema: {},
    modulePath: './performance.js',
    handlerName: 'stopPerformanceTrace',
  },
  {
    name: 'get_performance_metrics',
    description: '获取性能指标',
    schema: {},
    modulePath: './performance.js',
    handlerName: 'getPerformanceMetrics',
  },
  {
    name: 'performance_analyze_insight',
    description: '分析性能洞察',
    schema: {},
    modulePath: './performance.js',
    handlerName: 'performanceAnalyzeInsight',
  },
  {
    name: 'set_breakpoint',
    description: '设置断点',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'setBreakpoint',
  },
  {
    name: 'remove_breakpoint',
    description: '移除断点',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'removeBreakpoint',
  },
  {
    name: 'list_breakpoints',
    description: '列出断点',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'listBreakpoints',
  },
  {
    name: 'step_into',
    description: '单步进入',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'stepInto',
  },
  {
    name: 'step_over',
    description: '单步跳过',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'stepOver',
  },
  {
    name: 'step_out',
    description: '单步跳出',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'stepOut',
  },
  {
    name: 'resume',
    description: '继续执行',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'resume',
  },
  {
    name: 'pause',
    description: '暂停执行',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'pause',
  },
  {
    name: 'list_scripts',
    description: '列出脚本',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'listScripts',
  },
  {
    name: 'get_script_source',
    description: '获取脚本源码',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'getScriptSource',
  },
  {
    name: 'search_in_sources',
    description: '搜索源码',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'searchInSources',
  },
  {
    name: 'get_storage',
    description: '获取存储',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'getStorage',
  },
  {
    name: 'break_on_xhr',
    description: 'XHR 断点',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'breakOnXhr',
  },
  {
    name: 'remove_xhr_breakpoint',
    description: '移除 XHR 断点',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'removeXhrBreakpoint',
  },
  {
    name: 'monitor_events',
    description: '监控事件',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'monitorEvents',
  },
  {
    name: 'stop_monitor',
    description: '停止监控',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'stopMonitor',
  },
  {
    name: 'trace_function',
    description: '追踪函数',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'traceFunction',
  },
  {
    name: 'get_ai_debug_status',
    description: '获取 AI 调试状态',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'getAiDebugStatus',
  },
  {
    name: 'inspect_object',
    description: '检查对象',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'inspectObject',
  },
  {
    name: 'list_hooks',
    description: '列出 Hook',
    schema: {},
    modulePath: './debugger.js',
    handlerName: 'listHooks',
  },
  {
    name: 'create_hook',
    description: '创建 Hook',
    schema: {},
    modulePath: './hook.js',
    handlerName: 'createHook',
  },
  {
    name: 'inject_hook',
    description: '注入 Hook',
    schema: {},
    modulePath: './hook.js',
    handlerName: 'injectHook',
  },
  {
    name: 'get_hook_data',
    description: '获取 Hook 数据',
    schema: {},
    modulePath: './hook.js',
    handlerName: 'getHookData',
  },
  {
    name: 'remove_hook',
    description: '移除 Hook',
    schema: {},
    modulePath: './hook.js',
    handlerName: 'removeHook',
  },
  {
    name: 'handle_dialog',
    description: '处理对话框',
    schema: {},
    modulePath: './dialog.js',
    handlerName: 'handleDialog',
  },
  {
    name: 'list_frames',
    description: '列出框架',
    schema: {},
    modulePath: './frames.js',
    handlerName: 'listFrames',
  },
  {
    name: 'select_frame',
    description: '选择框架',
    schema: {},
    modulePath: './frames.js',
    handlerName: 'selectFrame',
  },
  {
    name: 'evaluate_script',
    description: '执行脚本',
    schema: {},
    modulePath: './script.js',
    handlerName: 'evaluateScript',
  },
  {
    name: 'inject_preload_script',
    description: '注入预加载脚本',
    schema: {},
    modulePath: './script.js',
    handlerName: 'injectPreloadScript',
  },
  {
    name: 'search_site_experience',
    description: '搜索站点经验',
    schema: {},
    modulePath: './siteExperience.js',
    handlerName: 'searchSiteExperience',
  },
  {
    name: 'list_site_experiences',
    description: '列出站点经验',
    schema: {},
    modulePath: './siteExperience.js',
    handlerName: 'listSiteExperiences',
  },
  {
    name: 'create_site_experience',
    description: '创建站点经验',
    schema: {},
    modulePath: './siteExperience.js',
    handlerName: 'createSiteExperience',
  },
  {
    name: 'update_site_experience',
    description: '更新站点经验',
    schema: {},
    modulePath: './siteExperience.js',
    handlerName: 'updateSiteExperience',
  },
  {
    name: 'delete_site_experience',
    description: '删除站点经验',
    schema: {},
    modulePath: './siteExperience.js',
    handlerName: 'deleteSiteExperience',
  },
  {
    name: 'update_extensions',
    description: '更新扩展',
    schema: {},
    modulePath: './extensions.js',
    handlerName: 'updateExtensions',
  },
  {
    name: 'inject_stealth',
    description: '注入隐身',
    schema: {},
    modulePath: './stealth.js',
    handlerName: 'injectStealth',
  },
  {
    name: 'list_stealth_features',
    description: '列出隐身功能',
    schema: {},
    modulePath: './stealth.js',
    handlerName: 'listStealthFeatures',
  },
  {
    name: 'list_stealth_presets',
    description: '列出隐身预设',
    schema: {},
    modulePath: './stealth.js',
    handlerName: 'listStealthPresets',
  },
  {
    name: 'set_user_agent',
    description: '设置 User-Agent',
    schema: {},
    modulePath: './stealth.js',
    handlerName: 'setUserAgent',
  },
  {
    name: 'deobfuscate_code',
    description: '去混淆代码',
    schema: {},
    modulePath: './analyzer.js',
    handlerName: 'deobfuscateCode',
  },
  {
    name: 'understand_code',
    description: '理解代码',
    schema: {},
    modulePath: './analyzer.js',
    handlerName: 'understandCode',
  },
  {
    name: 'summarize_code',
    description: '总结代码',
    schema: {},
    modulePath: './analyzer.js',
    handlerName: 'summarizeCode',
  },
  {
    name: 'detect_crypto',
    description: '检测加密',
    schema: {},
    modulePath: './analyzer.js',
    handlerName: 'detectCrypto',
  },
  {
    name: 'record_reverse_evidence',
    description: '记录逆向证据',
    schema: {},
    modulePath: './analyzer.js',
    handlerName: 'recordReverseEvidence',
  },
  {
    name: 'analyze_target',
    description: '分析目标',
    schema: {},
    modulePath: './analyzer.js',
    handlerName: 'analyzeTarget',
  },
  {
    name: 'risk_panel',
    description: '风险面板',
    schema: {},
    modulePath: './analyzer.js',
    handlerName: 'riskPanel',
  },
  {
    name: 'export_session_report',
    description: '导出会话报告',
    schema: {},
    modulePath: './analyzer.js',
    handlerName: 'exportSessionReport',
  },
  {
    name: 'collect_code',
    description: '收集代码',
    schema: {},
    modulePath: './collector.js',
    handlerName: 'collectCode',
  },
  {
    name: 'collection_diff',
    description: '收集差异',
    schema: {},
    modulePath: './collector.js',
    handlerName: 'collectionDiff',
  },
  {
    name: 'search_in_scripts',
    description: '搜索脚本',
    schema: {},
    modulePath: './collector.js',
    handlerName: 'searchInScripts',
  },
  {
    name: 'export_rebuild_bundle',
    description: '导出重建包',
    schema: {},
    modulePath: './rebuild.js',
    handlerName: 'exportRebuildBundle',
  },
  {
    name: 'diff_env_requirements',
    description: '差异环境需求',
    schema: {},
    modulePath: './rebuild.js',
    handlerName: 'diffEnvRequirements',
  },
  {
    name: 'anti_anti_debug',
    description: '反反调试',
    schema: {},
    modulePath: './anti-debug/antiAntiDebug.js',
    handlerName: 'antiAntiDebug',
  },
  {
    name: 'bypass_debugger',
    description: '绕过调试',
    schema: {},
    modulePath: './anti-debug/bypassDebugger.js',
    handlerName: 'bypassDebugger',
  },
  {
    name: 'hook_crypto_js',
    description: 'Hook CryptoJS',
    schema: {},
    modulePath: './crypto/hookCryptoJS.js',
    handlerName: 'hookCryptoJS',
  },
  {
    name: 'hook_js_encrypt',
    description: 'Hook JSEncrypt',
    schema: {},
    modulePath: './crypto/hookJSEncrypt.js',
    handlerName: 'hookJSEncrypt',
  },
  {
    name: 'hook_sm_crypto',
    description: 'Hook SMCrypto',
    schema: {},
    modulePath: './crypto/hookSMCrypto.js',
    handlerName: 'hookSMCrypto',
  },
  {
    name: 'activate_vue_devtools',
    description: '激活 Vue Devtools',
    schema: {},
    modulePath: './vue/activateVueDevtools.js',
    handlerName: 'activateVueDevtools',
  },
  {
    name: 'clear_vue_guards',
    description: '清除 Vue 守卫',
    schema: {},
    modulePath: './vue/clearVueGuards.js',
    handlerName: 'clearVueGuards',
  },
  {
    name: 'get_vue_routes',
    description: '获取 Vue 路由',
    schema: {},
    modulePath: './vue/getVueRoutes.js',
    handlerName: 'getVueRoutes',
  },
  {
    name: 'start_cdp_proxy',
    description: '启动 CDP 代理',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_start_proxy',
  },
  {
    name: 'cdp_get_targets',
    description: '获取 CDP 目标',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_get_targets',
  },
  {
    name: 'cdp_new_page',
    description: 'CDP 新建页面',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_new_page',
  },
  {
    name: 'cdp_close_page',
    description: 'CDP 关闭页面',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_close_page',
  },
  {
    name: 'cdp_navigate',
    description: 'CDP 导航',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_navigate',
  },
  {
    name: 'cdp_eval',
    description: 'CDP 执行',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_eval',
  },
  {
    name: 'cdp_click',
    description: 'CDP 点击',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_click',
  },
  {
    name: 'cdp_click_at',
    description: 'CDP 点击坐标',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_click_at',
  },
  {
    name: 'cdp_screenshot',
    description: 'CDP 截图',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_screenshot',
  },
  {
    name: 'cdp_scroll',
    description: 'CDP 滚动',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_scroll',
  },
  {
    name: 'cdp_upload_files',
    description: 'CDP 上传文件',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_upload_files',
  },
  {
    name: 'cdp_page_info',
    description: 'CDP 页面信息',
    schema: {},
    modulePath: './cdp-proxy.js',
    handlerName: 'cdp_page_info',
  },
];

/**
 * 为单个工具创建 CLI 命令 - 懒加载版本
 */
function createLazyToolCommand(
  program: Command,
  tool: LazyToolDefinition,
): void {
  const cmd = program
    .command(tool.name)
    .description(tool.description || '无描述');

  // 注册 schema 参数
  if (
    tool.schema &&
    typeof tool.schema === 'object' &&
    Object.keys(tool.schema).length > 0
  ) {
    registerToolSchema(cmd, tool.schema);
  }

  // 执行动作 - 懒加载
  cmd.action(async (...args: any[]) => {
    const options = args[args.length - 2] || {};
    const positionalArgs: Record<string, unknown> = {};
    const schemaKeys = tool.schema ? Object.keys(tool.schema) : [];

    for (let i = 0; i < Math.min(args.length - 2, schemaKeys.length); i++) {
      positionalArgs[schemaKeys[i]] = args[i];
    }

    const toolArgs: Record<string, unknown> = {
      ...positionalArgs,
      ...options,
    };

    for (const [key, value] of Object.entries(toolArgs)) {
      if (typeof value === 'string' && value.includes(',')) {
        const fieldSchema = tool.schema?.[key];
        if (fieldSchema) {
          const typeName = fieldSchema.constructor.name.toLowerCase();
          if (typeName.includes('array')) {
            toolArgs[key] = value.split(',').map((s: string) => s.trim());
          }
        }
      }
    }

    try {
      const result = await sendCommand({
        method: 'invoke_tool',
        tool: tool.name,
        args: toolArgs,
      });

      const output = formatResult(result);
      console.log(output);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`工具调用失败：${errorMessage}`);
      process.exit(1);
    }
  });
}

/**
 * 为所有已注册的工具生成 CLI 命令 - 懒加载版本
 * 关键：只注册命令结构，不加载工具模块
 */
export async function generateToolCommands(program: Command): Promise<void> {
  const manualCommands = new Set([
    'start',
    'stop',
    'status',
    'call-skill',
    'call-tool',
    'list-skills',
    'list-tools',
    'repl',
    'scaffold',
  ]);

  // 检查是否是 --help 调用，如果是则跳过工具命令注册
  const isHelpOnly = process.argv
    .slice(2)
    .every(
      arg =>
        arg === '-h' || arg === '--help' || arg === '-V' || arg === '--version',
    );

  if (isHelpOnly) {
    // --help 时不注册任何工具命令，只保留核心命令
    return;
  }

  for (const tool of LAZY_TOOLS) {
    if (manualCommands.has(tool.name)) {
      continue;
    }
    createLazyToolCommand(program, tool);
  }
}
