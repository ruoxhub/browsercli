<!-- AUTO GENERATED DO NOT EDIT - run 'npm run docs' to update-->

# Browser-CLI Tool Reference

> 快速按逆向目标查工具，请先看：[`reverse-task-index.md`](./reverse-task-index.md)

- **[Navigation automation](#navigation-automation)** (6 tools)
  - [`close_page`](#close_page)
  - [`list_pages`](#list_pages)
  - [`navigate_page`](#navigate_page)
  - [`new_page`](#new_page)
  - [`select_page`](#select_page)
  - [`wait_for`](#wait_for)
- **[Network](#network)** (9 tools)
  - [`analyze_websocket_messages`](#analyze_websocket_messages)
  - [`clear_network_requests`](#clear_network_requests)
  - [`get_network_request`](#get_network_request)
  - [`get_websocket_message`](#get_websocket_message)
  - [`get_websocket_messages`](#get_websocket_messages)
  - [`list_network_requests`](#list_network_requests)
  - [`list_websocket_connections`](#list_websocket_connections)
  - [`mock_network`](#mock_network)
  - [`remove_network_mock`](#remove_network_mock)
- **[Debugging](#debugging)** (23 tools)
  - [`debugger_disable`](#debugger_disable)
  - [`debugger_step`](#debugger_step)
  - [`debugger_wait_for_paused`](#debugger_wait_for_paused)
  - [`evaluate_on_callframe`](#evaluate_on_callframe)
  - [`evaluate_script`](#evaluate_script)
  - [`get_console_message`](#get_console_message)
  - [`get_css_styles`](#get_css_styles)
  - [`get_paused_info`](#get_paused_info)
  - [`list_breakpoints`](#list_breakpoints)
  - [`list_console_messages`](#list_console_messages)
  - [`list_frames`](#list_frames)
  - [`pause`](#pause)
  - [`record_start`](#record_start)
  - [`record_stop`](#record_stop)
  - [`remove_breakpoint`](#remove_breakpoint)
  - [`resume`](#resume)
  - [`reveal_in_devtools`](#reveal_in_devtools)
  - [`screencast_start`](#screencast_start)
  - [`screencast_stop`](#screencast_stop)
  - [`select_frame`](#select_frame)
  - [`set_breakpoint`](#set_breakpoint)
  - [`set_logpoints`](#set_logpoints)
  - [`take_screenshot`](#take_screenshot)
- **[JS Reverse Engineering](#js-reverse-engineering)** (27 tools)
  - [`anti_anti_debug`](#anti_anti_debug)
  - [`break_on_xhr`](#break_on_xhr)
  - [`bypass_debugger`](#bypass_debugger)
  - [`collect_code`](#collect_code)
  - [`collect_wasm`](#collect_wasm)
  - [`collection_diff`](#collection_diff)
  - [`create_hook`](#create_hook)
  - [`dump_target_scripts`](#dump_target_scripts)
  - [`get_hook_data`](#get_hook_data)
  - [`get_request_initiator`](#get_request_initiator)
  - [`get_script_source`](#get_script_source)
  - [`get_storage`](#get_storage)
  - [`inject_hook`](#inject_hook)
  - [`inspect_object`](#inspect_object)
  - [`list_created_hooks`](#list_created_hooks)
  - [`list_persistent_hooks`](#list_persistent_hooks)
  - [`list_scripts`](#list_scripts)
  - [`list_targets`](#list_targets)
  - [`monitor_events`](#monitor_events)
  - [`remove_hook`](#remove_hook)
  - [`remove_xhr_breakpoint`](#remove_xhr_breakpoint)
  - [`search_in_sources`](#search_in_sources)
  - [`set_breakpoint_on_text`](#set_breakpoint_on_text)
  - [`stop_monitor`](#stop_monitor)
  - [`trace_function`](#trace_function)
  - [`wasm_dump`](#wasm_dump)
  - [`wasm_vmp_trace`](#wasm_vmp_trace)
- **[Input automation](#input-automation)** (11 tools)
  - [`click`](#click)
  - [`click_at`](#click_at)
  - [`drag`](#drag)
  - [`fill`](#fill)
  - [`fill_form`](#fill_form)
  - [`handle_dialog`](#handle_dialog)
  - [`hover`](#hover)
  - [`press_key`](#press_key)
  - [`scroll_by`](#scroll_by)
  - [`upload_file`](#upload_file)
  - [`wait_for_element`](#wait_for_element)
- **[Emulation](#emulation)** (2 tools)
  - [`emulate`](#emulate)
  - [`resize_page`](#resize_page)
- **[DOM manipulation](#dom-manipulation)** (4 tools)
  - [`find_clickable_elements`](#find_clickable_elements)
  - [`get_dom_structure`](#get_dom_structure)
  - [`query_dom`](#query_dom)
  - [`take_snapshot`](#take_snapshot)
- **[Pages](#pages)** (2 tools)
  - [`check_browser_health`](#check_browser_health)
  - [`detect_captcha`](#detect_captcha)
- **[Diagnostics](#diagnostics)** (1 tools)
  - [`diagnose_environment`](#diagnose_environment)
- **[Extensions](#extensions)** (5 tools)
  - [`install_extension`](#install_extension)
  - [`list_extensions`](#list_extensions)
  - [`reload_extension`](#reload_extension)
  - [`trigger_extension_action`](#trigger_extension_action)
  - [`uninstall_extension`](#uninstall_extension)

## Navigation automation

### `close_page` — 关闭页面

**Description:** 关闭指定页面（支持 pageId 或 pageIdx）。浏览器中的最后一个打开页面无法关闭。

**Parameters:**

- `pageId`
- `pageIdx`

### `list_pages` — 列出页面

**Description:** 列出浏览器中所有已打开的页面及其稳定 pageId、URL 与标题。调用页级工具时可通过 --pageId 指定标签页，或用 select_page 切换默认页面。

### `navigate_page` — 导航页面

**Description:** 导航当前页面，支持 URL 导航、后退、前进与刷新，支持注入 initScript 与自动处理 beforeunload 弹窗。

**Parameters:**

- `type`
- `url`
- `ignoreCache`
- `handleBeforeUnload`
- `initScript`
- `timeout`
- `pageId`

### `new_page` — 新建页面

**Description:** 创建新的浏览器页面并导航到指定 URL；默认自动选中新页面，也可在后台或独立上下文中打开。

**Parameters:**

- `url`
- `timeout`
- `background`
- `isolatedContext`
- `preloadHook`
- `preloadPreset`

### `select_page` — 选择页面

**Description:** 按 pageId 选择页面并将其设为当前上下文，可选是否把窗口带到前台（默认不切换前台标签）。请先使用 list_pages 获取 pageId。

**Parameters:**

- `pageId`
- `pageIdx`
- `bringToFront`

### `wait_for` — 等待文本出现

**Description:** 等待指定文本出现在当前页面中（支持多个候选文本，命中任一即返回）。默认同时匹配隐藏文本；设置 visible=true 仅匹配可见文本。

**Parameters:**

- `text`
- `timeout`
- `visible`
- `includeSnapshot`
- `pageId`

## Network

### `analyze_websocket_messages` — analyze_websocket_messages

**Description:** 分析 WebSocket 消息并按模式/指纹分组。对于理解直播等场景中的二进制/protobuf 消息类型至关重要。返回每种消息类型的统计信息与样本索引。

**Parameters:**

- `wsid`
- `direction`
- `pageId`

### `clear_network_requests` — clear_network_requests

**Description:** 清空当前选中页面（或指定页面）的缓存网络请求。清空后，list_network_requests 返回的请求列表将为空，稳定的请求 ID 将从 1 重新编号。

**Parameters:**

- `targetPageIdx`
- `targetPageId`
- `pageId`

### `get_network_request` — get_network_request

**Description:** 按可选的 reqid 获取网络请求；若省略则返回 DevTools Network 面板中当前选中的请求。

**Parameters:**

- `reqid`
- `maxBodyLength`
- `fullBody`
- `saveTo`
- `requestFilePath`
- `responseFilePath`
- `pageId`

### `get_websocket_message` — get_websocket_message

**Description:** 按帧索引获取单条 WebSocket 消息。请先使用 get_websocket_messages 或 analyze_websocket_messages 找到帧索引。

**Parameters:**

- `wsid`
- `frameIndex`
- `decode`
- `pageId`

### `get_websocket_messages` — get_websocket_messages

**Description:** 获取 WebSocket 连接的消息。重要：对于二进制/protobuf 消息（如直播流），请先使用 analyze_websocket_messages 理解消息类型，再用 groupId 参数筛选特定类型。默认模式仅显示摘要。

**Parameters:**

- `wsid`
- `direction`
- `groupId`
- `pageSize`
- `pageIdx`
- `show_content`
- `pageId`

### `list_network_requests` — list_network_requests

**Description:** 列出当前选中页面自上次导航以来的请求。默认隐藏浏览器扩展请求；支持按资源类型、请求头关键字、分页过滤，以及等待匹配的请求。

**Parameters:**

- `pageSize`
- `pageIdx`
- `resourceTypes`
- `includePreservedRequests`
- `includeExtensionRequests`
- `targetPageIdx`
- `targetPageId`
- `waitForRequest`
- `waitTimeoutMs`
- `headerFilter`
- `urlFilter`
- `includeSignatureEvidence`
- `pageId`

### `list_websocket_connections` — list_websocket_connections

**Description:** 列出所有 WebSocket 连接。获取 wsid 后，请先使用 analyze_websocket_messages(wsid) 理解消息模式，再查看单条消息。

**Parameters:**

- `pageSize`
- `pageIdx`
- `urlFilter`
- `includePreservedConnections`
- `pageId`

### `mock_network` — 网络Mock拦截

**Description:** Inspect or update network mocks for the selected page. With no action params, lists existing mocks. Providing abort, allowOrigin, body (local file), or upstream (replacement URL) creates/updates a mock rule.

**Parameters:**

- `route`
- `resourceType`
- `abort`
- `allowOrigin`
- `body`
- `upstream`
- `pageId`

### `remove_network_mock` — 移除网络Mock

**Description:** Remove network mocks matching the supplied stored route and/or resourceType. Omit both filters to remove all mocks for the page.

**Parameters:**

- `route`
- `resourceType`
- `pageId`

## Debugging

### `debugger_disable` — 关闭调试器

**Description:** 关闭当前调试会话，自动恢复暂停中的页面并移除断点、清理调试监听器。

**Parameters:**

- `pageId`

### `debugger_step` — 单步调试

**Description:** 在当前暂停的调用帧上执行单步调试（into / over / out），并返回更新后的暂停状态与调用栈。

**Parameters:**

- `direction`
- `includePausedInfo`
- `includeScopes`
- `timeout`
- `pageId`

### `debugger_wait_for_paused` — 等待断点暂停

**Description:** 不占用页面执行队列地等待下一次 JavaScript 暂停事件（如断点触发或待决 pause），返回暂停原因、命中断点与调用栈。

**Parameters:**

- `timeout`
- `includeScopes`
- `pageId`

### `evaluate_on_callframe` — 在调用帧上执行

**Description:** 在暂停时的指定调用帧上下文中执行 JavaScript 表达式。允许检查变量和执行代码。

**Parameters:**

- `expression`
- `frameIndex`
- `pageId`

### `evaluate_script` — evaluate_script

**Description:** 在页面上执行 JavaScript（支持 inline function 或本地 sourcePath 文件，支持按 function / script 模式解释、传入元素 uid args、处理执行期间弹窗及保存到文件）。

**Parameters:**

- `function`
- `sourcePath`
- `format`
- `args`
- `context`
- `frameId`
- `allowAnyFrame`
- `verbose`
- `filePath`
- `dialogAction`
- `waitForStableDom`
- `timeoutMs`
- `pageId`

### `get_console_message` — get_console_message

**Description:** 按 ID 获取单条 Console 消息，返回包含类型、文本与参数的结构化数据。

**Parameters:**

- `msgid`
- `pageId`

### `get_css_styles` — 获取CSS层叠样式

**Description:** 获取指定元素匹配的 CSS 规则、内联样式、伪元素与继承样式及层叠（cascade）信息，支持通过 take_snapshot uid 或定位器指定元素。

**Parameters:**

- `uid`
- `selector`
- `pageSize`
- `pageIdx`
- `pageId`

### `get_paused_info` — 获取暂停信息

**Description:** 获取当前暂停状态信息，包括调用栈、当前位置和作用域变量。在断点命中后使用此工具了解执行上下文；设置 scopeFrames="all" 可额外展开全部调用帧的 local 局部变量摘要。

**Parameters:**

- `includeScopes`
- `scopeFrames`
- `pageId`

### `list_breakpoints` — 列出断点

**Description:** 列出当前调试会话中的所有活跃断点。

**Parameters:**

- `pageId`

### `list_console_messages` — list_console_messages

**Description:** 列出当前选中页面自上次导航以来的所有 Console 消息，支持按类型过滤与分页。

**Parameters:**

- `pageSize`
- `pageIdx`
- `types`
- `includePreservedMessages`
- `includeStackTraces`
- `pageId`

### `list_frames` — 列出 Frame

**Description:** 以树形结构列出当前页面中的所有 Frame（含 iframe），显示索引、名称与 URL。使用 select_frame 可将执行上下文切换到指定 Frame。

**Parameters:**

- `pageId`

### `pause` — 暂停执行

**Description:** 暂停 JavaScript 执行。用于中断运行中的代码。

**Parameters:**

- `pageId`

### `record_start` — 开始轨迹录制

**Description:** 启动用户交互轨迹录制器。在当前活动页面注入监听，实时捕获点击、输入、改动等行为，准备与网络请求关联沉淀 Operation Evidence。

**Parameters:**

- `pageId`

### `record_stop` — 停止轨迹录制

**Description:** 停止用户交互轨迹录制器，提取记录的所有用户点击/输入步骤，并与捕获的网络因果请求关联输出 Operation Evidence。

**Parameters:**

- `pageId`

### `remove_breakpoint` — 移除断点

**Description:** 移除指定 ID 的断点。使用 list_breakpoints 查看活跃断点。

**Parameters:**

- `breakpointId`
- `pageId`

### `resume` — 恢复执行

**Description:** 从暂停状态恢复执行，直到下一个断点或执行结束。

**Parameters:**

- `pageId`

### `reveal_in_devtools` — 高亮元素

**Description:** 在页面上高亮指定元素（相当于 DevTools Elements 面板的节点高亮），持续指定时间后自动消失。用于逆向分析时快速定位目标 DOM。

**Parameters:**

- `selector`
- `durationMs`
- `pageId`

### `screencast_start` — 开始录屏

**Description:** Starts recording a screencast (video) of the target page. The recording stops automatically after maxDurationMs and is written to the file only when it stops, so call screencast_stop to finish it.

**Parameters:**

- `filePath`
- `maxDurationMs`
- `fps`
- `pageId`

### `screencast_stop` — 停止录屏

**Description:** Stops the active screencast recording on the target page.

**Parameters:**

- `pageId`

### `select_frame` — 选择 Frame

**Description:** 选择一个 Frame（索引来自 list_frames）作为 evaluate_script、create_hook、inspect_object 等页面内 JavaScript 执行工具的运行上下文。

**Parameters:**

- `frameIdx`
- `pageId`

### `set_breakpoint` — 设置断点

**Description:** 设置 JavaScript 断点。支持按脚本 URL 或 scriptId（来自 list_scripts / search_in_sources）加行号设置，可选条件表达式。注意：优先使用 create_hook(type="function", inject=true) 或 trace_function 进行监控，断点需要暂停/恢复协调，在自动化流程中容易出错。

**Parameters:**

- `url`
- `scriptId`
- `lineNumber`
- `columnNumber`
- `condition`
- `isRegex`
- `pageId`

### `set_logpoints` — 设置日志点

**Description:** Set the complete set of logpoints on the selected page: logpoints not in the list are removed, new ones are added, and an empty list removes all. Format: <url>:<lineNumber>[:<columnNumber>] <expression>. Output appears in list_console_messages.

**Parameters:**

- `logpoints`
- `pageId`

### `take_screenshot` — 截图

**Description:** 对页面或指定元素（uid / selector）进行截图，支持全页与导出文件。

**Parameters:**

- `format`
- `quality`
- `uid`
- `selector`
- `fullPage`
- `filePath`
- `timeoutMs`
- `pageId`

## JS Reverse Engineering

### `anti_anti_debug` — Anti Anti-Debug

**Description:** 反反调试工具集：固定窗口尺寸、冻结时间、阻止页面关闭、阻止历史导航、阻止控制台清除、隐藏 webdriver 标记。

**Parameters:**

- `features`
- `pageId`

### `break_on_xhr` — 设置 XHR 断点

**Description:** 在 XHR/Fetch 请求 URL 包含指定字符串时触发断点。

**Parameters:**

- `url`
- `pageId`

### `bypass_debugger` — Bypass Debugger

**Description:** 通过移除 eval/Function/constructor 中的 debugger 关键字来绕过无限 debugger 语句。

**Parameters:**

- `targets`
- `pageId`

### `collect_code` — collect_code

**Description:** 从页面收集 JavaScript 代码，支持智能模式（summary/priority/incremental/full）。

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
- `pageId`

### `collect_wasm` — collect_wasm

**Description:** 重新导航到目标 URL，并捕获网络加载与运行时创建的 WebAssembly 模块。

**Parameters:**

- `url`
- `timeout`
- `waitAfterLoadMs`
- `includeRuntimeEvents`
- `maxModules`
- `captureBase64`
- `clearPrevious`
- `pageId`

### `collection_diff` — collection_diff

**Description:** 对比上一次与当前收集到的文件摘要。

**Parameters:**

- `previous`
- `current`
- `includeUnchanged`

### `create_hook` — create_hook

**Description:** 推荐：为 function/fetch/xhr/websocket/property/event/timer/localstorage/cookie/eval/object-method/custom 创建 hook 脚本。Hook 运行时不会暂停页面执行，相比断点是更优的监控与拦截手段。默认仅生成并返回 hookId 与 script 供 inject_hook 使用；设置 inject=true 时可一步注入当前 BrowserPage（可搭配 persistent=true 注册为 PersistentHook）。

**Parameters:**

- `type`
- `params`
- `description`
- `action`
- `hookId`
- `capture`
- `condition`
- `protocolFallback`
- `inject`
- `persistent`
- `pageId`

### `dump_target_scripts` — dump_target_scripts

**Description:** 一次性读取指定 Chromium Target 当前已解析的脚本源码。

**Parameters:**

- `targetId`

### `get_hook_data` — Get Hook Data

**Description:** 获取 Hook 采集到的数据。会先从浏览器同步到 HookManager，再返回数据。支持 raw、summary、detail 三种视图并支持过滤。

**Parameters:**

- `hookId`
- `view`
- `maxRecords`
- `type`
- `event`
- `phase`
- `pageId`

### `get_request_initiator` — 获取请求发起者

**Description:** 获取网络请求的 JavaScript 调用栈（发起者）。帮助追踪哪个代码触发了 API 调用。

**Parameters:**

- `requestId`
- `pageId`

### `get_script_source` — 获取脚本源码

**Description:** 根据脚本 ID 获取 JavaScript 脚本源码的本地缓存路径。触发 CDP 加载并写入临时文件，返回文件路径供后续直接读取。先使用 list_scripts 查找脚本 ID。可选 filePath 参数可将源码写入自定义路径并返回该绝对路径。

**Parameters:**

- `scriptId`
- `locator`
- `filePath`
- `startLine`
- `endLine`
- `pageId`

### `get_storage` — 获取存储

**Description:** 获取浏览器存储数据，包括 HttpOnly cookies、可复制的 Cookie 请求头、localStorage 与 sessionStorage。

**Parameters:**

- `type`
- `filter`
- `pageId`

### `inject_hook` — Inject Hook

**Description:** 向页面注入 Hook。persistent=true 时注册到当前 BrowserContext，并尽力回填当前已有 Frame。

**Parameters:**

- `hookId`
- `script`
- `persistent`
- `world`
- `pageId`

### `inspect_object` — 检查对象

**Description:** 深度检查一个 JavaScript 对象，展示其属性、原型链与方法，便于理解对象结构。

**Parameters:**

- `expression`
- `depth`
- `showMethods`
- `showPrototype`
- `pageId`

### `list_created_hooks` — List Created Hooks

**Description:** 列出 HookManager 中所有已创建的 hook。可选地同步浏览器端数据以统计记录数。

**Parameters:**

- `hookId`
- `verbose`
- `syncFromBrowser`
- `type`
- `event`
- `phase`
- `pageId`

### `list_persistent_hooks` — List Persistent Hooks

**Description:** 列出当前 BrowserContext 中已注册的持久 Hook。

### `list_scripts` — 列出脚本

**Description:** 列出当前页面加载的所有 JavaScript 脚本。返回脚本 ID、URL 和 Source Map 信息。在设置断点或搜索前使用此工具查找脚本。

**Parameters:**

- `filter`
- `pageId`

### `list_targets` — list_targets

**Description:** 列出 Chromium 当前可见的 Target 及其脚本快照能力。

### `monitor_events` — 监控事件

**Description:** 监控指定元素或 window 上的 DOM 事件，事件将输出到控制台。

**Parameters:**

- `selector`
- `events`
- `monitorId`
- `pageId`

### `remove_hook` — remove_hook

**Description:** 按 ID 移除 hook：从进程内 HookManager 与 PageHookStore 删除，并在浏览器侧还原已包裹的 PageHook 原函数引用、清理 __hookStore 数据。

**Parameters:**

- `hookId`
- `cleanBrowser`
- `pageId`

### `remove_xhr_breakpoint` — 移除 XHR 断点

**Description:** 移除 XHR/Fetch 断点。

**Parameters:**

- `url`
- `pageId`

### `search_in_sources` — 在源码中搜索

**Description:** 在已加载的 JavaScript 源码中搜索字符串或正则表达式。全局搜索每条匹配返回脚本 ID、行号与源码缓存路径（sourcePath）；传入 scriptId 时进入单脚本精确定位模式，返回精确列号（columnNumber）、字符偏移与上下文片段（适用于压缩单行文件设断点）。可选 filePath 参数（目录）可将每个匹配脚本的源码写入该目录（<filePath>/<scriptId>.js）并返回绝对路径。

**Parameters:**

- `query`
- `scriptId`
- `occurrence`
- `contextChars`
- `caseSensitive`
- `isRegex`
- `maxResults`
- `excludeMinified`
- `urlFilter`
- `source`
- `filePath`
- `pageId`

### `set_breakpoint_on_text` — 在文本上设置断点

**Description:** 在指定代码文本（函数名、语句等）上设置断点，通过搜索自动确定精确位置。适用于正常和压缩文件。注意：优先使用 create_hook(type="function", inject=true) 监控函数调用 — 它无需暂停执行即可捕获参数/返回值。仅在需要检查特定代码位置的局部变量时使用此工具。

**Parameters:**

- `text`
- `urlFilter`
- `occurrence`
- `condition`
- `pageId`

### `stop_monitor` — 停止监控

**Description:** 停止指定的事件监控。

**Parameters:**

- `monitorId`
- `pageId`

### `trace_function` — 追踪函数

**Description:** 追踪源码中指定名称的函数调用。适用于任何函数（包括 webpack/rollup 打包的内部函数）。使用"日志点"（条件断点）记录参数而不暂停执行。

**Parameters:**

- `target`
- `urlFilter`
- `logArgs`
- `logResult`
- `logStack`
- `hookId`
- `pageId`

### `wasm_dump` — wasm_dump

**Description:** 将捕获的 Wasm 模块导出为磁盘上的 .wasm 文件。

**Parameters:**

- `moduleIndex`
- `outputPath`

### `wasm_vmp_trace` — wasm_vmp_trace

**Description:** 追踪由 JS-Wasm 边界 hook 捕获的 Wasm 运行时事件，默认从当前页面增量拉取最新事件，可选按模块过滤。

**Parameters:**

- `maxEvents`
- `filterModule`
- `refresh`
- `pageId`

## Input automation

### `click` — 点击元素

**Description:** 点击页面元素，支持单击与双击。支持由 take_snapshot 产生的 uid（推荐）或传统定位器（CSS、role=、text=、xpath=）。

**Parameters:**

- `uid`
- `selector`
- `dblClick`
- `includeSnapshot`
- `timeoutMs`
- `pageId`

### `click_at` — 坐标点击

**Description:** 使用 CDP Input.dispatchMouseEvent 在指定视口坐标 (x, y) 或元素 (uid/selector) 中心处派发真实鼠标点击事件，适用于 Canvas 或普通点击被拦截的场景。

**Parameters:**

- `x`
- `y`
- `uid`
- `selector`
- `dblClick`
- `includeSnapshot`
- `pageId`

### `drag` — 拖拽元素

**Description:** 通过鼠标事件将元素从源位置（fromUid/fromSelector）拖拽到目标位置（toUid/toSelector）。

**Parameters:**

- `fromUid`
- `toUid`
- `fromSelector`
- `toSelector`
- `includeSnapshot`
- `pageId`

### `fill` — 填充输入

**Description:** 向输入或选择控件填入值，<select> 自动调用 selectOption，复选框/开关/单选支持布尔值切换。支持由 take_snapshot 产生的 uid（推荐）或传统定位器。

**Parameters:**

- `uid`
- `selector`
- `value`
- `includeSnapshot`
- `timeoutMs`
- `pageId`

### `fill_form` — 批量填充表单

**Description:** 在一次调用中批量填充多个表单元素，每个条目支持通过 uid（推荐）或 selector 定位，自动处理 <select> 与复选框。

**Parameters:**

- `elements`
- `includeSnapshot`
- `timeoutMs`
- `pageId`

### `handle_dialog` — handle_dialog

**Description:** 处理浏览器弹窗（alert/confirm/prompt），可接收或取消。

**Parameters:**

- `action`
- `promptText`
- `pageId`

### `hover` — 悬停元素

**Description:** 将鼠标悬停在指定元素上。支持由 take_snapshot 产生的 uid（推荐）或传统定位器（CSS、role=、text=、xpath=）。

**Parameters:**

- `uid`
- `selector`
- `includeSnapshot`
- `pageId`

### `press_key` — 按键

**Description:** 按下键盘按键或组合键（如 "Enter"、"Control+A"、"Alt+Shift+F"），支持修饰键。

**Parameters:**

- `key`
- `includeSnapshot`
- `pageId`

### `scroll_by` — scroll_by

**Description:** 按方向（up/down/top/bottom）滚动页面，并自动等待 800ms 以触发懒加载内容。

**Parameters:**

- `direction`
- `pixels`
- `pageId`

### `upload_file` — 上传文件

**Description:** 向 file input 元素上传单个或多个文件，支持 uid（推荐）与 selector 双模定位；依次尝试 Playwright 原生 setInputFiles、filechooser 事件模式及 CDP DOM.setFileInputFiles 三级降级。

**Parameters:**

- `uid`
- `selector`
- `filePath`
- `filePaths`
- `includeSnapshot`
- `pageId`

### `wait_for_element` — wait_for_element

**Description:** 等待定位器对应的元素出现在页面中。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`
- `timeout`
- `pageId`

## Emulation

### `emulate` — 环境仿真

**Description:** Emulates various features on the target page (network, CPU throttling, geolocation, userAgent, media features, viewport, extraHttpHeaders). Each call replaces all emulation settings (except extraHttpHeaders), so pass all desired settings in a single call.

**Parameters:**

- `networkConditions`
- `cpuThrottlingRate`
- `geolocation`
- `userAgent`
- `colorScheme`
- `forcedColors`
- `prefersContrast`
- `prefersReducedMotion`
- `viewport`
- `extraHttpHeaders`
- `pageId`

### `resize_page` — resize_page

**Description:** 将页面视口调整为指定的宽度与高度。

**Parameters:**

- `width`
- `height`
- `pageId`

## DOM manipulation

### `find_clickable_elements` — 查找可点击元素

**Description:** 查找当前页面中可点击的按钮与链接，可按文本内容过滤，返回选择器、文本、类型、可见性与包围盒。

**Parameters:**

- `filterText`
- `pageId`

### `get_dom_structure` — 获取DOM结构

**Description:** 获取当前页面的 DOM 树结构，返回包含标签名、ID、类名及可选文本内容的层级树。

**Parameters:**

- `maxDepth`
- `includeText`
- `pageId`

### `query_dom` — 查询DOM元素

**Description:** 通过定位器查询一个或多个 DOM 元素，返回包含标签、属性、包围盒与可见性的结构化信息。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`
- `all`
- `limit`
- `pageId`

### `take_snapshot` — 获取页面语义快照

**Description:** 获取当前页面的紧凑无障碍语义快照（TextSnapshot）。为每个交互控件分配数字 UID（如 1_4），可直接用于 click、fill、hover 等操作，支持保存到文件以节省上下文。

**Parameters:**

- `mode`
- `verbose`
- `interestingOnly`
- `filePath`
- `pageId`

## Pages

### `check_browser_health` — check_browser_health

**Description:** 检查浏览器连接健康状态与页面可用性。

### `detect_captcha` — detect_captcha

**Description:** 只读评估当前页面是否存在 CAPTCHA，并可等待挑战稳定清除；不会自动求解或操作页面。

**Parameters:**

- `action`
- `timeout`
- `pageId`

## Diagnostics

### `diagnose_environment` — diagnose_environment

**Description:** 运行环境诊断，检查 Node 版本、构建产物与 artifacts 目录状态。

**Parameters:**

- `checks`

## Extensions

### `install_extension` — install_extension

**Description:** Installs a Chrome extension from the given path.

**Parameters:**

- `path`

### `list_extensions` — list_extensions

**Description:** Lists all the Chrome extensions installed in the browser. This includes their name, ID, version, and enabled status.

### `reload_extension` — reload_extension

**Description:** Reloads an unpacked Chrome extension by its ID.

**Parameters:**

- `id`

### `trigger_extension_action` — trigger_extension_action

**Description:** Triggers the default action of an extension by its ID.

**Parameters:**

- `id`

### `uninstall_extension` — uninstall_extension

**Description:** Uninstalls a Chrome extension by its ID.

**Parameters:**

- `id`
