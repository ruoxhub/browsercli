/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// 注意：此文件由脚本自动生成，不要手动编辑
// 运行 'npm run cli:generate' 更新此文件

export interface ArgDef {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: string | number | boolean | unknown[];
  enum?: ReadonlyArray<string | number>;
}

export type Commands = Record<
  string,
  {
    description: string;
    category: string;
    args: Record<string, ArgDef>;
  }
>;

export const commands: Commands = {
  activate_vue_devtools: {
    description: '激活 Vue Devtools：强制启用 Vue.js 开发者工具',
    category: '调试工具',
    args: {},
  },
  analyze_target: {
    description:
      'One-shot reverse workflow: collect code, run security/crypto analysis, optional deobfuscation, and hook timeline correlation.',
    category: '调试工具',
    args: {
      url: {
        name: 'url',
        type: 'string',
        description: '',
        required: true,
      },
      topN: {
        name: 'topN',
        type: 'integer',
        description: '',
        required: false,
      },
      useAI: {
        name: 'useAI',
        type: 'boolean',
        description: '',
        required: false,
      },
      runDeobfuscation: {
        name: 'runDeobfuscation',
        type: 'boolean',
        description: '',
        required: false,
      },
      hookPreset: {
        name: 'hookPreset',
        type: 'string',
        description: '',
        required: false,
        enum: ['none', 'api-signature', 'network-core'],
      },
      autoInjectHooks: {
        name: 'autoInjectHooks',
        type: 'boolean',
        description: '',
        required: false,
      },
      waitAfterHookMs: {
        name: 'waitAfterHookMs',
        type: 'integer',
        description: '',
        required: false,
      },
      correlationWindowMs: {
        name: 'correlationWindowMs',
        type: 'integer',
        description: '',
        required: false,
      },
      maxCorrelatedFlows: {
        name: 'maxCorrelatedFlows',
        type: 'integer',
        description: '',
        required: false,
      },
      maxFingerprints: {
        name: 'maxFingerprints',
        type: 'integer',
        description: '',
        required: false,
      },
      autoReplayActions: {
        name: 'autoReplayActions',
        type: 'array',
        description: '',
        required: false,
      },
      collect: {
        name: 'collect',
        type: 'object',
        description: '',
        required: false,
      },
    },
  },
  analyze_websocket_messages: {
    description:
      'Analyzes WebSocket messages and groups them by pattern/fingerprint. Essential for understanding binary/protobuf message types in live streaming scenarios. Returns statistics and sample indices for each message type.',
    category: '调试工具',
    args: {
      wsid: {
        name: 'wsid',
        type: 'number',
        description: 'The wsid of the WebSocket connection to analyze.',
        required: true,
      },
      direction: {
        name: 'direction',
        type: 'string',
        description: 'Only analyze messages in this direction.',
        required: false,
        enum: ['sent', 'received'],
      },
    },
  },
  anti_anti_debug: {
    description:
      '反反调试工具集：窗口尺寸/时间函数/页面关闭/历史跳转/控制台清除',
    category: '调试工具',
    args: {
      features: {
        name: 'features',
        type: 'array',
        description: '要启用的功能',
        required: true,
      },
    },
  },
  break_on_xhr: {
    description:
      'Sets a breakpoint that triggers when an XHR/Fetch request URL contains the specified string.',
    category: '调试工具',
    args: {
      url: {
        name: 'url',
        type: 'string',
        description: 'URL pattern to break on (partial match).',
        required: true,
      },
    },
  },
  bypass_debugger: {
    description:
      '绕过无限 debugger：自动移除 eval/Function/constructor 中的 debugger 关键字',
    category: '调试工具',
    args: {
      targets: {
        name: 'targets',
        type: 'array',
        description: '要 Hook 的目标，默认全部',
        required: false,
      },
    },
  },
  capture_video_frame: {
    description:
      'Capture a specific frame from a video element. Can seek to a specific time before capturing.',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS selector of the video element',
        required: true,
      },
      seekTime: {
        name: 'seekTime',
        type: 'number',
        description: 'Time in seconds to seek before capturing',
        required: false,
      },
      outputPath: {
        name: 'outputPath',
        type: 'string',
        description:
          'Output file path (optional, returns buffer if not specified)',
        required: false,
      },
      format: {
        name: 'format',
        type: 'string',
        description: '',
        required: false,
        default: 'png',
        enum: ['png', 'jpeg'],
      },
      quality: {
        name: 'quality',
        type: 'number',
        description: 'Image quality for JPEG (0-100)',
        required: false,
      },
    },
  },
  cdp_click: {
    description: '点击当前选中页面中的元素（JS click）',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS 选择器',
        required: true,
      },
    },
  },
  cdp_click_at: {
    description: '使用真实鼠标事件点击元素（可触发文件对话框等）',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS 选择器',
        required: true,
      },
    },
  },
  cdp_close_page: {
    description: '关闭指定的页面',
    category: '调试工具',
    args: {
      pageIdx: {
        name: 'pageIdx',
        type: 'number',
        description: '页面索引（从 get_targets 获取）',
        required: true,
      },
    },
  },
  cdp_eval: {
    description: '在当前选中的页面中执行 JavaScript 表达式',
    category: '调试工具',
    args: {
      expr: {
        name: 'expr',
        type: 'string',
        description: 'JavaScript 表达式',
        required: true,
      },
    },
  },
  cdp_get_targets: {
    description: '获取所有可用的页面 target 列表',
    category: '调试工具',
    args: {},
  },
  cdp_navigate: {
    description: '在当前选中的页面中导航到指定 URL',
    category: '调试工具',
    args: {
      url: {
        name: 'url',
        type: 'string',
        description: '目标 URL',
        required: true,
      },
    },
  },
  cdp_new_page: {
    description: '创建一个新的后台页面',
    category: '调试工具',
    args: {
      url: {
        name: 'url',
        type: 'string',
        description: '初始 URL，默认 about:blank',
        required: false,
      },
    },
  },
  cdp_page_info: {
    description: '获取当前选中页面的基本信息',
    category: '调试工具',
    args: {},
  },
  cdp_screenshot: {
    description: '对当前选中的页面截图',
    category: '调试工具',
    args: {
      file: {
        name: 'file',
        type: 'string',
        description: '保存文件路径，不指定则返回数据',
        required: false,
      },
      type: {
        name: 'type',
        type: 'string',
        description: '图片类型，默认 png',
        required: false,
        enum: ['png', 'jpeg', 'webp'],
      },
      fullPage: {
        name: 'fullPage',
        type: 'boolean',
        description: '是否截取整个页面，默认 false',
        required: false,
      },
    },
  },
  cdp_scroll: {
    description: '滚动当前选中的页面',
    category: '调试工具',
    args: {
      y: {
        name: 'y',
        type: 'number',
        description: '滚动距离，默认 3000',
        required: false,
      },
      direction: {
        name: 'direction',
        type: 'string',
        description: '滚动方向，默认 down',
        required: false,
        enum: ['down', 'up', 'top', 'bottom'],
      },
    },
  },
  cdp_start_proxy: {
    description:
      '启动 CDP Proxy HTTP 服务器，允许通过 HTTP API 操控浏览器。代理运行在 localhost:3456。',
    category: '调试工具',
    args: {
      port: {
        name: 'port',
        type: 'number',
        description: 'HTTP 端口，默认 3456',
        required: false,
      },
    },
  },
  cdp_upload_files: {
    description: '向文件输入框上传文件',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: '文件输入框的 CSS 选择器',
        required: true,
      },
      files: {
        name: 'files',
        type: 'array',
        description: '本地文件路径列表',
        required: true,
      },
    },
  },
  check_browser_health: {
    description:
      'Check browser connectivity and active page readiness before running reverse workflows.',
    category: '调试工具',
    args: {},
  },
  clear_vue_guards: {
    description: '清除 Vue Router 全局守卫：beforeEach、beforeResolve',
    category: '调试工具',
    args: {
      guards: {
        name: 'guards',
        type: 'array',
        description: '要清除的守卫，默认全部',
        required: false,
      },
    },
  },
  click: {
    description: 'Clicks on the provided element identified by CSS selector',
    category: '输入自动化',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS selector of the element to click',
        required: true,
      },
      dblClick: {
        name: 'dblClick',
        type: 'boolean',
        description: 'Set to true for double clicks. Default is false.',
        required: false,
      },
    },
  },
  click_at: {
    description:
      'Real mouse click using CDP Input.dispatchMouseEvent. Acts as user gesture, can trigger file dialogs and bypass some anti-automation detection.',
    category: '输入自动化',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS selector of the element to click',
        required: true,
      },
    },
  },
  click_element: {
    description: 'Click an element by selector.',
    category: '输入自动化',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: '',
        required: true,
      },
    },
  },
  collect_code: {
    description:
      'Collect JavaScript code from a page with smart modes (summary/priority/incremental/full).',
    category: '调试工具',
    args: {
      url: {
        name: 'url',
        type: 'string',
        description: '',
        required: true,
      },
      smartMode: {
        name: 'smartMode',
        type: 'string',
        description: '',
        required: false,
        enum: ['summary', 'priority', 'incremental', 'full'],
      },
      returnMode: {
        name: 'returnMode',
        type: 'string',
        description: '',
        required: false,
        enum: ['full', 'summary', 'pattern', 'top-priority'],
      },
      includeInline: {
        name: 'includeInline',
        type: 'boolean',
        description: '',
        required: false,
      },
      includeExternal: {
        name: 'includeExternal',
        type: 'boolean',
        description: '',
        required: false,
      },
      includeDynamic: {
        name: 'includeDynamic',
        type: 'boolean',
        description: '',
        required: false,
      },
      maxTotalSize: {
        name: 'maxTotalSize',
        type: 'integer',
        description: '',
        required: false,
      },
      maxFileSize: {
        name: 'maxFileSize',
        type: 'integer',
        description: '',
        required: false,
      },
      pattern: {
        name: 'pattern',
        type: 'string',
        description: '',
        required: false,
      },
      limit: {
        name: 'limit',
        type: 'integer',
        description: '',
        required: false,
      },
      topN: {
        name: 'topN',
        type: 'integer',
        description: '',
        required: false,
      },
    },
  },
  collection_diff: {
    description: 'Compare previous and current collected file summaries.',
    category: '调试工具',
    args: {
      previous: {
        name: 'previous',
        type: 'array',
        description: '',
        required: true,
      },
      current: {
        name: 'current',
        type: 'array',
        description: '',
        required: false,
      },
      includeUnchanged: {
        name: 'includeUnchanged',
        type: 'boolean',
        description: '',
        required: false,
      },
    },
  },
  create_hook: {
    description:
      'RECOMMENDED: Create hook script for function/fetch/xhr/property/cookie/websocket/eval/timer. Hooks run without pausing page execution and are the preferred approach over breakpoints for monitoring and interception.',
    category: '调试工具',
    args: {
      type: {
        name: 'type',
        type: 'string',
        description:
          'Hook type: function, fetch, xhr, property, cookie, websocket, eval, timer',
        required: true,
      },
      params: {
        name: 'params',
        type: 'object',
        description: 'Hook parameters (e.g., target function name)',
        required: false,
      },
      description: {
        name: 'description',
        type: 'string',
        description: 'Optional description for the hook',
        required: false,
      },
      action: {
        name: 'action',
        type: 'string',
        description:
          'Hook action: log (default), block, modify, or passthrough',
        required: false,
        enum: ['log', 'block', 'modify', 'passthrough'],
      },
    },
  },
  create_site_experience: {
    description: '创建新的站点经验记录',
    category: '调试工具',
    args: {
      domain: {
        name: 'domain',
        type: 'string',
        description: '站点域名（例如：example.com）',
        required: true,
      },
      name: {
        name: 'name',
        type: 'string',
        description: '站点名称',
        required: true,
      },
      aliases: {
        name: 'aliases',
        type: 'array',
        description: '站点别名列表',
        required: false,
      },
      platformFeatures: {
        name: 'platformFeatures',
        type: 'string',
        description: '平台特征描述',
        required: false,
      },
      validPatterns: {
        name: 'validPatterns',
        type: 'string',
        description: '有效模式描述',
        required: false,
      },
      knownPitfalls: {
        name: 'knownPitfalls',
        type: 'string',
        description: '已知陷阱描述',
        required: false,
      },
    },
  },
  delete_session_state: {
    description: 'Delete one in-memory session snapshot by sessionId.',
    category: '调试工具',
    args: {
      sessionId: {
        name: 'sessionId',
        type: 'string',
        description: '',
        required: true,
      },
    },
  },
  delete_site_experience: {
    description: '删除站点经验记录',
    category: '调试工具',
    args: {
      id: {
        name: 'id',
        type: 'number',
        description: '要删除的站点经验 ID',
        required: true,
      },
    },
  },
  deobfuscate_code: {
    description: 'AI-assisted JavaScript deobfuscation.',
    category: '调试工具',
    args: {
      code: {
        name: 'code',
        type: 'string',
        description: '',
        required: true,
      },
      aggressive: {
        name: 'aggressive',
        type: 'boolean',
        description: '',
        required: false,
      },
      renameVariables: {
        name: 'renameVariables',
        type: 'boolean',
        description: '',
        required: false,
      },
    },
  },
  detect_crypto: {
    description:
      'Detect cryptographic algorithms/libraries from JavaScript source.',
    category: '调试工具',
    args: {
      code: {
        name: 'code',
        type: 'string',
        description: '',
        required: true,
      },
      useAI: {
        name: 'useAI',
        type: 'boolean',
        description: '',
        required: false,
      },
    },
  },
  diff_env_requirements: {
    description:
      'Compare local runtime failures with observed browser capabilities and suggest the next environment patches.',
    category: '调试工具',
    args: {
      runtimeError: {
        name: 'runtimeError',
        type: 'string',
        description: '',
        required: true,
      },
      observedCapabilities: {
        name: 'observedCapabilities',
        type: 'array',
        description: '',
        required: false,
        default: [],
      },
    },
  },
  drag: {
    description: 'Drag an element onto another element',
    category: '调试工具',
    args: {
      fromSelector: {
        name: 'fromSelector',
        type: 'string',
        description: 'CSS selector of the element to drag',
        required: true,
      },
      toSelector: {
        name: 'toSelector',
        type: 'string',
        description: 'CSS selector of the element to drop into',
        required: true,
      },
    },
  },
  dump_session_state: {
    description:
      'Export a saved session snapshot as JSON, optionally writing to a file.',
    category: '调试工具',
    args: {
      sessionId: {
        name: 'sessionId',
        type: 'string',
        description: '',
        required: true,
      },
      path: {
        name: 'path',
        type: 'string',
        description: '',
        required: false,
      },
      pretty: {
        name: 'pretty',
        type: 'boolean',
        description: '',
        required: false,
      },
      encrypt: {
        name: 'encrypt',
        type: 'boolean',
        description: '',
        required: false,
      },
    },
  },
  emulate_cpu: {
    description:
      "Emulates CPU throttling by slowing down the selected page's execution. Useful for detecting race conditions and timing-dependent issues.",
    category: '模拟',
    args: {
      throttlingRate: {
        name: 'throttlingRate',
        type: 'number',
        description:
          'The CPU throttling rate representing the slowdown factor 1-20x. Set the rate to 1 to disable throttling',
        required: true,
      },
    },
  },
  emulate_mobile: {
    description:
      'Emulates mobile device viewport, user-agent, and touch events. Use this to test mobile layouts and touch interactions.',
    category: '模拟',
    args: {
      enable: {
        name: 'enable',
        type: 'boolean',
        description: 'Whether to enable or disable mobile emulation',
        required: true,
      },
      device: {
        name: 'device',
        type: 'string',
        description: 'Optional device type to emulate (default: iphone)',
        required: false,
        enum: ['iphone', 'android', 'ipad'],
      },
    },
  },
  emulate_network: {
    description:
      'Emulates network conditions such as throttling or offline mode on the selected page. Available options: No emulation, Offline, Slow 3G, Fast 3G, Slow 4G, Fast 4G',
    category: '模拟',
    args: {
      throttlingOption: {
        name: 'throttlingOption',
        type: 'string',
        description:
          'The network throttling option to emulate. Set to "No emulation" to disable. Set to "Offline" to simulate offline network conditions.',
        required: true,
        enum: [
          'No emulation',
          'Offline',
          'Slow 3G',
          'Fast 3G',
          'Slow 4G',
          'Fast 4G',
        ],
      },
    },
  },
  evaluate_on_callframe: {
    description:
      'Evaluates a JavaScript expression in the context of a specific call frame while paused. This allows you to inspect variables and execute code in the paused scope.',
    category: '调试工具',
    args: {
      expression: {
        name: 'expression',
        type: 'string',
        description: 'The JavaScript expression to evaluate.',
        required: true,
      },
      frameIndex: {
        name: 'frameIndex',
        type: 'integer',
        description:
          'The call frame index to evaluate in (0 = top frame, default: 0).',
        required: false,
        default: 0,
      },
    },
  },
  evaluate_script: {
    description:
      'Evaluate a JavaScript function inside the currently selected page. Returns the response as JSON\nso returned values have to JSON-serializable.',
    category: '调试工具',
    args: {
      function: {
        name: 'function',
        type: 'string',
        description:
          'A JavaScript function declaration to be executed by the tool in the currently selected page.\nExample without arguments: `() => {\n  return document.title\n}` or `async () => {\n  return await fetch("example.com")\n}`.\nExample with arguments: `(el) => {\n  return el.innerText;\n}`\n',
        required: true,
      },
    },
  },
  export_rebuild_bundle: {
    description:
      'Export a local Node rebuild bundle from observed reverse-engineering evidence.',
    category: '调试工具',
    args: {
      taskId: {
        name: 'taskId',
        type: 'string',
        description: '',
        required: true,
      },
      taskSlug: {
        name: 'taskSlug',
        type: 'string',
        description: '',
        required: true,
      },
      targetUrl: {
        name: 'targetUrl',
        type: 'string',
        description: '',
        required: true,
      },
      goal: {
        name: 'goal',
        type: 'string',
        description: '',
        required: true,
      },
      autoGenerate: {
        name: 'autoGenerate',
        type: 'boolean',
        description: '',
        required: false,
      },
      targetKeywords: {
        name: 'targetKeywords',
        type: 'array',
        description: '',
        required: false,
      },
      targetUrlPatterns: {
        name: 'targetUrlPatterns',
        type: 'array',
        description: '',
        required: false,
      },
      targetFunctionNames: {
        name: 'targetFunctionNames',
        type: 'array',
        description: '',
        required: false,
      },
      targetActionDescription: {
        name: 'targetActionDescription',
        type: 'string',
        description: '',
        required: false,
      },
      maxEvidenceItems: {
        name: 'maxEvidenceItems',
        type: 'integer',
        description: '',
        required: false,
      },
      entryCode: {
        name: 'entryCode',
        type: 'string',
        description: '',
        required: false,
      },
      envCode: {
        name: 'envCode',
        type: 'string',
        description: '',
        required: false,
      },
      polyfillsCode: {
        name: 'polyfillsCode',
        type: 'string',
        description: '',
        required: false,
      },
      capture: {
        name: 'capture',
        type: 'object',
        description: '',
        required: false,
      },
      notes: {
        name: 'notes',
        type: 'array',
        description: '',
        required: false,
        default: [],
      },
    },
  },
  export_session_report: {
    description:
      'Export current reverse-engineering session as JSON or Markdown.',
    category: '调试工具',
    args: {
      format: {
        name: 'format',
        type: 'string',
        description: '',
        required: false,
        default: 'json',
        enum: ['json', 'markdown'],
      },
      includeHookData: {
        name: 'includeHookData',
        type: 'boolean',
        description: '',
        required: false,
      },
    },
  },
  fill: {
    description:
      'Type text into an input, text area or select an option from a <select> element',
    category: '输入自动化',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS selector of the input/textarea/select element',
        required: true,
      },
      value: {
        name: 'value',
        type: 'string',
        description: 'The value to fill in',
        required: true,
      },
    },
  },
  find_clickable_elements: {
    description: 'Find clickable buttons/links, optionally filtered by text.',
    category: '调试工具',
    args: {
      filterText: {
        name: 'filterText',
        type: 'string',
        description: '',
        required: false,
      },
    },
  },
  find_in_script: {
    description:
      'Finds a string in a specific script and returns its exact line/column position with surrounding context. Ideal for setting breakpoints in minified files where the entire code is on one line.',
    category: '调试工具',
    args: {
      scriptId: {
        name: 'scriptId',
        type: 'string',
        description: 'The script ID to search in (from list_scripts).',
        required: true,
      },
      query: {
        name: 'query',
        type: 'string',
        description: 'The string to find in the script.',
        required: true,
      },
      contextChars: {
        name: 'contextChars',
        type: 'integer',
        description:
          'Number of characters to show before and after the match (default: 100).',
        required: false,
        default: 100,
      },
      occurrence: {
        name: 'occurrence',
        type: 'integer',
        description: 'Which occurrence to find (1 = first, 2 = second, etc.).',
        required: false,
        default: 1,
      },
      caseSensitive: {
        name: 'caseSensitive',
        type: 'boolean',
        description: 'Whether the search is case-sensitive (default: true).',
        required: false,
        default: true,
      },
    },
  },
  get_ai_debug_status: {
    description: '获取当前 AI 调试会话的状态和统计信息。',
    category: '调试工具',
    args: {},
  },
  get_console_message: {
    description:
      'Gets a console message by its ID. You can get all messages by calling list_console_messages.',
    category: '调试工具',
    args: {
      msgid: {
        name: 'msgid',
        type: 'number',
        description:
          'The msgid of a console message on the page from the listed console messages',
        required: true,
      },
    },
  },
  get_dom_structure: {
    description: 'Get DOM tree structure for current page.',
    category: '调试工具',
    args: {
      maxDepth: {
        name: 'maxDepth',
        type: 'integer',
        description: '',
        required: false,
      },
      includeText: {
        name: 'includeText',
        type: 'boolean',
        description: '',
        required: false,
      },
    },
  },
  get_hook_data: {
    description:
      'Get captured data for one hook or all hooks. Supports raw view and summary view for noise reduction.',
    category: '调试工具',
    args: {
      hookId: {
        name: 'hookId',
        type: 'string',
        description:
          'Optional hook ID. If omitted, returns data for all hooks.',
        required: false,
      },
      view: {
        name: 'view',
        type: 'string',
        description:
          'View mode: raw (all records) or summary (deduplicated with counts). Default: raw',
        required: false,
        enum: ['raw', 'summary'],
      },
      maxRecords: {
        name: 'maxRecords',
        type: 'integer',
        description: 'Maximum records to return in summary mode. Default: 100',
        required: false,
      },
    },
  },
  get_network_request: {
    description:
      'Gets a network request by an optional reqid, if omitted returns the currently selected request in the DevTools Network panel.',
    category: '网络监控',
    args: {
      reqid: {
        name: 'reqid',
        type: 'number',
        description:
          'The reqid of the network request. If omitted returns the currently selected request in the DevTools Network panel.',
        required: false,
      },
    },
  },
  get_paused_info: {
    description:
      'Gets information about the current paused state including call stack, current location, and scope variables. Use this after a breakpoint is hit to understand the execution context.',
    category: '调试工具',
    args: {
      includeScopes: {
        name: 'includeScopes',
        type: 'boolean',
        description: 'Whether to include scope variables (default: true).',
        required: false,
        default: true,
      },
      maxScopeDepth: {
        name: 'maxScopeDepth',
        type: 'integer',
        description: 'Maximum scope depth to traverse (default: 2).',
        required: false,
        default: 2,
      },
    },
  },
  get_performance_metrics: {
    description:
      'Gets page performance metrics from the Performance API, including navigation timing, resource timing, and paint events.',
    category: '调试工具',
    args: {},
  },
  get_request_initiator: {
    description:
      'Gets the JavaScript call stack that initiated a network request. This helps trace which code triggered an API call.',
    category: '调试工具',
    args: {
      requestId: {
        name: 'requestId',
        type: 'integer',
        description:
          'The request ID (from list_network_requests) to get the initiator for.',
        required: true,
      },
      taskId: {
        name: 'taskId',
        type: 'string',
        description:
          'Optional reverse task ID for writing durable evidence artifacts.',
        required: false,
      },
      taskSlug: {
        name: 'taskSlug',
        type: 'string',
        description:
          'Optional reverse task slug used when opening the task artifact directory.',
        required: false,
      },
      targetUrl: {
        name: 'targetUrl',
        type: 'string',
        description:
          'Optional target page URL associated with the reverse task.',
        required: false,
      },
      goal: {
        name: 'goal',
        type: 'string',
        description: 'Optional reverse-engineering goal for the task artifact.',
        required: false,
      },
    },
  },
  get_script_source: {
    description:
      'Gets the source code of a JavaScript script by its script ID. Supports line range (for normal files) or character offset (for minified single-line files). Use list_scripts first to find the script ID.',
    category: '调试工具',
    args: {
      scriptId: {
        name: 'scriptId',
        type: 'string',
        description:
          'The script ID (from list_scripts) to get the source code for.',
        required: true,
      },
      startLine: {
        name: 'startLine',
        type: 'integer',
        description: 'Start line number (1-based). Use for multi-line files.',
        required: false,
      },
      endLine: {
        name: 'endLine',
        type: 'integer',
        description: 'End line number (1-based). Use for multi-line files.',
        required: false,
      },
      offset: {
        name: 'offset',
        type: 'integer',
        description:
          'Character offset to start from (0-based). Use for minified single-line files.',
        required: false,
      },
      length: {
        name: 'length',
        type: 'integer',
        description:
          'Number of characters to return when using offset (default: 1000).',
        required: false,
        default: 1000,
      },
    },
  },
  get_storage: {
    description:
      'Gets browser storage data including cookies, localStorage, and sessionStorage.',
    category: '调试工具',
    args: {
      type: {
        name: 'type',
        type: 'string',
        description: 'Which storage to retrieve (default: all).',
        required: false,
        default: 'all',
        enum: ['all', 'cookies', 'localStorage', 'sessionStorage'],
      },
      filter: {
        name: 'filter',
        type: 'string',
        description: 'Optional filter string to match against keys/names.',
        required: false,
      },
    },
  },
  get_video_info: {
    description:
      'Get HTMLVideoElement info including duration, currentTime, paused state, and src.',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS selector of the video element',
        required: true,
      },
    },
  },
  get_vue_routes: {
    description: '获取 Vue Router 路由表：已加载的路由配置信息',
    category: '调试工具',
    args: {
      includeChildren: {
        name: 'includeChildren',
        type: 'boolean',
        description: '是否包含子路由',
        required: false,
        default: true,
      },
      maxDepth: {
        name: 'maxDepth',
        type: 'integer',
        description: '最大递归深度',
        required: false,
        default: 3,
      },
    },
  },
  get_websocket_message: {
    description:
      'Gets a single WebSocket message by its frame index. Use get_websocket_messages or analyze_websocket_messages first to find the frame index.',
    category: '调试工具',
    args: {
      wsid: {
        name: 'wsid',
        type: 'number',
        description: 'The wsid of the WebSocket connection.',
        required: true,
      },
      frameIndex: {
        name: 'frameIndex',
        type: 'integer',
        description: 'The frame index (0-based) to retrieve.',
        required: true,
      },
    },
  },
  get_websocket_messages: {
    description:
      'Gets messages for a WebSocket connection. IMPORTANT: For binary/protobuf messages (like live streaming), use analyze_websocket_messages FIRST to understand message types, then use groupId parameter to filter specific types. Default mode shows summary only.',
    category: '调试工具',
    args: {
      wsid: {
        name: 'wsid',
        type: 'number',
        description: 'The wsid of the WebSocket connection.',
        required: true,
      },
      direction: {
        name: 'direction',
        type: 'string',
        description: 'Filter by direction: "sent" or "received".',
        required: false,
        enum: ['sent', 'received'],
      },
      groupId: {
        name: 'groupId',
        type: 'string',
        description:
          'Filter by group ID (A, B, C, ...). Get group IDs from analyze_websocket_messages first.',
        required: false,
      },
      pageSize: {
        name: 'pageSize',
        type: 'integer',
        description: 'Messages per page. Defaults to 10.',
        required: false,
        default: 10,
      },
      pageIdx: {
        name: 'pageIdx',
        type: 'integer',
        description: 'Page number (0-based).',
        required: false,
      },
      show_content: {
        name: 'show_content',
        type: 'boolean',
        description:
          'Set to true to show full message payload. Default false (summary only) to avoid large binary output.',
        required: false,
        default: false,
      },
    },
  },
  handle_dialog: {
    description:
      'If a browser dialog was opened (alert, confirm, prompt), use this command to handle it. Accepts or dismisses the dialog.',
    category: '调试工具',
    args: {
      action: {
        name: 'action',
        type: 'string',
        description: 'Whether to dismiss or accept the dialog',
        required: true,
        enum: ['accept', 'dismiss'],
      },
      promptText: {
        name: 'promptText',
        type: 'string',
        description:
          'Optional prompt text to enter into the dialog (for prompt dialogs)',
        required: false,
      },
    },
  },
  hook_cryptojs: {
    description:
      'Hook CryptoJS 加密库：AES、DES、MD5、SHA 等对称/哈希/HMAC 算法',
    category: '逆向工程',
    args: {
      algorithms: {
        name: 'algorithms',
        type: 'array',
        description: '要 Hook 的算法，默认全部',
        required: false,
      },
      logFormat: {
        name: 'logFormat',
        type: 'string',
        description: '日志输出格式',
        required: false,
        default: 'compact',
        enum: ['full', 'compact', 'json'],
      },
    },
  },
  hook_function: {
    description:
      'RECOMMENDED for reverse engineering: Hooks a JavaScript function to log its calls, arguments, and return values without pausing execution. More reliable than breakpoints for automated workflows. Use this as the default approach for monitoring functions.',
    category: '逆向工程',
    args: {
      target: {
        name: 'target',
        type: 'string',
        description:
          'The function to hook. Can be: global function name ("fetch"), object method ("XMLHttpRequest.prototype.open"), or path ("window.app.api.request").',
        required: true,
      },
      logArgs: {
        name: 'logArgs',
        type: 'boolean',
        description: 'Whether to log function arguments (default: true).',
        required: false,
        default: true,
      },
      logResult: {
        name: 'logResult',
        type: 'boolean',
        description: 'Whether to log return value (default: true).',
        required: false,
        default: true,
      },
      logStack: {
        name: 'logStack',
        type: 'boolean',
        description: 'Whether to log call stack (default: false).',
        required: false,
        default: false,
      },
      hookId: {
        name: 'hookId',
        type: 'string',
        description:
          'Custom identifier for this hook. Used to unhook later. Defaults to target name.',
        required: false,
      },
    },
  },
  hook_jsencrypt: {
    description: 'Hook JSEncrypt RSA 加密库：公钥/私钥、原始数据、密文',
    category: '逆向工程',
    args: {
      logFormat: {
        name: 'logFormat',
        type: 'string',
        description: '日志输出格式',
        required: false,
        default: 'compact',
        enum: ['full', 'compact', 'json'],
      },
    },
  },
  hook_smcrypto: {
    description: 'Hook SM-crypto 国密库：SM2、SM3、SM4 算法',
    category: '逆向工程',
    args: {
      algorithms: {
        name: 'algorithms',
        type: 'array',
        description: '要 Hook 的算法，默认全部',
        required: false,
      },
      logFormat: {
        name: 'logFormat',
        type: 'string',
        description: '日志输出格式',
        required: false,
        default: 'compact',
        enum: ['full', 'compact', 'json'],
      },
    },
  },
  hover: {
    description: 'Hover over the provided element identified by CSS selector',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS selector of the element to hover over',
        required: true,
      },
    },
  },
  inject_hook: {
    description: 'Inject an existing hook into the current page.',
    category: '调试工具',
    args: {
      hookId: {
        name: 'hookId',
        type: 'string',
        description: 'The hook ID to inject (from create_hook response)',
        required: true,
      },
    },
  },
  inject_preload_script: {
    description:
      'Register a JavaScript snippet that will run on future document loads before page scripts execute. Use this for preload hooks, environment patches, and early instrumentation.',
    category: '调试工具',
    args: {
      script: {
        name: 'script',
        type: 'string',
        description: 'JavaScript source to register for future document loads.',
        required: true,
      },
    },
  },
  inject_stealth: {
    description: 'Inject anti-detection stealth scripts to current page.',
    category: '调试工具',
    args: {
      preset: {
        name: 'preset',
        type: 'string',
        description: '',
        required: false,
        enum: [
          'windows-chrome',
          'mac-chrome',
          'mac-safari',
          'linux-chrome',
          'windows-edge',
        ],
      },
    },
  },
  inspect_object: {
    description:
      'Deeply inspects a JavaScript object, showing its properties, prototype chain, and methods. Useful for understanding object structure.',
    category: '调试工具',
    args: {
      expression: {
        name: 'expression',
        type: 'string',
        description:
          'JavaScript expression to evaluate and inspect (e.g., "window.app", "document.body", "myObject").',
        required: true,
      },
      depth: {
        name: 'depth',
        type: 'integer',
        description: 'How deep to inspect nested objects (default: 2).',
        required: false,
        default: 2,
      },
      showMethods: {
        name: 'showMethods',
        type: 'boolean',
        description: 'Whether to show methods (default: true).',
        required: false,
        default: true,
      },
      showPrototype: {
        name: 'showPrototype',
        type: 'boolean',
        description: 'Whether to show prototype chain (default: true).',
        required: false,
        default: true,
      },
    },
  },
  'invoke-skill': {
    description:
      '调用已注册的逆向工程技能（observe-flow, auto-hook, rebuild-bundle）',
    category: '调试工具',
    args: {
      skillName: {
        name: 'skillName',
        type: 'string',
        description: '技能名称：observe-flow | auto-hook | rebuild-bundle',
        required: true,
      },
      options: {
        name: 'options',
        type: 'object',
        description: '技能配置选项',
        required: false,
      },
      url: {
        name: 'url',
        type: 'string',
        description: '目标 URL（可选）',
        required: false,
      },
    },
  },
  list_breakpoints: {
    description:
      'Lists all active breakpoints in the current debugging session.',
    category: '调试工具',
    args: {},
  },
  list_console_messages: {
    description:
      'List all console messages for the currently selected page since the last navigation.',
    category: '调试工具',
    args: {
      pageSize: {
        name: 'pageSize',
        type: 'integer',
        description:
          'Maximum number of messages to return. When omitted, returns all requests.',
        required: false,
      },
      pageIdx: {
        name: 'pageIdx',
        type: 'integer',
        description:
          'Page number to return (0-based). When omitted, returns the first page.',
        required: false,
      },
      types: {
        name: 'types',
        type: 'array',
        description:
          'Filter messages to only return messages of the specified resource types. When omitted or empty, returns all messages.',
        required: false,
      },
      includePreservedMessages: {
        name: 'includePreservedMessages',
        type: 'boolean',
        description:
          'Set to true to return the preserved messages over the last 3 navigations.',
        required: false,
        default: false,
      },
    },
  },
  list_frames: {
    description:
      'Lists all frames (including iframes) in the current page as a tree. Shows frame index, name, and URL. Use select_frame to switch execution context to a specific frame.',
    category: '调试工具',
    args: {},
  },
  list_hooks: {
    description: 'Lists all active function hooks.',
    category: '调试工具',
    args: {},
  },
  list_network_requests: {
    description:
      'List all requests for the currently selected page since the last navigation.',
    category: '网络监控',
    args: {
      pageSize: {
        name: 'pageSize',
        type: 'integer',
        description:
          'Maximum number of requests to return. When omitted, returns all requests.',
        required: false,
      },
      pageIdx: {
        name: 'pageIdx',
        type: 'integer',
        description:
          'Page number to return (0-based). When omitted, returns the first page.',
        required: false,
      },
      resourceTypes: {
        name: 'resourceTypes',
        type: 'array',
        description:
          'Filter requests to only return requests of the specified resource types. When omitted or empty, returns all requests.',
        required: false,
      },
      includePreservedRequests: {
        name: 'includePreservedRequests',
        type: 'boolean',
        description:
          'Set to true to return the preserved requests over the last 3 navigations.',
        required: false,
        default: false,
      },
    },
  },
  list_pages: {
    description: 'Get a list of pages open in the browser.',
    category: '导航自动化',
    args: {},
  },
  list_scripts: {
    description:
      'Lists all JavaScript scripts loaded in the current page. Returns script ID, URL, and source map information. Use this to find scripts before setting breakpoints or searching.',
    category: '调试工具',
    args: {
      filter: {
        name: 'filter',
        type: 'string',
        description:
          'Optional filter string to match against script URLs (case-insensitive partial match).',
        required: false,
      },
    },
  },
  list_session_states: {
    description: 'List all saved session snapshots in memory.',
    category: '调试工具',
    args: {},
  },
  list_site_experiences: {
    description: '列出所有已保存的站点经验',
    category: '调试工具',
    args: {},
  },
  list_stealth_features: {
    description: 'List available stealth feature toggles.',
    category: '调试工具',
    args: {},
  },
  list_stealth_presets: {
    description: 'List available stealth presets.',
    category: '调试工具',
    args: {},
  },
  list_websocket_connections: {
    description:
      'List all WebSocket connections. After getting wsid, use analyze_websocket_messages(wsid) FIRST to understand message patterns before viewing individual messages.',
    category: '调试工具',
    args: {
      pageSize: {
        name: 'pageSize',
        type: 'integer',
        description:
          'Maximum number of connections to return. When omitted, returns all connections.',
        required: false,
      },
      pageIdx: {
        name: 'pageIdx',
        type: 'integer',
        description:
          'Page number to return (0-based). When omitted, returns the first page.',
        required: false,
      },
      urlFilter: {
        name: 'urlFilter',
        type: 'string',
        description:
          'Filter connections by URL. Only connections containing this substring will be returned.',
        required: false,
      },
      includePreservedConnections: {
        name: 'includePreservedConnections',
        type: 'boolean',
        description:
          'Set to true to return the preserved connections over the last 3 navigations.',
        required: false,
        default: false,
      },
    },
  },
  'list-skills': {
    description: '列出所有可用的逆向工程技能',
    category: '调试工具',
    args: {},
  },
  load_session_state: {
    description:
      'Load a session snapshot from JSON string or file into memory.',
    category: '调试工具',
    args: {
      sessionId: {
        name: 'sessionId',
        type: 'string',
        description: '',
        required: false,
      },
      path: {
        name: 'path',
        type: 'string',
        description: '',
        required: false,
      },
      snapshotJson: {
        name: 'snapshotJson',
        type: 'string',
        description: '',
        required: false,
      },
      overwrite: {
        name: 'overwrite',
        type: 'boolean',
        description: '',
        required: false,
      },
    },
  },
  monitor_events: {
    description:
      'Monitors DOM events on a specified element or window. Events will be logged to console.',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description:
          'CSS selector for element to monitor, or "window"/"document" (default: window).',
        required: false,
        default: 'window',
      },
      events: {
        name: 'events',
        type: 'array',
        description:
          'Specific events to monitor (e.g., ["click", "keydown"]). If not specified, monitors common events.',
        required: false,
      },
      monitorId: {
        name: 'monitorId',
        type: 'string',
        description:
          'Custom ID for this monitor. Used to stop monitoring later.',
        required: false,
      },
      taskId: {
        name: 'taskId',
        type: 'string',
        description:
          'Optional reverse task ID for writing durable evidence artifacts.',
        required: false,
      },
      taskSlug: {
        name: 'taskSlug',
        type: 'string',
        description:
          'Optional reverse task slug used when opening the task artifact directory.',
        required: false,
      },
      targetUrl: {
        name: 'targetUrl',
        type: 'string',
        description:
          'Optional target page URL associated with the reverse task.',
        required: false,
      },
      goal: {
        name: 'goal',
        type: 'string',
        description: 'Optional reverse-engineering goal for the task artifact.',
        required: false,
      },
    },
  },
  navigate_page: {
    description:
      'Navigates the currently selected page to a URL, or performs back/forward/reload navigation. Waits for DOMContentLoaded event (not full page load). Default timeout is 10 seconds.',
    category: '导航自动化',
    args: {
      type: {
        name: 'type',
        type: 'string',
        description:
          'Navigate the page by URL, back or forward in history, or reload.',
        required: false,
        enum: ['url', 'back', 'forward', 'reload'],
      },
      url: {
        name: 'url',
        type: 'string',
        description: 'Target URL (only type=url)',
        required: false,
      },
      ignoreCache: {
        name: 'ignoreCache',
        type: 'boolean',
        description: 'Whether to ignore cache on reload.',
        required: false,
      },
      timeout: {
        name: 'timeout',
        type: 'integer',
        description:
          'Maximum wait time in milliseconds. If set to 0, the default timeout will be used.',
        required: false,
      },
    },
  },
  new_page: {
    description:
      'Creates a new page and navigates to the specified URL. Waits for DOMContentLoaded event (not full page load). Default timeout is 10 seconds.',
    category: '调试工具',
    args: {
      url: {
        name: 'url',
        type: 'string',
        description: 'URL to load in a new page.',
        required: true,
      },
      timeout: {
        name: 'timeout',
        type: 'integer',
        description:
          'Maximum wait time in milliseconds. If set to 0, the default timeout will be used.',
        required: false,
      },
    },
  },
  pause: {
    description:
      'Pauses JavaScript execution at the current point. Use this to interrupt running code.',
    category: '调试工具',
    args: {},
  },
  performance_analyze_insight: {
    description:
      'Provides more detailed information on a specific Performance Insight that was highlighted in the results of a trace recording.',
    category: '性能分析',
    args: {
      insightName: {
        name: 'insightName',
        type: 'string',
        description:
          'The name of the Insight you want more information on. For example: "DocumentLatency" or "LCPBreakdown"',
        required: true,
      },
    },
  },
  press_key: {
    description:
      'Press a key or key combination. Use this when other input methods like fill() cannot be used (e.g., keyboard shortcuts, navigation keys, or special key combinations).',
    category: '输入自动化',
    args: {
      key: {
        name: 'key',
        type: 'string',
        description:
          'A key or a combination (e.g., "Enter", "Control+A", "Control++", "Control+Shift+R"). Modifiers: Control, Shift, Alt, Meta',
        required: true,
      },
    },
  },
  query_dom: {
    description: 'Query one or multiple elements by CSS selector.',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: '',
        required: true,
      },
      all: {
        name: 'all',
        type: 'boolean',
        description: '',
        required: false,
      },
      limit: {
        name: 'limit',
        type: 'integer',
        description: '',
        required: false,
      },
    },
  },
  record_reverse_evidence: {
    description:
      'Append structured reverse-engineering evidence to a task artifact log.',
    category: '调试工具',
    args: {
      taskId: {
        name: 'taskId',
        type: 'string',
        description: '',
        required: true,
      },
      taskSlug: {
        name: 'taskSlug',
        type: 'string',
        description: '',
        required: true,
      },
      targetUrl: {
        name: 'targetUrl',
        type: 'string',
        description: '',
        required: true,
      },
      goal: {
        name: 'goal',
        type: 'string',
        description: '',
        required: true,
      },
      channel: {
        name: 'channel',
        type: 'string',
        description: '',
        required: false,
        default: 'runtime-evidence',
      },
      targetKeywords: {
        name: 'targetKeywords',
        type: 'array',
        description: '',
        required: false,
      },
      targetUrlPatterns: {
        name: 'targetUrlPatterns',
        type: 'array',
        description: '',
        required: false,
      },
      targetFunctionNames: {
        name: 'targetFunctionNames',
        type: 'array',
        description: '',
        required: false,
      },
      targetActionDescription: {
        name: 'targetActionDescription',
        type: 'string',
        description: '',
        required: false,
      },
      entry: {
        name: 'entry',
        type: 'object',
        description: '',
        required: true,
      },
    },
  },
  remove_breakpoint: {
    description:
      'Removes a breakpoint by its ID. Use list_breakpoints to see active breakpoints.',
    category: '调试工具',
    args: {
      breakpointId: {
        name: 'breakpointId',
        type: 'string',
        description:
          'The breakpoint ID to remove (from list_breakpoints or set_breakpoint).',
        required: true,
      },
    },
  },
  remove_hook: {
    description: 'Remove a hook by id.',
    category: '调试工具',
    args: {
      hookId: {
        name: 'hookId',
        type: 'string',
        description: 'The hook ID to remove',
        required: true,
      },
    },
  },
  remove_xhr_breakpoint: {
    description: 'Removes an XHR/Fetch breakpoint.',
    category: '调试工具',
    args: {
      url: {
        name: 'url',
        type: 'string',
        description: 'The URL pattern to remove breakpoint for.',
        required: true,
      },
    },
  },
  resize_page: {
    description:
      'Resizes the browser window so that the page has specified dimensions. Useful for testing responsive layouts and mobile views.',
    category: '模拟',
    args: {
      width: {
        name: 'width',
        type: 'number',
        description: 'Page width in pixels',
        required: true,
      },
      height: {
        name: 'height',
        type: 'number',
        description: 'Page height in pixels',
        required: true,
      },
    },
  },
  restore_session_state: {
    description: 'Restore a previously saved session snapshot to current page.',
    category: '调试工具',
    args: {
      sessionId: {
        name: 'sessionId',
        type: 'string',
        description: '',
        required: true,
      },
      navigateToSavedUrl: {
        name: 'navigateToSavedUrl',
        type: 'boolean',
        description: '',
        required: false,
      },
      clearStorageBeforeRestore: {
        name: 'clearStorageBeforeRestore',
        type: 'boolean',
        description: '',
        required: false,
      },
    },
  },
  resume: {
    description:
      'Resumes JavaScript execution after being paused at a breakpoint. Execution continues until the next breakpoint or completion.',
    category: '调试工具',
    args: {},
  },
  risk_panel: {
    description:
      'Build a combined risk score from analyzer, crypto detector and hook signals.',
    category: '调试工具',
    args: {
      code: {
        name: 'code',
        type: 'string',
        description: '',
        required: false,
      },
      useAI: {
        name: 'useAI',
        type: 'boolean',
        description: '',
        required: false,
      },
      includeHookSignals: {
        name: 'includeHookSignals',
        type: 'boolean',
        description: '',
        required: false,
      },
      hookId: {
        name: 'hookId',
        type: 'string',
        description: '',
        required: false,
      },
      topN: {
        name: 'topN',
        type: 'integer',
        description: '',
        required: false,
      },
    },
  },
  save_session_state: {
    description:
      'Save current page session state (cookies/localStorage/sessionStorage) into in-memory snapshot.',
    category: '调试工具',
    args: {
      sessionId: {
        name: 'sessionId',
        type: 'string',
        description: '',
        required: false,
      },
      includeCookies: {
        name: 'includeCookies',
        type: 'boolean',
        description: '',
        required: false,
      },
      includeLocalStorage: {
        name: 'includeLocalStorage',
        type: 'boolean',
        description: '',
        required: false,
      },
      includeSessionStorage: {
        name: 'includeSessionStorage',
        type: 'boolean',
        description: '',
        required: false,
      },
    },
  },
  scroll_by: {
    description:
      'Scroll page by direction (up/down/top/bottom). Automatically waits 800ms for lazy-loaded content to load.',
    category: '调试工具',
    args: {
      direction: {
        name: 'direction',
        type: 'string',
        description: 'Scroll direction',
        required: true,
        enum: ['up', 'down', 'top', 'bottom'],
      },
      pixels: {
        name: 'pixels',
        type: 'integer',
        description: 'Pixels to scroll (only for up/down, default: 1000)',
        required: false,
      },
    },
  },
  search_in_scripts: {
    description: 'Search in collected script cache with regex pattern.',
    category: '调试工具',
    args: {
      pattern: {
        name: 'pattern',
        type: 'string',
        description: '',
        required: true,
      },
      limit: {
        name: 'limit',
        type: 'integer',
        description: '',
        required: false,
      },
      maxTotalSize: {
        name: 'maxTotalSize',
        type: 'integer',
        description: '',
        required: false,
      },
    },
  },
  search_in_sources: {
    description:
      'Searches for a string or regex pattern in all loaded JavaScript sources. Returns matching lines with script ID, URL, and line number. Use get_script_source with startLine/endLine to view full context around matches.',
    category: '调试工具',
    args: {
      query: {
        name: 'query',
        type: 'string',
        description: 'The search query (string or regex pattern).',
        required: true,
      },
      caseSensitive: {
        name: 'caseSensitive',
        type: 'boolean',
        description: 'Whether the search should be case-sensitive.',
        required: false,
        default: false,
      },
      isRegex: {
        name: 'isRegex',
        type: 'boolean',
        description: 'Whether to treat the query as a regular expression.',
        required: false,
        default: false,
      },
      maxResults: {
        name: 'maxResults',
        type: 'integer',
        description: 'Maximum number of results to return (default: 30).',
        required: false,
        default: 30,
      },
      maxLineLength: {
        name: 'maxLineLength',
        type: 'integer',
        description:
          'Maximum characters per line preview (default: 150). Set to 0 for full lines.',
        required: false,
        default: 150,
      },
      excludeMinified: {
        name: 'excludeMinified',
        type: 'boolean',
        description:
          'Skip minified files (files with very long lines). Default: true.',
        required: false,
        default: true,
      },
      urlFilter: {
        name: 'urlFilter',
        type: 'string',
        description:
          'Only search scripts whose URL contains this string (case-insensitive).',
        required: false,
      },
    },
  },
  search_site_experience: {
    description:
      '按 URL 或名称搜索站点经验。支持从完整 URL 自动提取域名进行匹配。',
    category: '调试工具',
    args: {
      url: {
        name: 'url',
        type: 'string',
        description: '要搜索的 URL 或域名',
        required: false,
      },
      name: {
        name: 'name',
        type: 'string',
        description: '要搜索的站点名称',
        required: false,
      },
    },
  },
  seek_video: {
    description: 'Seek video element to specified time (in seconds).',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS selector of the video element',
        required: true,
      },
      time: {
        name: 'time',
        type: 'number',
        description: 'Time in seconds to seek to',
        required: true,
      },
    },
  },
  select_frame: {
    description:
      'Selects a frame (by index from list_frames) as the execution context for evaluate_script, hook_function, inspect_object, and other tools that run JavaScript in the page.',
    category: '调试工具',
    args: {
      frameIdx: {
        name: 'frameIdx',
        type: 'integer',
        description: 'The frame index from list_frames. 0 = main frame.',
        required: true,
      },
    },
  },
  select_page: {
    description: 'Select a page as a context for future tool calls.',
    category: '导航自动化',
    args: {
      pageIdx: {
        name: 'pageIdx',
        type: 'number',
        description:
          'The index of the page to select. Call list_pages to list pages.',
        required: true,
      },
    },
  },
  set_breakpoint: {
    description:
      'Sets a breakpoint in a JavaScript file at the specified line. The breakpoint will trigger when the code executes. NOTE: Prefer hook_function or create_hook for monitoring function calls — breakpoints require pause/resume coordination and are error-prone in automated workflows. Use breakpoints only when you need to inspect local variables inside a function.',
    category: '调试工具',
    args: {
      url: {
        name: 'url',
        type: 'string',
        description:
          'The URL of the JavaScript file (can be a partial match or regex pattern).',
        required: true,
      },
      lineNumber: {
        name: 'lineNumber',
        type: 'integer',
        description: 'The line number to set the breakpoint (1-based).',
        required: true,
      },
      columnNumber: {
        name: 'columnNumber',
        type: 'integer',
        description: 'Optional column number (0-based).',
        required: false,
        default: 0,
      },
      condition: {
        name: 'condition',
        type: 'string',
        description:
          'Optional condition expression. The breakpoint only triggers when this evaluates to true.',
        required: false,
      },
      isRegex: {
        name: 'isRegex',
        type: 'boolean',
        description: 'Whether to treat the URL as a regex pattern.',
        required: false,
        default: false,
      },
    },
  },
  set_breakpoint_on_text: {
    description:
      'Sets a breakpoint on specific code (function name, statement, etc.) by searching for it and automatically determining the exact position. Works with both normal and minified files. NOTE: Prefer hook_function for monitoring function calls — it captures args/results without pausing execution. Use this only when you need to inspect local variables at a specific code location.',
    category: '调试工具',
    args: {
      text: {
        name: 'text',
        type: 'string',
        description:
          'The code text to find and set breakpoint on (e.g., "function myFunc", "fetchData(", "apiCall").',
        required: true,
      },
      urlFilter: {
        name: 'urlFilter',
        type: 'string',
        description:
          'Only search in scripts whose URL contains this string (case-insensitive).',
        required: false,
      },
      occurrence: {
        name: 'occurrence',
        type: 'integer',
        description:
          'Which occurrence to break on (1 = first, 2 = second, etc.).',
        required: false,
        default: 1,
      },
      condition: {
        name: 'condition',
        type: 'string',
        description:
          'Optional condition expression. Breakpoint only triggers when this evaluates to true.',
        required: false,
      },
    },
  },
  set_files: {
    description:
      'Set files to a file input element using CDP DOM.setFileInputFiles. Bypasses file chooser dialog completely.',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS selector of the file input element',
        required: true,
      },
      filePaths: {
        name: 'filePaths',
        type: 'array',
        description: 'Array of absolute file paths to upload',
        required: true,
      },
    },
  },
  set_user_agent: {
    description: 'Set custom user-agent for active page.',
    category: '调试工具',
    args: {
      userAgent: {
        name: 'userAgent',
        type: 'string',
        description: '',
        required: true,
      },
    },
  },
  start_continuous_debugging: {
    description:
      '启动 AI 辅助的连续调试循环。设置 XHR 断点（可选），然后自动分析每个断点并决定下一步。',
    category: '调试工具',
    args: {
      targetUrl: {
        name: 'targetUrl',
        type: 'string',
        description: '可选：调试开始前导航到的目标 URL',
        required: false,
      },
      xhrBreakPatterns: {
        name: 'xhrBreakPatterns',
        type: 'array',
        description: '可选：XHR 断点 URL 模式列表',
        required: false,
      },
      maxIterations: {
        name: 'maxIterations',
        type: 'integer',
        description: '最大迭代次数',
        required: false,
        default: 50,
      },
      timeoutMs: {
        name: 'timeoutMs',
        type: 'integer',
        description: '超时时间 (毫秒，默认 5 分钟)',
        required: false,
        default: 300000,
      },
      aiProvider: {
        name: 'aiProvider',
        type: 'string',
        description: 'AI 提供商',
        required: false,
        enum: ['openai', 'anthropic', 'gemini'],
      },
      model: {
        name: 'model',
        type: 'string',
        description: '模型名称',
        required: false,
      },
      systemPrompt: {
        name: 'systemPrompt',
        type: 'string',
        description: '系统提示词覆盖',
        required: false,
      },
    },
  },
  start_performance_trace: {
    description:
      'Starts a performance trace recording on the selected page. This can be used to look for performance problems and insights to improve the performance of the page. It will also report Core Web Vital (CWV) scores for the page.',
    category: '调试工具',
    args: {
      reload: {
        name: 'reload',
        type: 'boolean',
        description:
          'Determines if, once tracing has started, the page should be automatically reloaded.',
        required: true,
      },
      autoStop: {
        name: 'autoStop',
        type: 'boolean',
        description:
          'Determines if the trace recording should be automatically stopped after 5 seconds.',
        required: true,
      },
    },
  },
  step_into: {
    description:
      'Steps into the next function call. Use this to enter and debug function bodies.',
    category: '调试工具',
    args: {},
  },
  step_out: {
    description:
      'Steps out of the current function, continuing until the function returns. Use this to quickly exit a function.',
    category: '调试工具',
    args: {},
  },
  step_over: {
    description:
      'Steps over to the next statement, treating function calls as a single step. Use this to move through code without entering function bodies.',
    category: '调试工具',
    args: {},
  },
  stop_continuous_debugging: {
    description: '停止正在运行的 AI 连续调试循环。',
    category: '调试工具',
    args: {},
  },
  stop_monitor: {
    description: 'Stops an event monitor.',
    category: '调试工具',
    args: {
      monitorId: {
        name: 'monitorId',
        type: 'string',
        description: 'The monitor ID to stop.',
        required: true,
      },
    },
  },
  stop_performance_trace: {
    description:
      'Stops the active performance trace recording on the selected page and analyzes the results.',
    category: '调试工具',
    args: {},
  },
  summarize_code: {
    description:
      'Summarize one code file, multiple files, or project-level context.',
    category: '调试工具',
    args: {
      mode: {
        name: 'mode',
        type: 'string',
        description: '',
        required: false,
        default: 'single',
        enum: ['single', 'batch', 'project'],
      },
      code: {
        name: 'code',
        type: 'string',
        description: '',
        required: false,
      },
      url: {
        name: 'url',
        type: 'string',
        description: '',
        required: false,
      },
      files: {
        name: 'files',
        type: 'array',
        description: '',
        required: false,
      },
    },
  },
  take_screenshot: {
    description: 'Take a screenshot of the page or element.',
    category: '调试工具',
    args: {
      format: {
        name: 'format',
        type: 'string',
        description:
          'Type of format to save the screenshot as. Default is "png"',
        required: false,
        default: 'png',
        enum: ['png', 'jpeg', 'webp'],
      },
      quality: {
        name: 'quality',
        type: 'number',
        description:
          'Compression quality for JPEG and WebP formats (0-100). Higher values mean better quality but larger file sizes. Ignored for PNG format.',
        required: false,
      },
      fullPage: {
        name: 'fullPage',
        type: 'boolean',
        description:
          'If set to true takes a screenshot of the full page instead of the currently visible viewport. Incompatible with uid.',
        required: false,
      },
      filePath: {
        name: 'filePath',
        type: 'string',
        description:
          'The absolute path, or a path relative to the current working directory, to save the screenshot to instead of attaching it to the response.',
        required: false,
      },
    },
  },
  trace_function: {
    description:
      'Traces calls to a function by its name in the source code. Works for ANY function including module-internal functions (webpack/rollup bundled). Uses "logpoints" (conditional breakpoints) to log arguments without pausing execution.',
    category: '调试工具',
    args: {
      functionName: {
        name: 'functionName',
        type: 'string',
        description:
          'The function name to trace. Will search for "function NAME" or "NAME = function" or "NAME(" patterns.',
        required: true,
      },
      urlFilter: {
        name: 'urlFilter',
        type: 'string',
        description: 'Only search in scripts matching this URL pattern.',
        required: false,
      },
      logArgs: {
        name: 'logArgs',
        type: 'boolean',
        description: 'Whether to log function arguments (default: true).',
        required: false,
        default: true,
      },
      logThis: {
        name: 'logThis',
        type: 'boolean',
        description: 'Whether to log "this" context (default: false).',
        required: false,
        default: false,
      },
      pause: {
        name: 'pause',
        type: 'boolean',
        description:
          'Whether to actually pause execution (default: false, just logs).',
        required: false,
        default: false,
      },
      traceId: {
        name: 'traceId',
        type: 'string',
        description: 'Custom ID for this trace. Used to identify in logs.',
        required: false,
      },
      taskId: {
        name: 'taskId',
        type: 'string',
        description:
          'Optional reverse task ID for writing durable evidence artifacts.',
        required: false,
      },
      taskSlug: {
        name: 'taskSlug',
        type: 'string',
        description:
          'Optional reverse task slug used when opening the task artifact directory.',
        required: false,
      },
      targetUrl: {
        name: 'targetUrl',
        type: 'string',
        description:
          'Optional target page URL associated with the reverse task.',
        required: false,
      },
      goal: {
        name: 'goal',
        type: 'string',
        description: 'Optional reverse-engineering goal for the task artifact.',
        required: false,
      },
    },
  },
  type_text: {
    description: 'Type text into an input element.',
    category: '输入自动化',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: '',
        required: true,
      },
      text: {
        name: 'text',
        type: 'string',
        description: '',
        required: true,
      },
      delay: {
        name: 'delay',
        type: 'integer',
        description: '',
        required: false,
      },
    },
  },
  understand_code: {
    description:
      'Analyze code structure/business/security with AI + static analysis.',
    category: '调试工具',
    args: {
      code: {
        name: 'code',
        type: 'string',
        description: '',
        required: true,
      },
      focus: {
        name: 'focus',
        type: 'string',
        description: '',
        required: false,
        enum: ['all', 'structure', 'business', 'security'],
      },
    },
  },
  unhook_function: {
    description: 'Removes a previously installed function hook.',
    category: '调试工具',
    args: {
      hookId: {
        name: 'hookId',
        type: 'string',
        description: 'The hook ID to remove (from hook_function).',
        required: true,
      },
    },
  },
  update_extensions: {
    description:
      'Update Chrome extensions by navigating to chrome://extensions/ and clicking the "Update now" button.',
    category: '调试工具',
    args: {},
  },
  update_site_experience: {
    description: '更新现有的站点经验记录',
    category: '调试工具',
    args: {
      id: {
        name: 'id',
        type: 'number',
        description: '要更新的站点经验 ID',
        required: true,
      },
      name: {
        name: 'name',
        type: 'string',
        description: '新的站点名称',
        required: false,
      },
      aliases: {
        name: 'aliases',
        type: 'array',
        description: '新的别名列表',
        required: false,
      },
      platformFeatures: {
        name: 'platformFeatures',
        type: 'string',
        description: '新的平台特征描述',
        required: false,
      },
      validPatterns: {
        name: 'validPatterns',
        type: 'string',
        description: '新的有效模式描述',
        required: false,
      },
      knownPitfalls: {
        name: 'knownPitfalls',
        type: 'string',
        description: '新的已知陷阱描述',
        required: false,
      },
    },
  },
  upload_file: {
    description: 'Upload a file through a file input element',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: 'CSS selector of the file input element',
        required: true,
      },
      filePath: {
        name: 'filePath',
        type: 'string',
        description: 'The absolute path of the file to upload',
        required: true,
      },
    },
  },
  wait_for_element: {
    description: 'Wait for selector to appear.',
    category: '调试工具',
    args: {
      selector: {
        name: 'selector',
        type: 'string',
        description: '',
        required: true,
      },
      timeout: {
        name: 'timeout',
        type: 'integer',
        description: '',
        required: false,
      },
    },
  },
  xhr_to_js_breakpoint: {
    description:
      '两阶段断点工作流：先通过 XHR 断点捕获调用栈，然后在顶层用户代码位置设置 JS 断点。',
    category: '调试工具',
    args: {
      urlPattern: {
        name: 'urlPattern',
        type: 'string',
        description: 'XHR 断点 URL 模式',
        required: true,
      },
      maxWaitMs: {
        name: 'maxWaitMs',
        type: 'integer',
        description: '等待 XHR 断点触发的最大时间 (毫秒)',
        required: false,
        default: 30000,
      },
    },
  },
} as const;
