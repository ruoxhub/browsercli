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
- **[Network](#network)** (30 tools)
  - [`analyze_websocket_messages`](#analyze_websocket_messages)
  - [`clear_mitm_requests`](#clear_mitm_requests)
  - [`clear_network_requests`](#clear_network_requests)
  - [`export_mitm_ca`](#export_mitm_ca)
  - [`export_request_as_curl`](#export_request_as_curl)
  - [`get_mitm_request`](#get_mitm_request)
  - [`get_network_request`](#get_network_request)
  - [`get_websocket_message`](#get_websocket_message)
  - [`get_websocket_messages`](#get_websocket_messages)
  - [`list_mitm_requests`](#list_mitm_requests)
  - [`list_network_requests`](#list_network_requests)
  - [`list_websocket_connections`](#list_websocket_connections)
  - [`mitm_add_host_filter`](#mitm_add_host_filter)
  - [`mitm_add_rule`](#mitm_add_rule)
  - [`mitm_clear_host_filters`](#mitm_clear_host_filters)
  - [`mitm_clear_rules`](#mitm_clear_rules)
  - [`mitm_configure_local_apps`](#mitm_configure_local_apps)
  - [`mitm_export_har`](#mitm_export_har)
  - [`mitm_list_host_filters`](#mitm_list_host_filters)
  - [`mitm_list_local_processes`](#mitm_list_local_processes)
  - [`mitm_list_rules`](#mitm_list_rules)
  - [`mitm_remove_host_filter`](#mitm_remove_host_filter)
  - [`mitm_remove_rule`](#mitm_remove_rule)
  - [`replay_network_request`](#replay_network_request)
  - [`replay_network_request_batch`](#replay_network_request_batch)
  - [`session_create`](#session_create)
  - [`session_get_data`](#session_get_data)
  - [`session_list`](#session_list)
  - [`start_mitm_proxy`](#start_mitm_proxy)
  - [`stop_mitm_proxy`](#stop_mitm_proxy)
- **[Debugging](#debugging)** (27 tools)
  - [`capture_video_frame`](#capture_video_frame)
  - [`evaluate_on_callframe`](#evaluate_on_callframe)
  - [`evaluate_script`](#evaluate_script)
  - [`get_ai_debug_status`](#get_ai_debug_status)
  - [`get_console_message`](#get_console_message)
  - [`get_css_styles`](#get_css_styles)
  - [`get_devtools_comments`](#get_devtools_comments)
  - [`get_paused_info`](#get_paused_info)
  - [`get_video_info`](#get_video_info)
  - [`inject_preload_script`](#inject_preload_script)
  - [`inspect_locals`](#inspect_locals)
  - [`list_breakpoints`](#list_breakpoints)
  - [`list_console_messages`](#list_console_messages)
  - [`list_frames`](#list_frames)
  - [`open_devtools`](#open_devtools)
  - [`pause`](#pause)
  - [`remove_breakpoint`](#remove_breakpoint)
  - [`resolve_devtools_comment`](#resolve_devtools_comment)
  - [`resume`](#resume)
  - [`reveal_in_devtools`](#reveal_in_devtools)
  - [`seek_video`](#seek_video)
  - [`select_frame`](#select_frame)
  - [`set_breakpoint`](#set_breakpoint)
  - [`step_into`](#step_into)
  - [`step_out`](#step_out)
  - [`step_over`](#step_over)
  - [`take_screenshot`](#take_screenshot)
- **[JS Reverse Engineering](#js-reverse-engineering)** (50 tools)
  - [`analyze_pipeline`](#analyze_pipeline)
  - [`anti_anti_debug`](#anti_anti_debug)
  - [`auto_hook`](#auto_hook)
  - [`break_on_xhr`](#break_on_xhr)
  - [`bypass_debugger`](#bypass_debugger)
  - [`collect_code`](#collect_code)
  - [`collect_wasm`](#collect_wasm)
  - [`collection_diff`](#collection_diff)
  - [`compare_env`](#compare_env)
  - [`create_hook`](#create_hook)
  - [`dump_target_scripts`](#dump_target_scripts)
  - [`export_session_report`](#export_session_report)
  - [`find_in_script`](#find_in_script)
  - [`get_hook_data`](#get_hook_data)
  - [`get_request_initiator`](#get_request_initiator)
  - [`get_script_source`](#get_script_source)
  - [`get_storage`](#get_storage)
  - [`hook_cryptojs`](#hook_cryptojs)
  - [`hook_function`](#hook_function)
  - [`hook_jsencrypt`](#hook_jsencrypt)
  - [`hook_jsvmp_interpreter`](#hook_jsvmp_interpreter)
  - [`hook_smcrypto`](#hook_smcrypto)
  - [`inject_hook`](#inject_hook)
  - [`inject_stealth`](#inject_stealth)
  - [`inspect_object`](#inspect_object)
  - [`list_created_hooks`](#list_created_hooks)
  - [`list_hooks`](#list_hooks)
  - [`list_persistent_hooks`](#list_persistent_hooks)
  - [`list_scripts`](#list_scripts)
  - [`list_stealth_features`](#list_stealth_features)
  - [`list_stealth_presets`](#list_stealth_presets)
  - [`list_targets`](#list_targets)
  - [`monitor_events`](#monitor_events)
  - [`observe_flow`](#observe_flow)
  - [`rebuild_bundle`](#rebuild_bundle)
  - [`record_reverse_evidence`](#record_reverse_evidence)
  - [`remove_hook`](#remove_hook)
  - [`remove_xhr_breakpoint`](#remove_xhr_breakpoint)
  - [`search_in_scripts`](#search_in_scripts)
  - [`search_in_sources`](#search_in_sources)
  - [`set_breakpoint_on_text`](#set_breakpoint_on_text)
  - [`set_user_agent`](#set_user_agent)
  - [`stop_monitor`](#stop_monitor)
  - [`trace_function`](#trace_function)
  - [`trace_signature_generation`](#trace_signature_generation)
  - [`unhook_function`](#unhook_function)
  - [`wasm_dump`](#wasm_dump)
  - [`wasm_memory_inspect`](#wasm_memory_inspect)
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
- **[Pages](#pages)** (10 tools)
  - [`check_browser_health`](#check_browser_health)
  - [`delete_session_state`](#delete_session_state)
  - [`detect_captcha`](#detect_captcha)
  - [`dump_session_state`](#dump_session_state)
  - [`handle_dialog`](#handle_dialog)
  - [`list_session_states`](#list_session_states)
  - [`load_session_state`](#load_session_state)
  - [`restore_session_state`](#restore_session_state)
  - [`save_session_state`](#save_session_state)
  - [`update_extensions`](#update_extensions)
- **[Diagnostics](#diagnostics)** (1 tools)
  - [`diagnose_environment`](#diagnose_environment)

## Navigation automation

### `click` — 点击元素

**Description:** 点击页面元素，支持单击与双击。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`
- `dblClick`
- `timeoutMs`

### `click_at` — 坐标点击

**Description:** 使用 CDP Input.dispatchMouseEvent 在元素中心坐标处派发真实鼠标点击事件，适用于 Playwright 点击被拦截的场景。

**Parameters:**

- `selector`

### `drag` — 拖拽元素

**Description:** 通过鼠标事件将元素从源定位器拖拽到目标定位器。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `fromSelector`
- `toSelector`

### `fill` — 填充输入

**Description:** 向输入元素填入值，<select> 会通过 selectOption 自动处理。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`
- `value`
- `timeoutMs`

### `fill_form` — 批量填充表单

**Description:** 在一次调用中批量填充多个表单元素，每个条目指定定位器与值，<select> 通过 selectOption 自动处理。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `elements`
- `timeoutMs`

### `find_clickable_elements` — 查找可点击元素

**Description:** 查找当前页面中可点击的按钮与链接，可按文本内容过滤，返回选择器、文本、类型、可见性与包围盒。

**Parameters:**

- `filterText`

### `get_dom_structure` — 获取DOM结构

**Description:** 获取当前页面的 DOM 树结构，返回包含标签名、ID、类名及可选文本内容的层级树。

**Parameters:**

- `maxDepth`
- `includeText`

### `hover` — 悬停元素

**Description:** 将鼠标悬停在指定元素上。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`

### `list_pages` — 列出页面

**Description:** 列出浏览器中所有已打开的页面及其索引、URL 与标题。在调用 select_page 前可先使用本工具查找页面索引。

### `navigate_page` — 导航页面

**Description:** 导航当前页面，支持 URL 导航、后退、前进与刷新，等待 DOMContentLoaded 事件。

**Parameters:**

- `type`
- `url`
- `ignoreCache`
- `timeout`

### `new_page` — 新建页面

**Description:** 创建新的浏览器页面并导航到指定 URL，新页面会自动被选中。

**Parameters:**

- `url`
- `timeout`
- `preloadHook`
- `preloadPreset`

### `press_key` — 按键

**Description:** 按下键盘按键或组合键（如 "Enter"、"Control+A"、"Alt+Shift+F"），支持修饰键。

**Parameters:**

- `key`

### `query_dom` — 查询DOM元素

**Description:** 通过定位器查询一个或多个 DOM 元素，返回包含标签、属性、包围盒与可见性的结构化信息。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`
- `all`
- `limit`

### `select_page` — 选择页面

**Description:** 按索引选择页面并将其带到前台、切换上下文。请先使用 list_pages 获取页面索引。

**Parameters:**

- `pageId`
- `pageIdx`

### `set_files` — 设置文件

**Description:** 使用 CDP DOM.setFileInputFiles 为 file input 元素设置文件，适用于 Playwright setInputFiles 被拦截的场景。

**Parameters:**

- `selector`
- `filePaths`

### `upload_file` — 上传文件

**Description:** 向 file input 元素上传文件，优先使用 Playwright setInputFiles，失败则回退到 filechooser 事件模式。

**Parameters:**

- `selector`
- `filePath`

## Network

### `analyze_websocket_messages` — analyze_websocket_messages

**Description:** 分析 WebSocket 消息并按模式/指纹分组。对于理解直播等场景中的二进制/protobuf 消息类型至关重要。返回每种消息类型的统计信息与样本索引。

**Parameters:**

- `wsid`
- `direction`

### `clear_mitm_requests` — clear_mitm_requests

**Description:** 清空 MITM 代理捕获的所有请求。清空后 id 从 1 重新编号。

### `clear_network_requests` — clear_network_requests

**Description:** 清空当前选中页面（或指定页面）的缓存网络请求。清空后，list_network_requests 返回的请求列表将为空，稳定的请求 ID 将从 1 重新编号。

**Parameters:**

- `targetPageIdx`
- `targetPageId`

### `export_mitm_ca` — export_mitm_ca

**Description:** 导出 MITM 根 CA 证书（PEM 或 DER），供客户端信任以解密 HTTPS 流量。

**Parameters:**

- `format`
- `outputPath`

### `export_request_as_curl` — export_request_as_curl

**Description:** 将捕获的网络请求（按 reqid）导出为 curl 命令。支持与 replay_network_request 相同的覆盖项。适用于在浏览器外复现请求，或验证导出的命令能否复现捕获的响应。

**Parameters:**

- `reqid`
- `method`
- `url`
- `headers`
- `body`
- `replaceHeaders`
- `includeCookies`

### `get_mitm_request` — get_mitm_request

**Description:** 获取单条 MITM 捕获请求的完整详情（请求头/请求体/响应头/响应体）。可选 saveTo 把响应体写入文件。

**Parameters:**

- `id`
- `saveTo`
- `format`

### `get_network_request` — get_network_request

**Description:** 按可选的 reqid 获取网络请求；若省略则返回 DevTools Network 面板中当前选中的请求。

**Parameters:**

- `reqid`
- `maxBodyLength`
- `fullBody`
- `saveTo`

### `get_websocket_message` — get_websocket_message

**Description:** 按帧索引获取单条 WebSocket 消息。请先使用 get_websocket_messages 或 analyze_websocket_messages 找到帧索引。

**Parameters:**

- `wsid`
- `frameIndex`
- `decode`

### `get_websocket_messages` — get_websocket_messages

**Description:** 获取 WebSocket 连接的消息。重要：对于二进制/protobuf 消息（如直播流），请先使用 analyze_websocket_messages 理解消息类型，再用 groupId 参数筛选特定类型。默认模式仅显示摘要。

**Parameters:**

- `wsid`
- `direction`
- `groupId`
- `pageSize`
- `pageIdx`
- `show_content`

### `list_mitm_requests` — list_mitm_requests

**Description:** 列出 MITM 代理捕获到的请求（内存环形缓冲，最多保留最近 2000 条）。支持 URL 过滤与分页。

**Parameters:**

- `pageSize`
- `pageIdx`
- `filter`
- `urlFilter`
- `method`
- `statusCode`
- `host`
- `headerContains`
- `bodyContains`

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

### `list_websocket_connections` — list_websocket_connections

**Description:** 列出所有 WebSocket 连接。获取 wsid 后，请先使用 analyze_websocket_messages(wsid) 理解消息模式，再查看单条消息。

**Parameters:**

- `pageSize`
- `pageIdx`
- `urlFilter`
- `includePreservedConnections`

### `mitm_add_host_filter` — mitm_add_host_filter

**Description:** 新增一条 MITM 域名过滤（allow 白名单 / block 黑名单），进程内生效直到 stop 或 clear。白名单非空时黑名单失效：不在白名单里的域名全部旁路（不解密不抓包）。host 为子串匹配，大小写不敏感。

**Parameters:**

- `action`
- `host`

### `mitm_add_rule` — mitm_add_rule

**Description:** 新增/覆盖一条 MITM 改写规则（block / map_local / map_remote / modify_header / modify_body），进程内生效直到 stop 或 clear。同 id 覆盖。

**Parameters:**

- `action`
- `id`
- `enabled`
- `urlFilter`
- `method`
- `host`
- `headerContains`
- `bodyContains`
- `filter`

### `mitm_clear_host_filters` — mitm_clear_host_filters

**Description:** 清空全部 MITM 域名过滤（白名单与黑名单一起清）。

### `mitm_clear_rules` — mitm_clear_rules

**Description:** 清空全部 MITM 改写规则。

### `mitm_configure_local_apps` — mitm_configure_local_apps

**Description:** 配置 Local Applications 透明拦截模式：接管 Windows 系统代理（127.0.0.1:<port>），仅对目标进程做 MITM 解密抓包，其余进程经盲转发正常上网。关闭时自动还原系统代理。targets 留空代表拦截全部本地应用。

**Parameters:**

- `enabled`
- `targets`

### `mitm_export_har` — mitm_export_har

**Description:** 把当前捕获缓冲导出为 HAR 1.2（HTTP Archive）。outputPath 省略时直接返回 HAR 对象。

**Parameters:**

- `outputPath`

### `mitm_list_host_filters` — mitm_list_host_filters

**Description:** 列出当前生效的 MITM 域名过滤（白名单 allow 与黑名单 block）。

### `mitm_list_local_processes` — mitm_list_local_processes

**Description:** 列出当前正在发起或保持 TCP 连接的本地进程（pid/名称），辅助选取透明拦截目标。Windows 上基于 netstat 连接表。

### `mitm_list_rules` — mitm_list_rules

**Description:** 列出当前生效的全部 MITM 改写规则。

### `mitm_remove_host_filter` — mitm_remove_host_filter

**Description:** 移除一条 MITM 域名过滤（需与添加时相同的 action 与 host）。

**Parameters:**

- `action`
- `host`

### `mitm_remove_rule` — mitm_remove_rule

**Description:** 按 id 移除一条 MITM 改写规则。

**Parameters:**

- `id`

### `replay_network_request` — replay_network_request

**Description:** 重放一个捕获的网络请求（按 reqid），使用浏览器上下文的 Cookie 和存储。支持覆盖 method、url、headers 和 body。适用于验证签名字段效果与参数有效性。

**Parameters:**

- `reqid`
- `method`
- `url`
- `headers`
- `body`
- `replaceHeaders`
- `maxBodyLength`

### `replay_network_request_batch` — replay_network_request_batch

**Description:** 以不同覆盖项（变体）多次重放一个捕获的网络请求。适用于模糊测试签名字段、测试参数边界、观察响应分布。默认串行执行，也支持有界并发。

**Parameters:**

- `reqid`
- `variants`
- `concurrency`
- `maxBodyLength`

### `session_create` — session_create

**Description:** 创建新的抓包会话并设为当前活跃会话。

**Parameters:**

- `name`
- `targetUrl`

### `session_get_data` — session_get_data

**Description:** 获取指定会话的结构化请求、加解密 Hook 日志与 Storage 快照。默认取当前活动会话。

**Parameters:**

- `sessionId`
- `sources`
- `urlFilter`
- `includeHooks`
- `includeSnapshots`

### `session_list` — session_list

**Description:** 列出所有抓包会话。

### `start_mitm_proxy` — start_mitm_proxy

**Description:** 启动 MITM 抓包代理，拦截非浏览器流量（curl、脚本、桌面应用、手机 App）。启动后终端可通过 `-x http://127.0.0.1:<port>` 走代理；HTTPS 需信任返回的 CA 证书路径（--cacert）。可配置 upstreamProxy 将流量通过二级外部代理（HTTP/HTTPS/SOCKS5）转发。

**Parameters:**

- `port`
- `upstreamProxy`

### `stop_mitm_proxy` — stop_mitm_proxy

**Description:** 停止 MITM 抓包代理并释放端口。

## Debugging

### `capture_video_frame` — 捕获视频帧

**Description:** 捕获视频元素的当前帧。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。可选地先定位到指定时间点。以图片形式返回该帧。

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

### `evaluate_script` — evaluate_script

**Description:** 在页面上执行 JavaScript；支持 page / content-script 上下文。可选的，对于较大的结果可将输出保存到文件。

**Parameters:**

- `function`
- `context`
- `frameId`
- `allowAnyFrame`
- `verbose`
- `filePath`
- `timeoutMs`

### `get_ai_debug_status` — 获取 AI 调试状态

**Description:** 获取当前调试状态，包括暂停状态、断点数量、脚本数量等。

### `get_console_message` — get_console_message

**Description:** 按 ID 获取单条 Console 消息，返回包含类型、文本与参数的结构化数据。

**Parameters:**

- `msgid`

### `get_css_styles` — 获取CSS层叠样式

**Description:** 获取指定元素匹配的 CSS 规则、内联样式、伪元素与继承样式及层叠（cascade）信息，标注每个声明是生效（active）还是被覆盖（overloaded）。常用于排查元素隐藏/反爬样式与样式覆盖冲突。支持分页。

**Parameters:**

- `selector`
- `pageSize`
- `pageIdx`

### `get_devtools_comments` — 读取DevTools评论

**Description:** 读取 DevTools 窗口中针对当前页面的用户评论线程（CD4A）。当前 DevTools 前端未内置 CD4A 桥接，返回不支持提示。仅在 `full` profile 中暴露，默认 `workflow` profile 下不可见。

### `get_paused_info` — 获取暂停信息

**Description:** 获取当前暂停状态信息，包括调用栈、当前位置和作用域变量。在断点命中后使用此工具了解执行上下文。

**Parameters:**

- `includeScopes`

### `get_video_info` — 获取视频信息

**Description:** 按定位器获取视频元素信息。返回 duration、currentTime、暂停状态和 src。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`

### `inject_preload_script` — inject_preload_script

**Description:** 为当前页面/上下文的后续文档注册预加载脚本

**Parameters:**

- `script`
- `preset`

### `inspect_locals` — 检查局部变量

**Description:** 检查当前暂停栈所有帧的局部变量摘要。

### `list_breakpoints` — 列出断点

**Description:** 列出当前调试会话中的所有活跃断点。

### `list_console_messages` — list_console_messages

**Description:** 列出当前选中页面自上次导航以来的所有 Console 消息，支持按类型过滤与分页。

**Parameters:**

- `pageSize`
- `pageIdx`
- `types`
- `includePreservedMessages`

### `list_frames` — 列出 Frame

**Description:** 以树形结构列出当前页面中的所有 Frame（含 iframe），显示索引、名称与 URL。使用 select_frame 可将执行上下文切换到指定 Frame。

### `open_devtools` — 打开DevTools窗口

**Description:** 为当前选中页面打开 Chrome DevTools 窗口（同一浏览器内新开 devtools:// 目标）。若浏览器以 pipe 启动（无 HTTP 调试端口），窗口不会自动附着到页面，需要人工选择 target。仅在 `full` profile 中暴露，默认 `workflow` profile 下不可见。

### `pause` — 暂停执行

**Description:** 暂停 JavaScript 执行。用于中断运行中的代码。

### `remove_breakpoint` — 移除断点

**Description:** 移除指定 ID 的断点。使用 list_breakpoints 查看活跃断点。

**Parameters:**

- `breakpointId`

### `resolve_devtools_comment` — 解决DevTools评论

**Description:** 向 DevTools 评论线程追加回复并标记已解决（CD4A）。当前 DevTools 前端未内置桥接，返回不支持提示。仅在 `full` profile 中暴露，默认 `workflow` profile 下不可见。

**Parameters:**

- `threadId`
- `replyText`

### `resume` — 恢复执行

**Description:** 从暂停状态恢复执行，直到下一个断点或执行结束。

### `reveal_in_devtools` — 高亮元素

**Description:** 在页面上高亮指定元素（相当于 DevTools Elements 面板的节点高亮），持续指定时间后自动消失。用于逆向分析时快速定位目标 DOM。仅在 `full` profile 中暴露，默认 `workflow` profile 下不可见。

**Parameters:**

- `selector`
- `durationMs`

### `seek_video` — 跳转视频

**Description:** 按定位器将视频元素定位到指定时间点。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`
- `time`

### `select_frame` — 选择 Frame

**Description:** 选择一个 Frame（索引来自 list_frames）作为 evaluate_script、hook_function、inspect_object 等页面内 JavaScript 执行工具的运行上下文。

**Parameters:**

- `frameIdx`

### `set_breakpoint` — 设置断点

**Description:** 设置 JavaScript 断点。支持按脚本 URL 或 scriptId（来自 list_scripts / search_in_sources）加行号设置，可选条件表达式。注意：优先使用 hook_function 或 trace_function 进行监控，断点需要暂停/恢复协调，在自动化流程中容易出错。

**Parameters:**

- `url`
- `scriptId`
- `lineNumber`
- `columnNumber`
- `condition`
- `isRegex`

### `step_into` — 单步进入

**Description:** 单步进入函数调用。用于进入函数体内部进行调试。需要先在断点暂停。返回结果默认包含暂停后的调用栈/作用域，省去再次调用 get_paused_info。

**Parameters:**

- `includePausedInfo`
- `includeScopes`

### `step_out` — 单步跳出

**Description:** 单步跳出当前函数，继续执行直到函数返回。用于快速退出函数。需要先在断点暂停。返回结果默认包含暂停后的调用栈/作用域，省去再次调用 get_paused_info。

**Parameters:**

- `includePausedInfo`
- `includeScopes`

### `step_over` — 单步跳过

**Description:** 单步跳过函数调用，将函数调用视为一个步骤。用于跳过函数体。需要先在断点暂停。返回结果默认包含暂停后的调用栈/作用域，省去再次调用 get_paused_info。

**Parameters:**

- `includePausedInfo`
- `includeScopes`

### `take_screenshot` — 截图

**Description:** 对页面或元素进行截图。

**Parameters:**

- `format`
- `quality`
- `fullPage`
- `filePath`
- `timeoutMs`

## JS Reverse Engineering

### `analyze_pipeline` — analyze_pipeline

**Description:** 分析流水线：采集 → 并行分析(加密检测+混淆分析) → 生成报告。演示 Pipeline 编排模式的完整工作流。

**Parameters:**

- `url`
- `deep`

### `anti_anti_debug` — Anti Anti-Debug

**Description:** 反反调试工具集：固定窗口尺寸、冻结时间、阻止页面关闭、阻止历史导航、阻止控制台清除、隐藏 webdriver 标记。

**Parameters:**

- `features`

### `auto_hook` — auto_hook

**Description:** 自动 Hook：根据预设或自定义选项生成并注入调试 Hook 与加密库 Hook

**Parameters:**

- `url`
- `preset`
- `autoInject`
- `waitAfterHookMs`
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

**Description:** 通过移除 eval/Function/constructor 中的 debugger 关键字来绕过无限 debugger 语句。

**Parameters:**

- `targets`

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

### `collect_wasm` — collect_wasm

**Description:** 重新导航到目标 URL，并捕获网络加载与运行时创建的 WebAssembly 模块。

**Parameters:**

- `url`
- `timeout`
- `waitAfterLoadMs`
- `includeRuntimeEvents`
- `maxModules`
- `captureBase64`

### `collection_diff` — collection_diff

**Description:** 对比上一次与当前收集到的文件摘要。

**Parameters:**

- `previous`
- `current`
- `includeUnchanged`

### `compare_env` — Compare Browser Environment

**Description:** 采集当前 Frame 的浏览器环境基准，用于与 Node.js/jsdom 环境对比。可额外读取安全的点分隔属性路径。

**Parameters:**

- `properties`

### `create_hook` — create_hook

**Description:** 推荐：为 function/fetch/xhr/property/cookie/websocket/eval/timer 创建 hook 脚本。Hook 运行时不会暂停页面执行，相比断点是更优的监控与拦截手段。返回 hookId 与 script，供 inject_hook 使用。

**Parameters:**

- `type`
- `params`
- `description`
- `action`
- `hookId`
- `capture`
- `condition`
- `protocolFallback`

### `dump_target_scripts` — dump_target_scripts

**Description:** 一次性读取指定 Chromium Target 当前已解析的脚本源码。

**Parameters:**

- `targetId`

### `export_session_report` — export_session_report

**Description:** 将当前逆向工程会话导出为 JSON 或 Markdown。

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

### `get_hook_data` — Get Hook Data

**Description:** 获取 Hook 采集到的数据。会先从浏览器同步到 HookManager，再返回数据。支持 raw、summary、detail 三种视图并支持过滤。

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

**Description:** 根据脚本 ID 获取 JavaScript 脚本源码的本地缓存路径。触发 CDP 加载并写入临时文件，返回文件路径供后续直接读取。先使用 list_scripts 查找脚本 ID。可选 filePath 参数可将源码写入自定义路径并返回该绝对路径。

**Parameters:**

- `scriptId`
- `locator`
- `filePath`
- `startLine`
- `endLine`

### `get_storage` — 获取存储

**Description:** 获取浏览器存储数据，包括 HttpOnly cookies、可复制的 Cookie 请求头、localStorage 与 sessionStorage。

**Parameters:**

- `type`
- `filter`

### `hook_cryptojs` — hook_cryptojs

**Description:** Hook CryptoJS 加密库：拦截 AES、DES、MD5、SHA、HMAC 等对称/哈希算法。

**Parameters:**

- `algorithms`
- `logFormat`

### `hook_function` — Hook Function

**Description:** 逆向工程推荐工具：Hook 一个 JavaScript 函数，记录其调用、参数与返回值，且不暂停执行。相比断点更适用于自动化工作流，建议作为监控函数的默认手段。

**Parameters:**

- `target`
- `logArgs`
- `logResult`
- `logStack`
- `hookId`

### `hook_jsencrypt` — hook_jsencrypt

**Description:** Hook JSEncrypt RSA 加密库：拦截公钥/私钥、明文、密文。

**Parameters:**

- `logFormat`

### `hook_jsvmp_interpreter` — Hook JSVMP Interpreter

**Description:** 安装 JSVMP 运行时探针。proxy 模式覆盖调用、Reflect 与全局属性但可检测；transparent 模式仅替换可配置的原型 getter，痕迹更少。应在目标 SDK 加载前调用。

**Parameters:**

- `script_url`
- `persistent`
- `mode`
- `track_calls`
- `track_props`
- `track_reflect`
- `proxy_objects`
- `max_entries`

### `hook_smcrypto` — hook_smcrypto

**Description:** Hook SM-crypto 国密库：拦截 SM2、SM3、SM4 算法。

**Parameters:**

- `algorithms`
- `logFormat`

### `inject_hook` — Inject Hook

**Description:** 向页面注入 Hook。persistent=true 时注册到当前 BrowserContext，并尽力回填当前已有 Frame。

**Parameters:**

- `hookId`
- `script`
- `persistent`
- `world`

### `inject_stealth` — inject_stealth

**Description:** 注入反检测隐身脚本（隐藏 webdriver、伪装 chrome、canvas 噪点等）

**Parameters:**

- `preset`

### `inspect_object` — 检查对象

**Description:** 深度检查一个 JavaScript 对象，展示其属性、原型链与方法，便于理解对象结构。

**Parameters:**

- `expression`
- `depth`
- `showMethods`
- `showPrototype`

### `list_created_hooks` — List Created Hooks

**Description:** 列出 HookManager 中所有已创建的 hook。可选地同步浏览器端数据以统计记录数。

**Parameters:**

- `hookId`
- `verbose`
- `syncFromBrowser`
- `type`
- `event`
- `phase`

### `list_hooks` — 列出 Hook

**Description:** 列出当前所有已安装的函数 Hook。

### `list_persistent_hooks` — List Persistent Hooks

**Description:** 列出当前 BrowserContext 中已注册的持久 Hook。

### `list_scripts` — 列出脚本

**Description:** 列出当前页面加载的所有 JavaScript 脚本。返回脚本 ID、URL 和 Source Map 信息。在设置断点或搜索前使用此工具查找脚本。

**Parameters:**

- `filter`

### `list_stealth_features` — list_stealth_features

**Description:** 列出可用的隐身特性开关

### `list_stealth_presets` — list_stealth_presets

**Description:** 列出可用的隐身预设

### `list_targets` — list_targets

**Description:** 列出 Chromium 当前可见的 Target 及其脚本快照能力。

### `monitor_events` — 监控事件

**Description:** 监控指定元素或 window 上的 DOM 事件，事件将输出到控制台。

**Parameters:**

- `selector`
- `events`
- `monitorId`

### `observe_flow` — observe_flow

**Description:** 观察模式：收集并分析页面脚本，识别加密与混淆，生成风险评估报告

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

**Description:** 根据捕获的证据与目标脚本，构建本地 Node.js 复现环境

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

**Description:** 将结构化的逆向工程证据追加到任务产物日志中。

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

**Description:** 按 ID 移除 hook。会从进程内 HookManager 删除，并可选地清理浏览器端数据。

**Parameters:**

- `hookId`
- `cleanBrowser`

### `remove_xhr_breakpoint` — 移除 XHR 断点

**Description:** 移除 XHR/Fetch 断点。

**Parameters:**

- `url`

### `search_in_scripts` — search_in_scripts

**Description:** 使用正则表达式在已收集的脚本缓存中搜索。

**Parameters:**

- `pattern`
- `limit`
- `maxTotalSize`

### `search_in_sources` — 在源码中搜索

**Description:** 在所有已加载的 JavaScript 源码中搜索字符串或正则表达式。每条匹配仅返回脚本 ID、行号与源码缓存路径（sourcePath），避免上下文臃肿；需要查看代码内容时直接读取 sourcePath 或调用 get_script_source(scriptId, startLine, endLine)。可选 filePath 参数（目录）可将每个匹配脚本的源码写入该目录（<filePath>/<scriptId>.js）并返回绝对路径。

**Parameters:**

- `query`
- `caseSensitive`
- `isRegex`
- `maxResults`
- `excludeMinified`
- `urlFilter`
- `source`
- `filePath`

### `set_breakpoint_on_text` — 在文本上设置断点

**Description:** 在指定代码文本（函数名、语句等）上设置断点，通过搜索自动确定精确位置。适用于正常和压缩文件。注意：优先使用 hook_function 监控函数调用 — 它无需暂停执行即可捕获参数/返回值。仅在需要检查特定代码位置的局部变量时使用此工具。

**Parameters:**

- `text`
- `urlFilter`
- `occurrence`
- `condition`

### `set_user_agent` — set_user_agent

**Description:** 通过 CDP 为当前页面设置自定义 User-Agent

**Parameters:**

- `userAgent`

### `stop_monitor` — 停止监控

**Description:** 停止指定的事件监控。

**Parameters:**

- `monitorId`

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

**Description:** 签名追踪工作流：根据请求头/URL 线索，关联网络请求、Hook 诊断、XHR 断点与调用帧检查

**Parameters:**

- `requestUrlPattern`
- `headerKeyword`
- `maxResults`
- `includeSensitiveValues`
- `taskId`

### `unhook_function` — Unhook Function

**Description:** 移除已安装的函数 Hook。

**Parameters:**

- `hookId`

### `wasm_dump` — wasm_dump

**Description:** 将捕获的 Wasm 模块导出为磁盘上的 .wasm 文件。

**Parameters:**

- `moduleIndex`
- `outputPath`

### `wasm_memory_inspect` — wasm_memory_inspect

**Description:** 检查当前页面中导出的 WebAssembly.Memory —— 提供 hex/ascii 转储与模式搜索。

**Parameters:**

- `offset`
- `length`
- `format`
- `searchPattern`
- `timeoutMs`

### `wasm_vmp_trace` — wasm_vmp_trace

**Description:** 追踪由 JS-Wasm 边界 hook 捕获的 Wasm 运行时事件，可选按模块过滤。

**Parameters:**

- `maxEvents`
- `filterModule`

### `xhr_to_js_breakpoint` — XHR 到 JS 断点

**Description:** 设置 XHR 断点；命中后可结合 get_paused_info / set_breakpoint 完成 JS 断点定位。

**Parameters:**

- `url`

## Input automation

### `click_element` — click_element

**Description:** 点击页面元素。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`

### `scroll_by` — scroll_by

**Description:** 按方向（up/down/top/bottom）滚动页面，并自动等待 800ms 以触发懒加载内容。

**Parameters:**

- `direction`
- `pixels`

### `type_text` — type_text

**Description:** 向输入框键入文本。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`
- `text`
- `delay`

### `wait_for_element` — wait_for_element

**Description:** 等待定位器对应的元素出现在页面中。定位器支持 CSS、role=、text=、xpath=。多匹配时用 >> nth=N 消歧。

**Parameters:**

- `selector`
- `timeout`

## Emulation

### `emulate_cpu` — emulate_cpu

**Description:** 通过 CDP Performance.setCPUThrottlingRate 模拟 CPU 节流。

**Parameters:**

- `throttlingRate`

### `emulate_mobile` — emulate_mobile

**Description:** 模拟移动设备视口、User-Agent 与触摸事件，或恢复桌面模式。

**Parameters:**

- `enable`
- `device`

### `emulate_network` — emulate_network

**Description:** 通过 CDP Network.emulateNetworkConditions 模拟网络条件（节流/离线）。

**Parameters:**

- `throttlingOption`

### `resize_page` — resize_page

**Description:** 将页面视口调整为指定的宽度与高度。

**Parameters:**

- `width`
- `height`

## Performance

### `get_performance_metrics` — get_performance_metrics

**Description:** 通过 Performance API 获取页面性能指标，包括导航时序、资源时序与绘制事件。

### `performance_analyze_insight` — performance_analyze_insight

**Description:** 针对追踪录制结果中高亮的某个性能 Insight 提供更详细的信息。

**Parameters:**

- `insightName`

### `start_performance_trace` — start_performance_trace

**Description:** 在当前选中页面上启动性能追踪录制，用于发现性能问题与可优化点，并报告页面的 Core Web Vitals (CWV) 评分。

**Parameters:**

- `reload`
- `autoStop`

### `stop_performance_trace` — stop_performance_trace

**Description:** 停止性能追踪录制并通过 CDP Tracing.end 分析其结果。

## Pages

### `check_browser_health` — check_browser_health

**Description:** 检查浏览器连接健康状态与页面可用性。

### `delete_session_state` — delete_session_state

**Description:** 删除会话状态

**Parameters:**

- `sessionId`

### `detect_captcha` — detect_captcha

**Description:** 只读评估当前页面是否存在 CAPTCHA，并可等待挑战稳定清除；不会自动求解或操作页面。

**Parameters:**

- `action`
- `timeout`

### `dump_session_state` — dump_session_state

**Description:** 导出会话状态

**Parameters:**

- `sessionId`
- `path`
- `pretty`
- `encrypt`

### `handle_dialog` — handle_dialog

**Description:** 处理浏览器弹窗（alert/confirm/prompt），可接收或取消。

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

**Description:** 通过点击 chrome://extensions/ 页面的更新按钮来更新 Chrome 扩展。

## Diagnostics

### `diagnose_environment` — diagnose_environment

**Description:** 运行环境诊断，检查 Node 版本、构建产物与 artifacts 目录状态。

**Parameters:**

- `checks`
