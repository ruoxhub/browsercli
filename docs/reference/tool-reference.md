<!-- AUTO GENERATED DO NOT EDIT - run 'npm run docs' to update-->

# Chrome DevTools MCP Tool Reference

> 快速按逆向目标查工具，请先看：[`reverse-task-index.md`](./reverse-task-index.md)

- **[Navigation automation](#navigation-automation)** (20 tools)
  - [`check_browser_health`](#check_browser_health)
  - [`click_element`](#click_element)
  - [`delete_session_state`](#delete_session_state)
  - [`dump_session_state`](#dump_session_state)
  - [`find_clickable_elements`](#find_clickable_elements)
  - [`get_dom_structure`](#get_dom_structure)
  - [`list_pages`](#list_pages)
  - [`list_session_states`](#list_session_states)
  - [`load_session_state`](#load_session_state)
  - [`navigate_page`](#navigate_page)
  - [`new_page`](#new_page)
  - [`query_dom`](#query_dom)
  - [`restore_session_state`](#restore_session_state)
  - [`save_session_state`](#save_session_state)
  - [`scroll_by`](#scroll_by)
  - [`seek_video`](#seek_video)
  - [`select_page`](#select_page)
  - [`type_text`](#type_text)
  - [`update_extensions`](#update_extensions)
  - [`wait_for_element`](#wait_for_element)
- **[Network](#network)** (6 tools)
  - [`analyze_websocket_messages`](#analyze_websocket_messages)
  - [`get_network_request`](#get_network_request)
  - [`get_websocket_message`](#get_websocket_message)
  - [`get_websocket_messages`](#get_websocket_messages)
  - [`list_network_requests`](#list_network_requests)
  - [`list_websocket_connections`](#list_websocket_connections)
- **[Debugging](#debugging)** (9 tools)
  - [`capture_video_frame`](#capture_video_frame)
  - [`evaluate_script`](#evaluate_script)
  - [`get_console_message`](#get_console_message)
  - [`get_video_info`](#get_video_info)
  - [`inject_preload_script`](#inject_preload_script)
  - [`list_console_messages`](#list_console_messages)
  - [`list_frames`](#list_frames)
  - [`select_frame`](#select_frame)
  - [`take_screenshot`](#take_screenshot)
- **[JS Reverse Engineering](#js-reverse-engineering)** (68 tools)
  - [`analyze_ast`](#analyze_ast)
  - [`analyze_target`](#analyze_target)
  - [`anti_anti_debug`](#anti_anti_debug)
  - [`break_on_xhr`](#break_on_xhr)
  - [`bypass_debugger`](#bypass_debugger)
  - [`check_url_matches`](#check_url_matches)
  - [`collect_code`](#collect_code)
  - [`collection_diff`](#collection_diff)
  - [`create_hook`](#create_hook)
  - [`create_inject_script`](#create_inject_script)
  - [`delete_inject_script`](#delete_inject_script)
  - [`deobfuscate_code`](#deobfuscate_code)
  - [`deobfuscate_code_vj`](#deobfuscate_code_vj)
  - [`detect_crypto`](#detect_crypto)
  - [`diff_code`](#diff_code)
  - [`diff_env_requirements`](#diff_env_requirements)
  - [`evaluate_on_callframe`](#evaluate_on_callframe)
  - [`export_rebuild_bundle`](#export_rebuild_bundle)
  - [`export_session_report`](#export_session_report)
  - [`find_in_script`](#find_in_script)
  - [`get_ai_debug_status`](#get_ai_debug_status)
  - [`get_code_template`](#get_code_template)
  - [`get_hook_data`](#get_hook_data)
  - [`get_paused_info`](#get_paused_info)
  - [`get_request_initiator`](#get_request_initiator)
  - [`get_script_source`](#get_script_source)
  - [`get_storage`](#get_storage)
  - [`hook_function`](#hook_function)
  - [`inject_hook`](#inject_hook)
  - [`inject_stealth`](#inject_stealth)
  - [`inspect_object`](#inspect_object)
  - [`invoke-skill`](#invoke-skill)
  - [`list_breakpoints`](#list_breakpoints)
  - [`list_code_templates`](#list_code_templates)
  - [`list_created_hooks`](#list_created_hooks)
  - [`list_hooks`](#list_hooks)
  - [`list_inject_scripts`](#list_inject_scripts)
  - [`list_scripts`](#list_scripts)
  - [`list_stealth_features`](#list_stealth_features)
  - [`list_stealth_presets`](#list_stealth_presets)
  - [`list-skills`](#list-skills)
  - [`minify_code`](#minify_code)
  - [`monitor_events`](#monitor_events)
  - [`pause`](#pause)
  - [`record_reverse_evidence`](#record_reverse_evidence)
  - [`remove_breakpoint`](#remove_breakpoint)
  - [`remove_hook`](#remove_hook)
  - [`remove_xhr_breakpoint`](#remove_xhr_breakpoint)
  - [`resume`](#resume)
  - [`risk_panel`](#risk_panel)
  - [`search_in_scripts`](#search_in_scripts)
  - [`search_in_sources`](#search_in_sources)
  - [`set_breakpoint`](#set_breakpoint)
  - [`set_breakpoint_on_text`](#set_breakpoint_on_text)
  - [`set_user_agent`](#set_user_agent)
  - [`start_continuous_debugging`](#start_continuous_debugging)
  - [`step_into`](#step_into)
  - [`step_out`](#step_out)
  - [`step_over`](#step_over)
  - [`stop_continuous_debugging`](#stop_continuous_debugging)
  - [`stop_monitor`](#stop_monitor)
  - [`summarize_code`](#summarize_code)
  - [`trace_function`](#trace_function)
  - [`transpile_code`](#transpile_code)
  - [`understand_code`](#understand_code)
  - [`unhook_function`](#unhook_function)
  - [`update_inject_script`](#update_inject_script)
  - [`xhr_to_js_breakpoint`](#xhr_to_js_breakpoint)
- **[Hook & Injection](#hook-&-injection)** (26 tools)
  - [`activate_vue_devtools`](#activate_vue_devtools)
  - [`anti_anti_hook`](#anti_anti_hook)
  - [`clear_vue_guards`](#clear_vue_guards)
  - [`fixed_window_size`](#fixed_window_size)
  - [`get_vue_routes`](#get_vue_routes)
  - [`hook_console_log`](#hook_console_log)
  - [`hook_console_protect`](#hook_console_protect)
  - [`hook_console_table`](#hook_console_table)
  - [`hook_cookie`](#hook_cookie)
  - [`hook_cryptojs`](#hook_cryptojs)
  - [`hook_date_now`](#hook_date_now)
  - [`hook_fetch`](#hook_fetch)
  - [`hook_history`](#hook_history)
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
- **[Input automation](#input-automation)** (11 tools)
  - [`cdp_upload_files`](#cdp_upload_files)
  - [`click`](#click)
  - [`click_at`](#click_at)
  - [`drag`](#drag)
  - [`fill`](#fill)
  - [`fill_form`](#fill_form)
  - [`handle_dialog`](#handle_dialog)
  - [`hover`](#hover)
  - [`press_key`](#press_key)
  - [`set_files`](#set_files)
  - [`upload_file`](#upload_file)
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
- **[DOM manipulation](#dom-manipulation)** (4 tools)
  - [`cdp_click`](#cdp_click)
  - [`cdp_click_at`](#cdp_click_at)
  - [`cdp_eval`](#cdp_eval)
  - [`cdp_scroll`](#cdp_scroll)
- **[Screenshot](#screenshot)** (1 tools)
  - [`cdp_screenshot`](#cdp_screenshot)
- **[Pages](#pages)** (6 tools)
  - [`cdp_close_page`](#cdp_close_page)
  - [`cdp_get_targets`](#cdp_get_targets)
  - [`cdp_navigate`](#cdp_navigate)
  - [`cdp_new_page`](#cdp_new_page)
  - [`cdp_page_info`](#cdp_page_info)
  - [`cdp_start_proxy`](#cdp_start_proxy)
- **[Data](#data)** (5 tools)
  - [`create_site_experience`](#create_site_experience)
  - [`delete_site_experience`](#delete_site_experience)
  - [`list_site_experiences`](#list_site_experiences)
  - [`search_site_experience`](#search_site_experience)
  - [`update_site_experience`](#update_site_experience)

## Navigation automation

### `check_browser_health` — Check browser health

**Description:** Check browser connectivity and active page readiness before running reverse workflows.

### `click_element` — Click element by selector

**Description:** Click an element by selector.

**Parameters:**

- `selector`

### `delete_session_state` — Delete session snapshot

**Description:** Delete one in-memory session snapshot by sessionId.

**Parameters:**

- `sessionId`

### `dump_session_state` — Export session snapshot

**Description:** Export a saved session snapshot as JSON, optionally writing to a file.

**Parameters:**

- `sessionId`
- `path`
- `pretty`
- `encrypt`

### `find_clickable_elements` — Find clickable buttons and links

**Description:** Find clickable buttons/links, optionally filtered by text.

**Parameters:**

- `filterText`

### `get_dom_structure` — Get DOM tree structure

**Description:** Get DOM tree structure for current page.

**Parameters:**

- `maxDepth`
- `includeText`

### `list_pages` — List pages

**Description:** Get a list of pages open in the browser.

### `list_session_states` — List saved session snapshots

**Description:** List all saved session snapshots in memory.

### `load_session_state` — Load session snapshot from JSON

**Description:** Load a session snapshot from JSON string or file into memory.

**Parameters:**

- `sessionId`
- `path`
- `snapshotJson`
- `overwrite`

### `navigate_page` — Navigate page

**Description:** Navigates the currently selected page to a URL, or performs back/forward/reload navigation. Waits for DOMContentLoaded event (not full page load). Default timeout is 10 seconds.

**Parameters:**

- `type`
- `url`
- `ignoreCache`
- `timeout`

### `new_page` — Create new page

**Description:** Creates a new page and navigates to the specified URL. Waits for DOMContentLoaded event (not full page load). Default timeout is 10 seconds.

**Parameters:**

- `url`
- `timeout`

### `query_dom` — Query DOM elements by CSS selector

**Description:** Query one or multiple elements by CSS selector.

**Parameters:**

- `selector`
- `all`
- `limit`

### `restore_session_state` — Restore page session state

**Description:** Restore a previously saved session snapshot to current page.

**Parameters:**

- `sessionId`
- `navigateToSavedUrl`
- `clearStorageBeforeRestore`

### `save_session_state` — Save page session state

**Description:** Save current page session state (cookies/localStorage/sessionStorage) into in-memory snapshot.

**Parameters:**

- `sessionId`
- `includeCookies`
- `includeLocalStorage`
- `includeSessionStorage`

### `scroll_by` — Scroll page by direction

**Description:** Scroll page by direction (up/down/top/bottom). Automatically waits 800ms for lazy-loaded content to load.

**Parameters:**

- `direction`
- `pixels`

### `seek_video` — Seek video

**Description:** Seek video element to specified time (in seconds).

**Parameters:**

- `selector`
- `time`

### `select_page` — Select page

**Description:** Select a page as a context for future tool calls.

**Parameters:**

- `pageIdx`

### `type_text` — Type text into input element

**Description:** Type text into an input element.

**Parameters:**

- `selector`
- `text`
- `delay`

### `update_extensions` — Update browser extensions

**Description:** Update Chrome extensions by navigating to chrome://extensions/ and clicking the "Update now" button.

### `wait_for_element` — Wait for element to appear

**Description:** Wait for selector to appear.

**Parameters:**

- `selector`
- `timeout`

## Network

### `analyze_websocket_messages` — Analyze and group WebSocket message patterns

**Description:** Analyzes WebSocket messages and groups them by pattern/fingerprint. Essential for understanding binary/protobuf message types in live streaming scenarios. Returns statistics and sample indices for each message type.

**Parameters:**

- `wsid`
- `direction`

### `get_network_request` — Get a network request by ID

**Description:** Gets a network request by an optional reqid, if omitted returns the currently selected request in the DevTools Network panel.

**Parameters:**

- `reqid`

### `get_websocket_message` — Get a single WebSocket message by frame index

**Description:** Gets a single WebSocket message by its frame index. Use get_websocket_messages or analyze_websocket_messages first to find the frame index.

**Parameters:**

- `wsid`
- `frameIndex`

### `get_websocket_messages` — Get WebSocket messages for a connection

**Description:** Gets messages for a WebSocket connection. IMPORTANT: For binary/protobuf messages (like live streaming), use analyze_websocket_messages FIRST to understand message types, then use groupId parameter to filter specific types. Default mode shows summary only.

**Parameters:**

- `wsid`
- `direction`
- `groupId`
- `pageSize`
- `pageIdx`
- `show_content`

### `list_network_requests` — List network requests for selected page

**Description:** List all requests for the currently selected page since the last navigation.

**Parameters:**

- `pageSize`
- `pageIdx`
- `resourceTypes`
- `includePreservedRequests`

### `list_websocket_connections` — List WebSocket connections for selected page

**Description:** List all WebSocket connections. After getting wsid, use analyze_websocket_messages(wsid) FIRST to understand message patterns before viewing individual messages.

**Parameters:**

- `pageSize`
- `pageIdx`
- `urlFilter`
- `includePreservedConnections`

## Debugging

### `capture_video_frame` — Capture video frame

**Description:** Capture a specific frame from a video element. Can seek to a specific time before capturing.

**Parameters:**

- `selector`
- `seekTime`
- `outputPath`
- `format`
- `quality`

### `evaluate_script` — Evaluate JavaScript

**Description:** Evaluate a JavaScript function inside the currently selected page. Returns the response as JSON
so returned values have to JSON-serializable.

**Parameters:**

- `function`

### `get_console_message` — Get console message by index

**Description:** Gets a console message by its ID. You can get all messages by calling list_console_messages.

**Parameters:**

- `msgid`

### `get_video_info` — Get video info

**Description:** Get HTMLVideoElement info including duration, currentTime, paused state, and src.

**Parameters:**

- `selector`

### `inject_preload_script` — Inject preload script

**Description:** Register a JavaScript snippet that will run on future document loads before page scripts execute. Use this for preload hooks, environment patches, and early instrumentation.

**Parameters:**

- `script`

### `list_console_messages` — List console messages

**Description:** List all console messages for the currently selected page since the last navigation.

**Parameters:**

- `pageSize`
- `pageIdx`
- `types`
- `includePreservedMessages`

### `list_frames` — List Frames

**Description:** Lists all frames (including iframes) in the current page as a tree. Shows frame index, name, and URL. Use select_frame to switch execution context to a specific frame.

### `select_frame` — Select Frame

**Description:** Selects a frame (by index from list_frames) as the execution context for evaluate_script, hook_function, inspect_object, and other tools that run JavaScript in the page.

**Parameters:**

- `frameIdx`

### `take_screenshot` — Take screenshot

**Description:** Take a screenshot of the page or element.

**Parameters:**

- `format`
- `quality`
- `fullPage`
- `filePath`

## JS Reverse Engineering

### `analyze_ast` — Analyze AST

**Description:** AST 分析：解析 JavaScript 代码并返回 AST 结构信息，包括节点类型、位置、标识符等

**Parameters:**

- `code`
- `detail`
- `filterType`

### `analyze_target` — Analyze reverse engineering target

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

### `anti_anti_debug` — Anti-Anti-Debug

**Description:** 反反调试工具集：窗口尺寸/时间函数/页面关闭/历史跳转/控制台清除

**Parameters:**

- `features`

### `break_on_xhr` — Break on XHR

**Description:** Sets a breakpoint that triggers when an XHR/Fetch request URL contains the specified string.

**Parameters:**

- `url`

### `bypass_debugger` — Bypass Debugger

**Description:** 绕过无限 debugger：自动移除 eval/Function/constructor 中的 debugger 关键字

**Parameters:**

- `targets`

### `check_url_matches` — Check URL Matches

**Description:** 检查 URL 匹配：测试给定 URL 会触发哪些已配置的注入脚本

**Parameters:**

- `url`

### `collect_code` — Collect JavaScript code from a page

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

### `collection_diff` — Compare collected code snapshots

**Description:** Compare previous and current collected file summaries.

**Parameters:**

- `previous`
- `current`
- `includeUnchanged`

### `create_hook` — Create hook

**Description:** RECOMMENDED: Create hook script for function/fetch/xhr/property/cookie/websocket/eval/timer. Hooks run without pausing page execution and are the preferred approach over breakpoints for monitoring and interception.

**Parameters:**

- `type`
- `params`
- `description`
- `action`

### `create_inject_script` — Create Inject Script

**Description:** 创建注入脚本：添加一个 URL 匹配的脚本配置，支持后续注入到浏览器页面

**Parameters:**

- `name`
- `urlPattern`
- `code`
- `enabled`

### `delete_inject_script` — Delete Inject Script

**Description:** 删除注入脚本：移除指定的脚本配置

**Parameters:**

- `id`

### `deobfuscate_code` — Deobfuscate JavaScript

**Description:** AI-assisted JavaScript deobfuscation.

**Parameters:**

- `code`
- `aggressive`
- `renameVariables`

### `deobfuscate_code_vj` — Deobfuscate Code

**Description:** 代码解混淆（v_jstools）：对混淆的 JavaScript 代码执行多通道 AST 转换，包括 sojson 解混淆、OB 解混淆、控制流平坦化还原、字符串数组还原、死代码消除等

**Parameters:**

- `code`
- `mode`
- `clearExtra`
- `clearUnused`

### `detect_crypto` — Detect cryptographic patterns

**Description:** Detect cryptographic algorithms/libraries from JavaScript source.

**Parameters:**

- `code`
- `useAI`

### `diff_code` — Diff Code

**Description:** 代码对比：对比两段代码或文本的差异，支持 2-way 对比

**Parameters:**

- `text1`
- `text2`
- `mode`

### `diff_env_requirements` — Compare environment requirements

**Description:** Compare local runtime failures with observed browser capabilities and suggest the next environment patches.

**Parameters:**

- `runtimeError`
- `observedCapabilities`

### `evaluate_on_callframe` — Evaluate on Call Frame

**Description:** Evaluates a JavaScript expression in the context of a specific call frame while paused. This allows you to inspect variables and execute code in the paused scope.

**Parameters:**

- `expression`
- `frameIndex`

### `export_rebuild_bundle` — Export rebuild bundle

**Description:** Export a local Node rebuild bundle from observed reverse-engineering evidence.

**Parameters:**

- `taskSlug`
- `taskId`
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

### `export_session_report` — Export session report

**Description:** Export current reverse-engineering session as JSON or Markdown.

**Parameters:**

- `format`
- `includeHookData`

### `find_in_script` — Find in Script

**Description:** Finds a string in a specific script and returns its exact line/column position with surrounding context. Ideal for setting breakpoints in minified files where the entire code is on one line.

**Parameters:**

- `scriptId`
- `query`
- `contextChars`
- `occurrence`
- `caseSensitive`

### `get_ai_debug_status` — Get AI Debug Status

**Description:** 获取当前 AI 调试会话的状态和统计信息。

### `get_code_template` — Get Code Template

**Description:** 获取代码模板：返回 v_jstools 中预置的常用 JS 逆向代码模板，包括 CryptoJS、JSEncrypt、Cheerio、Babel AST、Terser 等

**Parameters:**

- `name`

### `get_hook_data` — Get hook captured data

**Description:** Get captured data for one hook or all hooks. Supports raw view and summary view for noise reduction.

**Parameters:**

- `hookId`
- `view`
- `maxRecords`

### `get_paused_info` — Get Paused Info

**Description:** Gets information about the current paused state including call stack, current location, and scope variables. Use this after a breakpoint is hit to understand the execution context.

**Parameters:**

- `includeScopes`
- `maxScopeDepth`

### `get_request_initiator` — Get Request Initiator

**Description:** Gets the JavaScript call stack that initiated a network request. This helps trace which code triggered an API call.

**Parameters:**

- `requestId`
- `taskId`
- `taskSlug`
- `targetUrl`
- `goal`

### `get_script_source` — Get Script Source

**Description:** Gets the source code of a JavaScript script by its script ID. Supports line range (for normal files) or character offset (for minified single-line files). Use list_scripts first to find the script ID.

**Parameters:**

- `scriptId`
- `startLine`
- `endLine`
- `offset`
- `length`

### `get_storage` — Get Storage

**Description:** Gets browser storage data including cookies, localStorage, and sessionStorage.

**Parameters:**

- `type`
- `filter`

### `hook_function` — Hook Function

**Description:** RECOMMENDED for reverse engineering: Hooks a JavaScript function to log its calls, arguments, and return values without pausing execution. More reliable than breakpoints for automated workflows. Use this as the default approach for monitoring functions.

**Parameters:**

- `target`
- `logArgs`
- `logResult`
- `logStack`
- `hookId`

### `inject_hook` — Inject hook

**Description:** Inject an existing hook into the current page.

**Parameters:**

- `hookId`

### `inject_stealth` — Inject stealth scripts

**Description:** Inject anti-detection stealth scripts to current page.

**Parameters:**

- `preset`

### `inspect_object` — Inspect Object

**Description:** Deeply inspects a JavaScript object, showing its properties, prototype chain, and methods. Useful for understanding object structure.

**Parameters:**

- `expression`
- `depth`
- `showMethods`
- `showPrototype`

### `invoke-skill` — Invoke skill

**Description:** 调用已注册的逆向工程技能（observe-flow, auto-hook, rebuild-bundle）

**Parameters:**

- `skillName`
- `options`
- `url`

### `list_breakpoints` — List Breakpoints

**Description:** Lists all active breakpoints in the current debugging session.

### `list_code_templates` — List Code Templates

**Description:** 列出所有可用的代码模板，包括 CryptoJS、JSEncrypt、Cheerio、Babel AST 等常用库

### `list_created_hooks` — List created hooks

**Description:** List all hooks created via create_hook with their status and record counts.

**Parameters:**

- `verbose`

### `list_hooks` — List Hooks

**Description:** Lists all active function hooks.

### `list_inject_scripts` — List Inject Scripts

**Description:** 列出所有已配置的注入脚本，包括 URL 匹配规则和启用状态

### `list_scripts` — List Scripts

**Description:** Lists all JavaScript scripts loaded in the current page. Returns script ID, URL, and source map information. Use this to find scripts before setting breakpoints or searching.

**Parameters:**

- `filter`

### `list_stealth_features` — List stealth feature toggles

**Description:** List available stealth feature toggles.

### `list_stealth_presets` — List stealth presets

**Description:** List available stealth presets.

### `list-skills` — List skills

**Description:** 列出所有可用的逆向工程技能

### `minify_code` — Minify Code

**Description:** 代码压缩/格式化：使用 Terser 对 JavaScript 代码进行压缩或格式化美化

**Parameters:**

- `code`
- `action`

### `monitor_events` — Monitor Events

**Description:** Monitors DOM events on a specified element or window. Events will be logged to console.

**Parameters:**

- `selector`
- `events`
- `monitorId`
- `taskId`
- `taskSlug`
- `targetUrl`
- `goal`

### `pause` — Pause Execution

**Description:** Pauses JavaScript execution at the current point. Use this to interrupt running code.

### `record_reverse_evidence` — Record reverse engineering evidence

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

### `remove_breakpoint` — Remove Breakpoint

**Description:** Removes a breakpoint by its ID. Use list_breakpoints to see active breakpoints.

**Parameters:**

- `breakpointId`

### `remove_hook` — Remove hook

**Description:** Remove a hook by id.

**Parameters:**

- `hookId`

### `remove_xhr_breakpoint` — Remove XHR Breakpoint

**Description:** Removes an XHR/Fetch breakpoint.

**Parameters:**

- `url`

### `resume` — Resume Execution

**Description:** Resumes JavaScript execution after being paused at a breakpoint. Execution continues until the next breakpoint or completion.

### `risk_panel` — Assess reverse engineering risk

**Description:** Build a combined risk score from analyzer, crypto detector and hook signals.

**Parameters:**

- `code`
- `useAI`
- `includeHookSignals`
- `hookId`
- `topN`

### `search_in_scripts` — Search collected scripts with regex

**Description:** Search in collected script cache with regex pattern.

**Parameters:**

- `pattern`
- `limit`
- `maxTotalSize`

### `search_in_sources` — Search in Sources

**Description:** Searches for a string or regex pattern in all loaded JavaScript sources. Returns matching lines with script ID, URL, and line number. Use get_script_source with startLine/endLine to view full context around matches.

**Parameters:**

- `query`
- `caseSensitive`
- `isRegex`
- `maxResults`
- `maxLineLength`
- `excludeMinified`
- `urlFilter`

### `set_breakpoint` — Set Breakpoint

**Description:** Sets a breakpoint in a JavaScript file at the specified line. The breakpoint will trigger when the code executes. NOTE: Prefer hook_function or create_hook for monitoring function calls — breakpoints require pause/resume coordination and are error-prone in automated workflows. Use breakpoints only when you need to inspect local variables inside a function.

**Parameters:**

- `url`
- `lineNumber`
- `columnNumber`
- `condition`
- `isRegex`

### `set_breakpoint_on_text` — Set Breakpoint on Text

**Description:** Sets a breakpoint on specific code (function name, statement, etc.) by searching for it and automatically determining the exact position. Works with both normal and minified files. NOTE: Prefer hook_function for monitoring function calls — it captures args/results without pausing execution. Use this only when you need to inspect local variables at a specific code location.

**Parameters:**

- `text`
- `urlFilter`
- `occurrence`
- `condition`

### `set_user_agent` — Set user agent

**Description:** Set custom user-agent for active page.

**Parameters:**

- `userAgent`

### `start_continuous_debugging` — Start Continuous Debugging

**Description:** 启动 AI 辅助的连续调试循环。设置 XHR 断点（可选），然后自动分析每个断点并决定下一步。

**Parameters:**

- `targetUrl`
- `xhrBreakPatterns`
- `maxIterations`
- `timeoutMs`
- `aiProvider`
- `model`
- `systemPrompt`

### `step_into` — Step Into

**Description:** Steps into the next function call. Use this to enter and debug function bodies.

### `step_out` — Step Out

**Description:** Steps out of the current function, continuing until the function returns. Use this to quickly exit a function.

### `step_over` — Step Over

**Description:** Steps over to the next statement, treating function calls as a single step. Use this to move through code without entering function bodies.

### `stop_continuous_debugging` — Stop Continuous Debugging

**Description:** 停止正在运行的 AI 连续调试循环。

### `stop_monitor` — Stop Monitor

**Description:** Stops an event monitor.

**Parameters:**

- `monitorId`

### `summarize_code` — Summarize code at scale

**Description:** Summarize one code file, multiple files, or project-level context.

**Parameters:**

- `mode`
- `code`
- `url`
- `files`

### `trace_function` — Trace Function

**Description:** Traces calls to a function by its name in the source code. Works for ANY function including module-internal functions (webpack/rollup bundled). Uses "logpoints" (conditional breakpoints) to log arguments without pausing execution.

**Parameters:**

- `functionName`
- `urlFilter`
- `logArgs`
- `logThis`
- `pause`
- `traceId`
- `taskId`
- `taskSlug`
- `targetUrl`
- `goal`

### `transpile_code` — Transpile Code

**Description:** 代码转译：将 TypeScript/JSX/ES6+ 代码转换为 ES5 JavaScript（使用 Babel）

**Parameters:**

- `code`
- `presets`

### `understand_code` — Analyze code structure and logic

**Description:** Analyze code structure/business/security with AI + static analysis.

**Parameters:**

- `code`
- `focus`

### `unhook_function` — Unhook Function

**Description:** Removes a previously installed function hook.

**Parameters:**

- `hookId`

### `update_inject_script` — Update Inject Script

**Description:** 更新注入脚本：修改已有脚本的代码、名称或启用状态

**Parameters:**

- `id`
- `name`
- `urlPattern`
- `code`
- `enabled`

### `xhr_to_js_breakpoint` — XHR to JS Breakpoint

**Description:** 两阶段断点工作流：先通过 XHR 断点捕获调用栈，然后在顶层用户代码位置设置 JS 断点。

**Parameters:**

- `urlPattern`
- `maxWaitMs`

## Hook & Injection

### `activate_vue_devtools` — Activate Vue Devtools

**Description:** 激活 Vue Devtools：强制启用 Vue.js 开发者工具

### `anti_anti_hook` — Anti-Anti-Hook

**Description:** 反 Hook 检测：保护 Function.prototype.toString，使被 Hook 的方法看起来像原生代码

**Parameters:**

- `hookedMethods`

### `clear_vue_guards` — Clear Vue Guards

**Description:** 清除 Vue Router 全局守卫：beforeEach、beforeResolve

**Parameters:**

- `guards`

### `fixed_window_size` — Fixed Window Size

**Description:** 固定窗口尺寸：拦截 window.innerHeight/innerWidth/outerHeight/outerWidth 的读取和设置

**Parameters:**

- `innerHeight`
- `innerWidth`
- `outerHeight`
- `outerWidth`

### `get_vue_routes` — Get Vue Routes

**Description:** 获取 Vue Router 路由表：已加载的路由配置信息

**Parameters:**

- `includeChildren`
- `maxDepth`

### `hook_console_log` — Hook Console Log

**Description:** Hook console.log：防止网站重写 console.log 方法，保持日志输出能力

**Parameters:**

- `mode`

### `hook_console_protect` — Hook Console Protect

**Description:** 保护 console：防止代码重写 console.log/trace/groupCollapsed/groupEnd 等方法

**Parameters:**

- `protectedMethods`

### `hook_console_table` — Hook Console Table

**Description:** Hook console.table：绕过通过 console.table 检测运行时间差的反调试

**Parameters:**

- `enabled`

### `hook_cookie` — Hook Cookie

**Description:** Hook document.cookie：监控 Cookie 的读写操作，支持过滤特定 Cookie 名

**Parameters:**

- `filterKeys`
- `showStack`
- `triggerDebugger`

### `hook_cryptojs` — Hook CryptoJS

**Description:** Hook CryptoJS 加密库：AES、DES、MD5、SHA 等对称/哈希/HMAC 算法

**Parameters:**

- `algorithms`
- `logFormat`

### `hook_date_now` — Hook Date Now

**Description:** Hook Date.now()：固定 Date.now() 的返回值，支持调用栈打印和 debugger 触发

**Parameters:**

- `fixedValue`
- `showStack`
- `triggerDebugger`

### `hook_fetch` — Hook Fetch

**Description:** Hook window.fetch：监控 fetch API 调用，打印请求参数和堆栈

**Parameters:**

- `showStack`
- `triggerDebugger`

### `hook_history` — Hook History API

**Description:** Hook History API：监控 history.pushState/replaceState 操作，支持 URL 过滤

**Parameters:**

- `filterUrls`
- `showStack`
- `triggerDebugger`

### `hook_jsencrypt` — Hook JSEncrypt

**Description:** Hook JSEncrypt RSA 加密库：公钥/私钥、原始数据、密文

**Parameters:**

- `logFormat`

### `hook_json_parse` — Hook JSON Parse

**Description:** Hook JSON.parse：监控 JSON 解析操作，支持过滤特定字符串

**Parameters:**

- `filterKeys`
- `showStack`
- `triggerDebugger`

### `hook_json_stringify` — Hook JSON Stringify

**Description:** Hook JSON.stringify：监控 JSON 序列化操作

**Parameters:**

- `showStack`
- `triggerDebugger`

### `hook_local_storage` — Hook Local Storage

**Description:** Hook localStorage：监控 setItem/getItem/removeItem/clear 操作，支持过滤特定键

**Parameters:**

- `actions`
- `filterKeys`
- `showStack`
- `triggerDebugger`

### `hook_location_href` — Hook Location Href

**Description:** Hook location.href：阻断页面跳转，触发 debugger 以定位跳转代码位置

**Parameters:**

- `triggerDebugger`

### `hook_performance_now` — Hook Performance Now

**Description:** Hook performance.now()：固定返回值，支持调用栈打印和 debugger 触发

**Parameters:**

- `fixedValue`
- `showStack`
- `triggerDebugger`

### `hook_promise` — Hook Promise

**Description:** Hook Promise：监控 Promise resolve，打印 resolve 参数和调用栈，快速定位异步回调位置

**Parameters:**

- `showStack`
- `triggerDebugger`

### `hook_random` — Hook Random

**Description:** Hook Math.random：固定 Math.random 的返回值

**Parameters:**

- `fixedValue`
- `showStack`
- `triggerDebugger`

### `hook_session_storage` — Hook Session Storage

**Description:** Hook sessionStorage：监控 setItem/getItem/removeItem/clear 操作

**Parameters:**

- `actions`
- `filterKeys`
- `showStack`
- `triggerDebugger`

### `hook_smcrypto` — Hook SM-Crypto

**Description:** Hook SM-crypto 国密库：SM2、SM3、SM4 算法

**Parameters:**

- `algorithms`
- `logFormat`

### `hook_websocket` — Hook WebSocket

**Description:** Hook WebSocket：监控 WebSocket 连接、消息收发操作，支持按 URL 过滤

**Parameters:**

- `filterUrls`
- `showStack`
- `triggerDebugger`

### `hook_xhr_open` — Hook XHR Open

**Description:** Hook XMLHttpRequest.open：监控 XHR 请求初始化，支持过滤特定 URL

**Parameters:**

- `filterUrls`
- `showStack`
- `triggerDebugger`

### `hook_xhr_set_request_header` — Hook XHR Set Request Header

**Description:** Hook XMLHttpRequest.setRequestHeader：监控请求头设置，支持过滤特定 Header 名

**Parameters:**

- `filterKeys`
- `showStack`
- `triggerDebugger`

## Input automation

### `cdp_upload_files` — CDP upload files

**Description:** 向文件输入框上传文件

**Parameters:**

- `selector`
- `files`

### `click` — Click element by CSS selector

**Description:** Clicks on the provided element identified by CSS selector

**Parameters:**

- `selector`
- `dblClick`

### `click_at` — Click at specific coordinates

**Description:** Real mouse click using CDP Input.dispatchMouseEvent. Acts as user gesture, can trigger file dialogs and bypass some anti-automation detection.

**Parameters:**

- `selector`

### `drag` — Drag element onto another element

**Description:** Drag an element onto another element

**Parameters:**

- `fromSelector`
- `toSelector`

### `fill` — Fill text input or select option

**Description:** Type text into an input, text area or select an option from a <select> element

**Parameters:**

- `selector`
- `value`

### `fill_form` — Fill multiple form fields at once

**Description:** Fill out multiple form elements at once

**Parameters:**

- `elements`

### `handle_dialog` — Handle dialog (accept/dismiss)

**Description:** If a browser dialog was opened (alert, confirm, prompt), use this command to handle it. Accepts or dismisses the dialog.

**Parameters:**

- `action`
- `promptText`

### `hover` — Hover over element by CSS selector

**Description:** Hover over the provided element identified by CSS selector

**Parameters:**

- `selector`

### `press_key` — Press a key or key combination

**Description:** Press a key or key combination. Use this when other input methods like fill() cannot be used (e.g., keyboard shortcuts, navigation keys, or special key combinations).

**Parameters:**

- `key`

### `set_files` — Set files on a file input element

**Description:** Set files to a file input element using CDP DOM.setFileInputFiles. Bypasses file chooser dialog completely.

**Parameters:**

- `selector`
- `filePaths`

### `upload_file` — Upload file through file input

**Description:** Upload a file through a file input element

**Parameters:**

- `selector`
- `filePath`

## Emulation

### `emulate_cpu` — Emulate CPU throttling

**Description:** Emulates CPU throttling by slowing down the selected page's execution. Useful for detecting race conditions and timing-dependent issues.

**Parameters:**

- `throttlingRate`

### `emulate_mobile` — Emulate mobile device viewport

**Description:** Emulates mobile device viewport, user-agent, and touch events. Use this to test mobile layouts and touch interactions.

**Parameters:**

- `enable`
- `device`

### `emulate_network` — Emulate network conditions

**Description:** Emulates network conditions such as throttling or offline mode on the selected page. Available options: No emulation, Offline, Slow 3G, Fast 3G, Slow 4G, Fast 4G

**Parameters:**

- `throttlingOption`

### `resize_page` — Resize browser window dimensions

**Description:** Resizes the browser window so that the page has specified dimensions. Useful for testing responsive layouts and mobile views.

**Parameters:**

- `width`
- `height`

## Performance

### `get_performance_metrics` — Get performance metrics

**Description:** Gets page performance metrics from the Performance API, including navigation timing, resource timing, and paint events.

### `performance_analyze_insight` — Analyze performance insight

**Description:** Provides more detailed information on a specific Performance Insight that was highlighted in the results of a trace recording.

**Parameters:**

- `insightName`

### `start_performance_trace` — Start performance trace

**Description:** Starts a performance trace recording on the selected page. This can be used to look for performance problems and insights to improve the performance of the page. It will also report Core Web Vital (CWV) scores for the page.

**Parameters:**

- `reload`
- `autoStop`

### `stop_performance_trace` — Stop performance trace

**Description:** Stops the active performance trace recording on the selected page and analyzes the results.

## DOM manipulation

### `cdp_click` — CDP click element

**Description:** 点击当前选中页面中的元素（JS click）

**Parameters:**

- `selector`

### `cdp_click_at` — CDP click at coordinates

**Description:** 使用真实鼠标事件点击元素（可触发文件对话框等）

**Parameters:**

- `selector`

### `cdp_eval` — CDP evaluate JavaScript

**Description:** 在当前选中的页面中执行 JavaScript 表达式

**Parameters:**

- `expr`

### `cdp_scroll` — CDP scroll

**Description:** 滚动当前选中的页面

**Parameters:**

- `y`
- `direction`

## Screenshot

### `cdp_screenshot` — CDP screenshot

**Description:** 对当前选中的页面截图

**Parameters:**

- `file`
- `type`
- `fullPage`

## Pages

### `cdp_close_page` — Close CDP page

**Description:** 关闭指定的页面

**Parameters:**

- `pageIdx`

### `cdp_get_targets` — Get CDP targets

**Description:** 获取所有可用的页面 target 列表

### `cdp_navigate` — CDP navigate

**Description:** 在当前选中的页面中导航到指定 URL

**Parameters:**

- `url`

### `cdp_new_page` — Create new CDP page

**Description:** 创建一个新的后台页面

**Parameters:**

- `url`

### `cdp_page_info` — CDP page info

**Description:** 获取当前选中页面的基本信息

### `cdp_start_proxy` — Start CDP proxy

**Description:** 启动 CDP Proxy HTTP 服务器，允许通过 HTTP API 操控浏览器。代理运行在 localhost:3456。

**Parameters:**

- `port`

## Data

### `create_site_experience` — Create site experience

**Description:** 创建新的站点经验记录

**Parameters:**

- `domain`
- `name`
- `aliases`
- `platformFeatures`
- `validPatterns`
- `knownPitfalls`

### `delete_site_experience` — Delete site experience

**Description:** 删除站点经验记录

**Parameters:**

- `id`

### `list_site_experiences` — List site experiences

**Description:** 列出所有已保存的站点经验

### `search_site_experience` — Search site experience

**Description:** 按 URL 或名称搜索站点经验。支持从完整 URL 自动提取域名进行匹配。

**Parameters:**

- `url`
- `name`

### `update_site_experience` — Update site experience

**Description:** 更新现有的站点经验记录

**Parameters:**

- `id`
- `name`
- `aliases`
- `platformFeatures`
- `validPatterns`
- `knownPitfalls`

