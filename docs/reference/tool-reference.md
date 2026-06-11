<!-- AUTO GENERATED DO NOT EDIT - run 'npm run docs' to update-->

# Chrome DevTools MCP Tool Reference

> 快速按逆向目标查工具，请先看：[`reverse-task-index.md`](./reverse-task-index.md)

- **[Navigation automation](#navigation-automation)** (16 tools)
  - [`click`](#click)
  - [`click_at`](#click_at)
  - [`drag`](#drag)
  - [`fill`](#fill)
  - [`fill_form`](#fill_form)
  - [`find_clickable_elements`](#find_clickable_elements)
  - [`get_dom_structure`](#get_dom_structure)
  - [`hover`](#hover)
  - [`list_pages`](#list_pages)
  - [`navigate_page`](#navigate_page)
  - [`new_page`](#new_page)
  - [`press_key`](#press_key)
  - [`query_dom`](#query_dom)
  - [`select_page`](#select_page)
  - [`set_files`](#set_files)
  - [`upload_file`](#upload_file)
- **[Network](#network)** (6 tools)
  - [`analyze_websocket_messages`](#analyze_websocket_messages)
  - [`get_network_request`](#get_network_request)
  - [`get_websocket_message`](#get_websocket_message)
  - [`get_websocket_messages`](#get_websocket_messages)
  - [`list_network_requests`](#list_network_requests)
  - [`list_websocket_connections`](#list_websocket_connections)
- **[Debugging](#debugging)** (22 tools)
  - [`capture_video_frame`](#capture_video_frame)
  - [`evaluate_on_callframe`](#evaluate_on_callframe)
  - [`get_ai_debug_status`](#get_ai_debug_status)
  - [`get_console_message`](#get_console_message)
  - [`get_paused_info`](#get_paused_info)
  - [`get_video_info`](#get_video_info)
  - [`inspect_locals`](#inspect_locals)
  - [`list_breakpoints`](#list_breakpoints)
  - [`list_console_messages`](#list_console_messages)
  - [`list_frames`](#list_frames)
  - [`pause`](#pause)
  - [`remove_breakpoint`](#remove_breakpoint)
  - [`resume`](#resume)
  - [`seek_video`](#seek_video)
  - [`select_frame`](#select_frame)
  - [`set_breakpoint`](#set_breakpoint)
  - [`start_continuous_debugging`](#start_continuous_debugging)
  - [`step_into`](#step_into)
  - [`step_out`](#step_out)
  - [`step_over`](#step_over)
  - [`stop_continuous_debugging`](#stop_continuous_debugging)
  - [`take_screenshot`](#take_screenshot)
- **[JS Reverse Engineering](#js-reverse-engineering)** (84 tools)
  - [`analyze_pipeline`](#analyze_pipeline)
  - [`analyze_target`](#analyze_target)
  - [`anti_anti_debug`](#anti_anti_debug)
  - [`anti_anti_hook`](#anti_anti_hook)
  - [`auto_hook`](#auto_hook)
  - [`break_on_xhr`](#break_on_xhr)
  - [`bypass_debugger`](#bypass_debugger)
  - [`collect_code`](#collect_code)
  - [`collection_diff`](#collection_diff)
  - [`create_hook`](#create_hook)
  - [`deobfuscate_code`](#deobfuscate_code)
  - [`detect_crypto`](#detect_crypto)
  - [`diff_env_requirements`](#diff_env_requirements)
  - [`export_rebuild_bundle`](#export_rebuild_bundle)
  - [`export_session_report`](#export_session_report)
  - [`find_in_script`](#find_in_script)
  - [`fixed_window_size`](#fixed_window_size)
  - [`get_code_template`](#get_code_template)
  - [`get_hook_data`](#get_hook_data)
  - [`get_request_initiator`](#get_request_initiator)
  - [`get_script_source`](#get_script_source)
  - [`get_storage`](#get_storage)
  - [`hook_close`](#hook_close)
  - [`hook_console_clear`](#hook_console_clear)
  - [`hook_console_log`](#hook_console_log)
  - [`hook_console_protect`](#hook_console_protect)
  - [`hook_console_table`](#hook_console_table)
  - [`hook_cookie`](#hook_cookie)
  - [`hook_cryptojs`](#hook_cryptojs)
  - [`hook_date_now`](#hook_date_now)
  - [`hook_fetch`](#hook_fetch)
  - [`hook_function`](#hook_function)
  - [`hook_history`](#hook_history)
  - [`hook_history_go`](#hook_history_go)
  - [`hook_jsencrypt`](#hook_jsencrypt)
  - [`hook_json_parse`](#hook_json_parse)
  - [`hook_json_stringify`](#hook_json_stringify)
  - [`hook_local_storage`](#hook_local_storage)
  - [`hook_location_href`](#hook_location_href)
  - [`hook_performance_now`](#hook_performance_now)
  - [`hook_promise`](#hook_promise)
  - [`hook_random`](#hook_random)
  - [`hook_session_storage`](#hook_session_storage)
  - [`hook_smcrypto`](#hook_smcrypto)
  - [`hook_websocket`](#hook_websocket)
  - [`hook_xhr_open`](#hook_xhr_open)
  - [`hook_xhr_set_request_header`](#hook_xhr_set_request_header)
  - [`inject_code_template`](#inject_code_template)
  - [`inject_hook`](#inject_hook)
  - [`inject_stealth`](#inject_stealth)
  - [`inspect_object`](#inspect_object)
  - [`list_code_templates`](#list_code_templates)
  - [`list_created_hooks`](#list_created_hooks)
  - [`list_hooks`](#list_hooks)
  - [`list_scripts`](#list_scripts)
  - [`list_stealth_features`](#list_stealth_features)
  - [`list_stealth_presets`](#list_stealth_presets)
  - [`monitor_events`](#monitor_events)
  - [`observe_flow`](#observe_flow)
  - [`rebuild_bundle`](#rebuild_bundle)
  - [`record_reverse_evidence`](#record_reverse_evidence)
  - [`remove_hook`](#remove_hook)
  - [`remove_xhr_breakpoint`](#remove_xhr_breakpoint)
  - [`risk_panel`](#risk_panel)
  - [`search_in_scripts`](#search_in_scripts)
  - [`search_in_sources`](#search_in_sources)
  - [`set_breakpoint_on_text`](#set_breakpoint_on_text)
  - [`set_user_agent`](#set_user_agent)
  - [`stop_monitor`](#stop_monitor)
  - [`summarize_code`](#summarize_code)
  - [`trace_function`](#trace_function)
  - [`trace_signature_generation`](#trace_signature_generation)
  - [`understand_code`](#understand_code)
  - [`unhook_function`](#unhook_function)
  - [`wasm_capabilities`](#wasm_capabilities)
  - [`wasm_decompile`](#wasm_decompile)
  - [`wasm_disassemble`](#wasm_disassemble)
  - [`wasm_dump`](#wasm_dump)
  - [`wasm_inspect_sections`](#wasm_inspect_sections)
  - [`wasm_memory_inspect`](#wasm_memory_inspect)
  - [`wasm_offline_run`](#wasm_offline_run)
  - [`wasm_optimize`](#wasm_optimize)
  - [`wasm_vmp_trace`](#wasm_vmp_trace)
  - [`xhr_to_js_breakpoint`](#xhr_to_js_breakpoint)
- **[Input automation](#input-automation)** (4 tools)
  - [`click_element`](#click_element)
  - [`scroll_by`](#scroll_by)
  - [`type_text`](#type_text)
  - [`wait_for_element`](#wait_for_element)
- **[Emulation](#emulation)** (4 tools)
  - [`emulate_cpu`](#emulate_cpu)
  - [`emulate_mobile`](#emulate_mobile)
  - [`emulate_network`](#emulate_network)
  - [`resize_page`](#resize_page)
- **[Performance](#performance)** (4 tools)
  - [`get_performance_metrics`](#get_performance_metrics)
  - [`performance_analyze_insight`](#performance_analyze_insight)
  - [`start_performance_trace`](#start_performance_trace)
  - [`stop_performance_trace`](#stop_performance_trace)
- **[Pages](#pages)** (9 tools)
  - [`check_browser_health`](#check_browser_health)
  - [`delete_session_state`](#delete_session_state)
  - [`dump_session_state`](#dump_session_state)
  - [`handle_dialog`](#handle_dialog)
  - [`list_session_states`](#list_session_states)
  - [`load_session_state`](#load_session_state)
  - [`restore_session_state`](#restore_session_state)
  - [`save_session_state`](#save_session_state)
  - [`update_extensions`](#update_extensions)
- **[Data](#data)** (5 tools)
  - [`create_site_experience`](#create_site_experience)
  - [`delete_site_experience`](#delete_site_experience)
  - [`list_site_experiences`](#list_site_experiences)
  - [`search_site_experience`](#search_site_experience)
  - [`update_site_experience`](#update_site_experience)

## Navigation automation

### `click` — 点击元素

**Description:** Click on an element matched by CSS selector. Supports single and double click.

**Parameters:**

- `selector`
- `dblClick`

### `click_at` — 坐标点击

**Description:** Perform a real mouse click at the center coordinates of an element using CDP Input.dispatchMouseEvent. Useful when Playwright click is intercepted.

**Parameters:**

- `selector`

### `drag` — 拖拽元素

**Description:** Drag an element from a source CSS selector to a target CSS selector using mouse events.

**Parameters:**

- `fromSelector`
- `toSelector`

### `fill` — 填充输入

**Description:** Fill a value into an input, textarea, or select element matched by CSS selector. Automatically handles <select> via selectOption.

**Parameters:**

- `selector`
- `value`

### `fill_form` — 批量填充表单

**Description:** Fill multiple form elements in one call. Each entry specifies a CSS selector and a value. Automatically handles <select> via selectOption.

**Parameters:**

- `elements`

### `find_clickable_elements` — 查找可点击元素

**Description:** Find clickable buttons and links on the current page. Optionally filter by text content. Returns selector, text, type, visibility, and bounding box.

**Parameters:**

- `filterText`

### `get_dom_structure` — 获取DOM结构

**Description:** Get DOM tree structure for the current page. Returns a hierarchical tree with tag names, IDs, classes, and optional text content.

**Parameters:**

- `maxDepth`
- `includeText`

### `hover` — 悬停元素

**Description:** Hover the mouse over an element matched by CSS selector.

**Parameters:**

- `selector`

### `list_pages` — 列出页面

**Description:** List all open browser pages with their index, URL and title. Use this to find the page index before calling select_page.

### `navigate_page` — 导航页面

**Description:** Navigate the current page. Supports URL navigation, back, forward, and reload. Waits for DOMContentLoaded event.

**Parameters:**

- `type`
- `url`
- `ignoreCache`
- `timeout`

### `new_page` — 新建页面

**Description:** Create a new browser page and navigate to the specified URL. The new page will be automatically selected.

**Parameters:**

- `url`
- `timeout`
- `preloadHook`
- `preloadPreset`

### `press_key` — 按键

**Description:** Press a keyboard key or key combination (e.g. "Enter", "Control+A", "Alt+Shift+F"). Supports modifier keys.

**Parameters:**

- `key`

### `query_dom` — 查询DOM元素

**Description:** Query one or multiple DOM elements by CSS selector. Returns structured element info including tag, attributes, bounding box, and visibility.

**Parameters:**

- `selector`
- `all`
- `limit`

### `select_page` — 选择页面

**Description:** Select a page by index to bring it to the foreground and switch context. Use list_pages first to find the page index.

**Parameters:**

- `pageIdx`

### `set_files` — 设置文件

**Description:** Set files on a file input element using CDP DOM.setFileInputFiles. Useful when Playwright setInputFiles is blocked.

**Parameters:**

- `selector`
- `filePaths`

### `upload_file` — 上传文件

**Description:** Upload a file to a file input element. Tries Playwright setInputFiles first, then falls back to filechooser event pattern.

**Parameters:**

- `selector`
- `filePath`

## Network

### `analyze_websocket_messages` — analyze_websocket_messages

**Description:** Analyzes WebSocket messages and groups them by pattern/fingerprint. Essential for understanding binary/protobuf message types in live streaming scenarios. Returns statistics and sample indices for each message type.

**Parameters:**

- `wsid`
- `direction`

### `get_network_request` — get_network_request

**Description:** Gets a network request by an optional reqid, if omitted returns the currently selected request in the DevTools Network panel.

**Parameters:**

- `reqid`
- `maxBodyLength`

### `get_websocket_message` — get_websocket_message

**Description:** Gets a single WebSocket message by its frame index. Use get_websocket_messages or analyze_websocket_messages first to find the frame index.

**Parameters:**

- `wsid`
- `frameIndex`

### `get_websocket_messages` — get_websocket_messages

**Description:** Gets messages for a WebSocket connection. IMPORTANT: For binary/protobuf messages (like live streaming), use analyze_websocket_messages FIRST to understand message types, then use groupId parameter to filter specific types. Default mode shows summary only.

**Parameters:**

- `wsid`
- `direction`
- `groupId`
- `pageSize`
- `pageIdx`
- `show_content`

### `list_network_requests` — list_network_requests

**Description:** List all requests for the currently selected page since the last navigation. Supports filtering by resource type, header keyword, pagination, and waiting for matching requests.

**Parameters:**

- `pageSize`
- `pageIdx`
- `resourceTypes`
- `includePreservedRequests`
- `targetPageIdx`
- `waitForRequest`
- `waitTimeoutMs`
- `headerFilter`
- `includeSignatureEvidence`

### `list_websocket_connections` — list_websocket_connections

**Description:** List all WebSocket connections. After getting wsid, use analyze_websocket_messages(wsid) FIRST to understand message patterns before viewing individual messages.

**Parameters:**

- `pageSize`
- `pageIdx`
- `urlFilter`
- `includePreservedConnections`

## Debugging

### `capture_video_frame` — 捕获视频帧

**Description:** Capture the current frame of a video element. Optionally seek to a specific time first. Returns the frame as an image.

**Parameters:**

- `selector`
- `seekTime`
- `outputPath`
- `format`
- `quality`

### `evaluate_on_callframe` — 在调用帧上执行

**Description:** 在暂停时的指定调用帧上下文中执行 JavaScript 表达式。允许检查变量和执行代码。

**Parameters:**

- `expression`
- `frameIndex`

### `get_ai_debug_status` — 获取 AI 调试状态

**Description:** 获取当前调试状态，包括暂停状态、断点数量、脚本数量等。

### `get_console_message` — get_console_message

**Description:** Gets a console message by its ID. Returns structured message data including type, text, and arguments.

**Parameters:**

- `msgid`

### `get_paused_info` — 获取暂停信息

**Description:** 获取当前暂停状态信息，包括调用栈、当前位置和作用域变量。在断点命中后使用此工具了解执行上下文。

**Parameters:**

- `includeScopes`
- `maxScopeDepth`

### `get_video_info` — 获取视频信息

**Description:** Get video element information by CSS selector. Returns duration, currentTime, paused state, and src.

**Parameters:**

- `selector`

### `inspect_locals` — 检查局部变量

**Description:** 检查当前暂停栈所有帧的局部变量摘要。

### `list_breakpoints` — 列出断点

**Description:** 列出当前调试会话中的所有活跃断点。

### `list_console_messages` — list_console_messages

**Description:** List all console messages for the currently selected page since the last navigation. Supports filtering by type and pagination.

**Parameters:**

- `pageSize`
- `pageIdx`
- `types`
- `includePreservedMessages`

### `list_frames` — 列出 Frame

**Description:** Lists all frames (including iframes) in the current page as a tree. Shows frame index, name, and URL. Use select_frame to switch execution context to a specific frame.

### `pause` — 暂停执行

**Description:** 暂停 JavaScript 执行。用于中断运行中的代码。

### `remove_breakpoint` — 移除断点

**Description:** 移除指定 ID 的断点。使用 list_breakpoints 查看活跃断点。

**Parameters:**

- `breakpointId`

### `resume` — 恢复执行

**Description:** 从暂停状态恢复执行，直到下一个断点或执行结束。

### `seek_video` — 跳转视频

**Description:** Seek a video element to a specific time position by CSS selector.

**Parameters:**

- `selector`
- `time`

### `select_frame` — 选择 Frame

**Description:** Selects a frame (by index from list_frames) as the execution context for evaluate_script, hook_function, inspect_object, and other tools that run JavaScript in the page.

**Parameters:**

- `frameIdx`

### `set_breakpoint` — 设置断点

**Description:** 设置 JavaScript 断点。支持按脚本 URL 和行号设置，可选条件表达式。注意：优先使用 hook_function 或 trace_function 进行监控，断点需要暂停/恢复协调，在自动化流程中容易出错。

**Parameters:**

- `url`
- `lineNumber`
- `columnNumber`
- `condition`
- `isRegex`

### `start_continuous_debugging` — 开始连续调试

**Description:** 开始连续调试会话。注意：当前工具层尚未接入 AIContinuousDebugger 运行时，请改用 pause/set_breakpoint/get_paused_info 组合。

### `step_into` — 单步进入

**Description:** 单步进入函数调用。用于进入函数体内部进行调试。需要先在断点暂停。

### `step_out` — 单步跳出

**Description:** 单步跳出当前函数，继续执行直到函数返回。用于快速退出函数。需要先在断点暂停。

### `step_over` — 单步跳过

**Description:** 单步跳过函数调用，将函数调用视为一个步骤。用于跳过函数体。需要先在断点暂停。

### `stop_continuous_debugging` — 停止连续调试

**Description:** 停止连续调试会话。

### `take_screenshot` — 截图

**Description:** Take a screenshot of the page or element.

**Parameters:**

- `format`
- `quality`
- `fullPage`
- `filePath`

## JS Reverse Engineering

### `analyze_pipeline` — analyze_pipeline

**Description:** 分析流水线：采集 → 并行分析(加密检测+混淆分析) → 生成报告。演示 Pipeline 编排模式的完整工作流。

**Parameters:**

- `url`
- `deep`

### `analyze_target` — analyze_target

**Description:** One-shot reverse workflow: collect code, run security/crypto analysis, optional deobfuscation, and hook timeline correlation.

**Parameters:**

- `url`
- `topN`
- `useAI`
- `runDeobfuscation`
- `hookPreset`
- `autoInjectHooks`
- `waitAfterHookMs`
- `correlationWindowMs`
- `maxCorrelatedFlows`
- `maxFingerprints`
- `autoReplayActions`
- `collect`

### `anti_anti_debug` — Anti Anti-Debug

**Description:** Anti-anti-debug toolkit: fix window size, freeze time, block page close, block history navigation, block console clear, hide webdriver flag.

**Parameters:**

- `features`

### `anti_anti_hook` — Anti Anti-Hook

**Description:** Anti-anti-hook: protect Function.prototype.toString to make hooked methods look native. Also protects Object.getOwnPropertyDescriptor and iframe contentWindow/contentDocument.

**Parameters:**

- `hookedMethods`

### `auto_hook` — auto_hook

**Description:** Auto-hook: generate and inject debug hooks and crypto library hooks based on preset or custom options

**Parameters:**

- `url`
- `preset`
- `autoInject`
- `waitAfterHookMs`
- `useAI`
- `hookCrypto`
- `hookRsa`
- `hookSmCrypto`
- `hookTimers`
- `hookEval`
- `hookCookie`
- `hookXhr`
- `hookFetch`
- `exportResults`
- `exportWaitMs`

### `break_on_xhr` — 设置 XHR 断点

**Description:** 在 XHR/Fetch 请求 URL 包含指定字符串时触发断点。

**Parameters:**

- `url`

### `bypass_debugger` — Bypass Debugger

**Description:** Bypass infinite debugger statements by removing debugger keywords from eval/Function/constructor.

**Parameters:**

- `targets`

### `collect_code` — collect_code

**Description:** Collect JavaScript code from a page with smart modes (summary/priority/incremental/full).

**Parameters:**

- `url`
- `smartMode`
- `returnMode`
- `includeInline`
- `includeExternal`
- `includeDynamic`
- `maxTotalSize`
- `maxFileSize`
- `pattern`
- `limit`
- `topN`

### `collection_diff` — collection_diff

**Description:** Compare previous and current collected file summaries.

**Parameters:**

- `previous`
- `current`
- `includeUnchanged`

### `create_hook` — create_hook

**Description:** RECOMMENDED: Create hook script for function/fetch/xhr/property/cookie/websocket/eval/timer. Hooks run without pausing page execution and are the preferred approach over breakpoints for monitoring and interception. Returns hookId and script for use with inject_hook.

**Parameters:**

- `type`
- `params`
- `description`
- `action`
- `hookId`
- `capture`
- `condition`

### `deobfuscate_code` — deobfuscate_code

**Description:** AI-assisted JavaScript deobfuscation.

**Parameters:**

- `code`
- `aggressive`
- `renameVariables`

### `detect_crypto` — detect_crypto

**Description:** Detect cryptographic algorithms/libraries from JavaScript source.

**Parameters:**

- `code`
- `useAI`

### `diff_env_requirements` — diff_env_requirements

**Description:** Compare local runtime failures with observed browser capabilities and suggest the next environment patches.

**Parameters:**

- `runtimeError`
- `observedCapabilities`

### `export_rebuild_bundle` — export_rebuild_bundle

**Description:** Export a local Node rebuild bundle from observed reverse-engineering evidence.

**Parameters:**

- `taskId`
- `taskSlug`
- `targetUrl`
- `goal`
- `autoGenerate`
- `targetKeywords`
- `targetUrlPatterns`
- `targetFunctionNames`
- `targetActionDescription`
- `maxEvidenceItems`
- `entryCode`
- `envCode`
- `polyfillsCode`
- `capture`
- `notes`

### `export_session_report` — export_session_report

**Description:** Export current reverse-engineering session as JSON or Markdown.

**Parameters:**

- `format`
- `includeHookData`

### `find_in_script` — 在脚本中查找

**Description:** 在指定脚本中查找字符串，返回精确的行号/列号及周围上下文。适用于在压缩文件中设置断点。

**Parameters:**

- `scriptId`
- `query`
- `contextChars`
- `occurrence`
- `caseSensitive`

### `fixed_window_size` — Fixed Window Size

**Description:** Fix window dimensions by intercepting innerHeight/innerWidth/outerHeight/outerWidth getters and setters.

**Parameters:**

- `innerHeight`
- `innerWidth`
- `outerHeight`
- `outerWidth`

### `get_code_template` — Get Code Template

**Description:** Read a code template file and return its source code, description and size.

**Parameters:**

- `templateName`

### `get_hook_data` — Get Hook Data

**Description:** Get captured hook data. Syncs from browser to HookManager first, then returns data. Supports raw, summary, and detail views with filtering.

**Parameters:**

- `hookId`
- `view`
- `maxRecords`
- `type`
- `event`
- `phase`

### `get_request_initiator` — 获取请求发起者

**Description:** 获取网络请求的 JavaScript 调用栈（发起者）。帮助追踪哪个代码触发了 API 调用。

**Parameters:**

- `requestId`

### `get_script_source` — 获取脚本源码

**Description:** 根据脚本 ID 获取 JavaScript 脚本源码。支持行范围（多行文件）或字符偏移（单行压缩文件）。先使用 list_scripts 查找脚本 ID。

**Parameters:**

- `scriptId`
- `startLine`
- `endLine`
- `offset`
- `length`
- `prettyPrint`

### `get_storage` — 获取存储

**Description:** Gets browser storage data including cookies, localStorage, and sessionStorage.

**Parameters:**

- `type`
- `filter`

### `hook_close` — Hook Close

**Description:** Block window.close to prevent anti-debugging page closure.

### `hook_console_clear` — Hook Console Clear

**Description:** Block console.clear to prevent websites from clearing the console.

### `hook_console_log` — Hook Console Log

**Description:** Protect console.log from being overwritten by websites. Supports proxy/toString/freeze modes.

**Parameters:**

- `mode`

### `hook_console_protect` — Hook Console Protect

**Description:** Protect console methods (log/trace/groupCollapsed/groupEnd) from being overwritten by website code.

**Parameters:**

- `protectedMethods`

### `hook_console_table` — Hook Console Table

**Description:** Neutralize console.table to bypass timing-based anti-debugging detection.

**Parameters:**

- `enabled`

### `hook_cookie` — Hook Cookie

**Description:** Hook document.cookie to monitor Cookie read/write operations. Supports filtering by cookie name.

**Parameters:**

- `filterKeys`
- `showStack`
- `triggerDebugger`

### `hook_cryptojs` — hook_cryptojs

**Description:** Hook CryptoJS library: intercept AES, DES, MD5, SHA, HMAC and other symmetric/hash algorithms

**Parameters:**

- `algorithms`
- `logFormat`

### `hook_date_now` — Hook Date.now

**Description:** Hook Date.now() to fix its return value. Useful for bypassing time-based anti-debugging.

**Parameters:**

- `fixedValue`
- `showStack`
- `triggerDebugger`

### `hook_fetch` — Hook Fetch

**Description:** Hook window.fetch to monitor fetch API calls, logging request parameters and stack traces. Supports optional --url filter.

**Parameters:**

- `url`
- `showStack`
- `triggerDebugger`

### `hook_function` — Hook Function

**Description:** RECOMMENDED for reverse engineering: Hooks a JavaScript function to log its calls, arguments, and return values without pausing execution. More reliable than breakpoints for automated workflows. Use this as the default approach for monitoring functions.

**Parameters:**

- `target`
- `logArgs`
- `logResult`
- `logStack`
- `hookId`

### `hook_history` — Hook History

**Description:** Hook History API to monitor pushState/replaceState operations. Supports URL filtering.

**Parameters:**

- `filterUrls`
- `showStack`
- `triggerDebugger`

### `hook_history_go` — Hook History Go

**Description:** Block history.go and history.back to prevent anti-debugging page navigation.

### `hook_jsencrypt` — hook_jsencrypt

**Description:** Hook JSEncrypt RSA library: intercept public/private key, plaintext, ciphertext

**Parameters:**

- `logFormat`

### `hook_json_parse` — Hook JSON.parse

**Description:** Hook JSON.parse to monitor JSON parsing operations. Supports content filtering.

**Parameters:**

- `filterKeys`
- `showStack`
- `triggerDebugger`

### `hook_json_stringify` — Hook JSON.stringify

**Description:** Hook JSON.stringify to monitor JSON serialization operations.

**Parameters:**

- `showStack`
- `triggerDebugger`

### `hook_local_storage` — Hook LocalStorage

**Description:** Hook localStorage to monitor setItem/getItem/removeItem/clear operations. Supports key filtering.

**Parameters:**

- `actions`
- `filterKeys`
- `showStack`
- `triggerDebugger`

### `hook_location_href` — Hook Location Href

**Description:** Block page navigation by hooking onbeforeunload. Useful for preventing anti-debugging redirects.

**Parameters:**

- `triggerDebugger`

### `hook_performance_now` — Hook performance.now

**Description:** Hook performance.now() to fix its return value. Useful for bypassing timing-based anti-debugging.

**Parameters:**

- `fixedValue`
- `showStack`
- `triggerDebugger`

### `hook_promise` — Hook Promise

**Description:** Hook Promise to monitor resolve calls, printing resolve arguments and call stacks for quick async callback location.

**Parameters:**

- `showStack`
- `triggerDebugger`

### `hook_random` — Hook Math.random

**Description:** Hook Math.random to fix its return value. Useful for bypassing random-based anti-debugging.

**Parameters:**

- `fixedValue`
- `showStack`
- `triggerDebugger`

### `hook_session_storage` — Hook SessionStorage

**Description:** Hook sessionStorage to monitor setItem/getItem/removeItem/clear operations. Supports key filtering.

**Parameters:**

- `actions`
- `filterKeys`
- `showStack`
- `triggerDebugger`

### `hook_smcrypto` — hook_smcrypto

**Description:** Hook SM-crypto library: intercept SM2, SM3, SM4 algorithms

**Parameters:**

- `algorithms`
- `logFormat`

### `hook_websocket` — Hook WebSocket

**Description:** Hook WebSocket to monitor connections, message send/receive. Supports URL filtering.

**Parameters:**

- `filterUrls`
- `showStack`
- `triggerDebugger`

### `hook_xhr_open` — Hook XHR Open

**Description:** Hook XMLHttpRequest.open to monitor XHR request initialization. Supports URL filtering.

**Parameters:**

- `filterUrls`
- `showStack`
- `triggerDebugger`

### `hook_xhr_set_request_header` — Hook XHR SetRequestHeader

**Description:** Hook XMLHttpRequest.setRequestHeader to monitor request header setting. Supports header name filtering.

**Parameters:**

- `filterKeys`
- `showStack`
- `triggerDebugger`

### `inject_code_template` — Inject Code Template

**Description:** Inject a code template into the browser page for execution via frame.evaluate.

**Parameters:**

- `templateName`

### `inject_hook` — Inject Hook

**Description:** Inject a hook script. Use persistent=true to keep the hook alive across page navigations (registers via Page.addScriptToEvaluateOnNewDocument and also runs once on the current frame).

**Parameters:**

- `hookId`
- `script`
- `persistent`

### `inject_stealth` — inject_stealth

**Description:** Inject anti-detection stealth scripts (hide webdriver, mock chrome, canvas noise, etc.)

**Parameters:**

- `preset`

### `inspect_object` — 检查对象

**Description:** Deeply inspects a JavaScript object, showing its properties, prototype chain, and methods. Useful for understanding object structure.

**Parameters:**

- `expression`
- `depth`
- `showMethods`
- `showPrototype`

### `list_code_templates` — List Code Templates

**Description:** List all available code templates with their names, descriptions and file info.

### `list_created_hooks` — List Created Hooks

**Description:** List all created hooks from HookManager. Optionally syncs browser-side data for record counts.

**Parameters:**

- `hookId`
- `verbose`
- `syncFromBrowser`

### `list_hooks` — 列出 Hook

**Description:** Lists all active function hooks.

### `list_scripts` — 列出脚本

**Description:** 列出当前页面加载的所有 JavaScript 脚本。返回脚本 ID、URL 和 Source Map 信息。在设置断点或搜索前使用此工具查找脚本。

**Parameters:**

- `filter`

### `list_stealth_features` — list_stealth_features

**Description:** List available stealth features

### `list_stealth_presets` — list_stealth_presets

**Description:** List available stealth presets

### `monitor_events` — 监控事件

**Description:** Monitors DOM events on a specified element or window. Events will be logged to console.

**Parameters:**

- `selector`
- `events`
- `monitorId`

### `observe_flow` — observe_flow

**Description:** Observe mode: collect and analyze page scripts, identify encryption and obfuscation, generate risk assessment report

**Parameters:**

- `url`
- `includeDynamic`
- `includeExternal`
- `includeInline`
- `includeServiceWorker`
- `includeWebWorker`
- `maxFileSize`
- `maxTotalSize`
- `mode`
- `smartMode`
- `dynamicWaitMs`
- `priorities`
- `compress`
- `timeout`

### `rebuild_bundle` — rebuild_bundle

**Description:** Build local Node.js reproduction environment from captured evidence and target script

**Parameters:**

- `url`
- `targetUrl`
- `targetFunctionNames`
- `targetKeywords`
- `targetUrlPatterns`
- `goal`
- `autoGenerate`
- `maxEvidenceItems`
- `taskId`
- `taskSlug`

### `record_reverse_evidence` — record_reverse_evidence

**Description:** Append structured reverse-engineering evidence to a task artifact log.

**Parameters:**

- `taskId`
- `taskSlug`
- `targetUrl`
- `goal`
- `channel`
- `targetKeywords`
- `targetUrlPatterns`
- `targetFunctionNames`
- `targetActionDescription`
- `entry`

### `remove_hook` — remove_hook

**Description:** Remove a hook by id. Removes from in-process HookManager and optionally cleans browser-side data.

**Parameters:**

- `hookId`
- `cleanBrowser`

### `remove_xhr_breakpoint` — 移除 XHR 断点

**Description:** 移除 XHR/Fetch 断点。

**Parameters:**

- `url`

### `risk_panel` — risk_panel

**Description:** Build a combined risk score from analyzer, crypto detector and hook signals.

**Parameters:**

- `code`
- `useAI`
- `includeHookSignals`
- `hookId`
- `topN`

### `search_in_scripts` — search_in_scripts

**Description:** Search in collected script cache with regex pattern.

**Parameters:**

- `pattern`
- `limit`
- `maxTotalSize`

### `search_in_sources` — 在源码中搜索

**Description:** 在所有已加载的 JavaScript 源码中搜索字符串或正则表达式。返回匹配行及脚本 ID、URL 和行号。使用 get_script_source 和 startLine/endLine 查看匹配周围的完整上下文。

**Parameters:**

- `query`
- `caseSensitive`
- `isRegex`
- `maxResults`
- `maxLineLength`
- `excludeMinified`
- `urlFilter`
- `source`

### `set_breakpoint_on_text` — 在文本上设置断点

**Description:** 在指定代码文本（函数名、语句等）上设置断点，通过搜索自动确定精确位置。适用于正常和压缩文件。注意：优先使用 hook_function 监控函数调用 — 它无需暂停执行即可捕获参数/返回值。仅在需要检查特定代码位置的局部变量时使用此工具。

**Parameters:**

- `text`
- `urlFilter`
- `occurrence`
- `condition`

### `set_user_agent` — set_user_agent

**Description:** Set custom User-Agent for the current page via CDP

**Parameters:**

- `userAgent`

### `stop_monitor` — 停止监控

**Description:** Stops an event monitor.

**Parameters:**

- `monitorId`

### `summarize_code` — summarize_code

**Description:** Summarize one code file, multiple files, or project-level context.

**Parameters:**

- `mode`
- `code`
- `url`
- `files`

### `trace_function` — 追踪函数

**Description:** 追踪源码中指定名称的函数调用。适用于任何函数（包括 webpack/rollup 打包的内部函数）。使用"日志点"（条件断点）记录参数而不暂停执行。

**Parameters:**

- `target`
- `urlFilter`
- `logArgs`
- `logResult`
- `logStack`
- `hookId`

### `trace_signature_generation` — trace_signature_generation

**Description:** Signature tracing workflow: correlate network requests, hook diagnostics, XHR breakpoints and call frame inspection from header/URL clues

**Parameters:**

- `requestUrlPattern`
- `headerKeyword`
- `maxResults`
- `includeSensitiveValues`
- `taskId`

### `understand_code` — understand_code

**Description:** Analyze code structure/business/security with AI + static analysis.

**Parameters:**

- `code`
- `focus`

### `unhook_function` — Unhook Function

**Description:** Removes a previously installed function hook.

**Parameters:**

- `hookId`

### `wasm_capabilities` — wasm_capabilities

**Description:** Detect available native Wasm toolchain (wabt, binaryen, wasmtime, wasmer) and session state.

### `wasm_decompile` — wasm_decompile

**Description:** Decompile a .wasm file with function-level summaries and suspicious-pattern detection.

**Parameters:**

- `inputPath`
- `outputPath`
- `foldExprs`
- `inlineExport`
- `maxWatChars`

### `wasm_disassemble` — wasm_disassemble

**Description:** Disassemble a .wasm file to WAT (WebAssembly Text Format) using the built-in decompiler.

**Parameters:**

- `inputPath`
- `outputPath`
- `foldExprs`

### `wasm_dump` — wasm_dump

**Description:** Dump a captured Wasm module to a .wasm file on disk.

**Parameters:**

- `moduleIndex`
- `outputPath`

### `wasm_inspect_sections` — wasm_inspect_sections

**Description:** Inspect Wasm binary sections: section map, function signatures, string scan, and import/export summary.

**Parameters:**

- `inputPath`
- `sections`
- `includeFunctionSignatures`
- `includeStringScan`
- `maskSensitiveStrings`
- `maxStringSlots`
- `maxSummaryLines`

### `wasm_memory_inspect` — wasm_memory_inspect

**Description:** Inspect WebAssembly.Memory exports in the current page — hex/ascii dump, pattern search.

**Parameters:**

- `offset`
- `length`
- `format`
- `searchPattern`

### `wasm_offline_run` — wasm_offline_run

**Description:** Execute a Wasm function offline using wasmtime or wasmer CLI runtime.

**Parameters:**

- `inputPath`
- `functionName`
- `args`
- `runtime`
- `timeoutMs`

### `wasm_optimize` — wasm_optimize

**Description:** Optimize a .wasm file using binaryen wasm-opt with selectable optimization level.

**Parameters:**

- `inputPath`
- `outputPath`
- `level`

### `wasm_vmp_trace` — wasm_vmp_trace

**Description:** Trace Wasm runtime events captured by the JS-Wasm boundary hooks, with optional module filter.

**Parameters:**

- `maxEvents`
- `filterModule`

### `xhr_to_js_breakpoint` — XHR 到 JS 断点

**Description:** 设置 XHR 断点；命中后可结合 get_paused_info / set_breakpoint 完成 JS 断点定位。

**Parameters:**

- `url`

## Input automation

### `click_element` — click_element

**Description:** Click on an element by CSS selector

**Parameters:**

- `selector`

### `scroll_by` — scroll_by

**Description:** Scroll page by direction (up/down/top/bottom), automatically waits 800ms for lazy-loaded content

**Parameters:**

- `direction`
- `pixels`

### `type_text` — type_text

**Description:** Type text into an input element by CSS selector

**Parameters:**

- `selector`
- `text`
- `delay`

### `wait_for_element` — wait_for_element

**Description:** Wait for an element matching the CSS selector to appear on the page

**Parameters:**

- `selector`
- `timeout`

## Emulation

### `emulate_cpu` — emulate_cpu

**Description:** Emulate CPU throttling via CDP Performance.setCPUThrottlingRate

**Parameters:**

- `throttlingRate`

### `emulate_mobile` — emulate_mobile

**Description:** Emulate mobile device viewport, user-agent and touch events, or restore desktop mode

**Parameters:**

- `enable`
- `device`

### `emulate_network` — emulate_network

**Description:** Emulate network conditions (throttling/offline) via CDP Network.emulateNetworkConditions

**Parameters:**

- `throttlingOption`

### `resize_page` — resize_page

**Description:** Resize page viewport to specified width and height

**Parameters:**

- `width`
- `height`

## Performance

### `get_performance_metrics` — get_performance_metrics

**Description:** Gets page performance metrics from the Performance API, including navigation timing, resource timing, and paint events.

### `performance_analyze_insight` — performance_analyze_insight

**Description:** Provides more detailed information on a specific Performance Insight that was highlighted in the results of a trace recording.

**Parameters:**

- `insightName`

### `start_performance_trace` — start_performance_trace

**Description:** Starts a performance trace recording on the selected page. This can be used to look for performance problems and insights to improve the performance of the page. It will also report Core Web Vital (CWV) scores for the page.

**Parameters:**

- `reload`
- `autoStop`

### `stop_performance_trace` — stop_performance_trace

**Description:** Stop performance trace recording and analyze results via CDP Tracing.end

## Pages

### `check_browser_health` — check_browser_health

**Description:** Check browser connection health and page availability

### `delete_session_state` — delete_session_state

**Description:** 删除会话状态

**Parameters:**

- `sessionId`

### `dump_session_state` — dump_session_state

**Description:** 导出会话状态

**Parameters:**

- `sessionId`
- `path`
- `pretty`
- `encrypt`

### `handle_dialog` — handle_dialog

**Description:** Handle browser dialogs (alert/confirm/prompt) - accept or dismiss

**Parameters:**

- `action`
- `promptText`

### `list_session_states` — list_session_states

**Description:** 列出会话状态

### `load_session_state` — load_session_state

**Description:** 加载会话状态

**Parameters:**

- `sessionId`
- `path`
- `snapshotJson`
- `overwrite`

### `restore_session_state` — restore_session_state

**Description:** 恢复会话状态

**Parameters:**

- `sessionId`
- `navigateToSavedUrl`
- `clearStorageBeforeRestore`

### `save_session_state` — save_session_state

**Description:** 保存会话状态

**Parameters:**

- `sessionId`
- `includeCookies`
- `includeLocalStorage`
- `includeSessionStorage`

### `update_extensions` — update_extensions

**Description:** Update Chrome extensions by clicking the update button on chrome://extensions/

## Data

### `create_site_experience` — create_site_experience

**Description:** Create a new site experience entry

**Parameters:**

- `domain`
- `name`
- `aliases`
- `platformFeatures`
- `validPatterns`
- `knownPitfalls`

### `delete_site_experience` — delete_site_experience

**Description:** Delete a site experience entry by ID

**Parameters:**

- `id`

### `list_site_experiences` — list_site_experiences

**Description:** List all site experience entries

### `search_site_experience` — search_site_experience

**Description:** Search site experience by URL or name

**Parameters:**

- `url`
- `name`

### `update_site_experience` — update_site_experience

**Description:** Update an existing site experience entry

**Parameters:**

- `id`
- `name`
- `aliases`
- `platformFeatures`
- `validPatterns`
- `knownPitfalls`

### `diagnose_environment` — diagnose_environment

**Description:** Run environment diagnostics to check Node version, build output, AI configuration, and artifacts directory status.

**Category:** diagnostics (read-only)

**Parameters:**

- `checks` (optional, string[]): List of check names to run. If omitted, all checks are executed. Available checks: `node_version`, `build_output`, `ai_provider_selection`, `gemini_cli`, `artifacts_dir`.

**Example output:**

```json
{
  "status": "warn",
  "summary": "3/5 checks passed",
  "checks": [
    {"name": "node_version", "status": "ok", "reason": "v24.3.0", "fix": ""},
    {"name": "build_output", "status": "ok", "reason": "build/src/bin/js-reverse.js exists", "fix": ""},
    {"name": "ai_provider_selection", "status": "warn", "reason": "No AI provider configured", "fix": "Set GEMINI_API_KEY or configure provider in settings"},
    {"name": "artifacts_dir", "status": "ok", "reason": "artifacts/tasks/ exists", "fix": ""}
  ]
}
```

