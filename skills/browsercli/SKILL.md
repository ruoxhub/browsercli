---
name: browsercli
description: Use this skill to control the browser, collect and search scripts, inject hooks, disassemble WebAssembly, analyze network flows, and deobfuscate JavaScript code via browsercli.
---

The `browsercli` tool is a command-line interface for browser automation and JavaScript/WebAssembly reverse-engineering tasks.

## Status

Check connection status and run environment diagnostics before starting a reverse-engineering session:

```bash
browsercli status
```

## AI Workflow

1. **Reconnaissance**: Start by listing pages, navigation, and script collection.
2. **Analysis**: Perform static analysis, cryptocurrency detection, or deobfuscation on target code.
3. **Interception**: Inject hooks or set breakpoints to capture runtime payloads.
4. **Reconstruction**: Export rebuild bundles to run the algorithm offline.

## Command Usage

All tool executions follow the pattern:

```bash
browsercli call <tool_name> [arguments]
```

---

## Detailed Tool Reference

### 1. Browser Navigation & Page Control

Manage tabs, navigate URLs, and switch iframe execution contexts.

```bash
# List all open browser pages with index, URL, and title
browsercli call list_pages # 列出所有打开的浏览器页面。

# Select a page by index to switch context
browsercli call select_page --pageIdx <num> # 切换当前主控的浏览器标签页。

# Create a new browser page
browsercli call new_page --url <str> [--timeout <num>] [--preloadHook <str>] [--preloadPreset <str>] # 创建一个新标签页并导航至指定地址。

# Navigate current page (supports url, back, forward, reload)
browsercli call navigate_page [--type <str>] [--url <str>] [--ignoreCache <bool>] [--timeout <num>] # 控制当前页面导航（前进、后退、刷新、跳转）。

# List all frames (including iframes) in the current page
browsercli call list_frames # 列出当前页面中的所有 Frame 和 Iframe。

# Select a frame context for script execution
browsercli call select_frame --frameIdx <num> # 选择特定的 Iframe 框架作为后续 JavaScript 的执行上下文。
```

### 2. Script Collection & Search

Identify and collect JavaScript source code from the active browser page.

```bash
# List all loaded scripts
browsercli call list_scripts [--filter <str>] # 列出当前页面加载的所有 JavaScript 脚本信息。

# Get JavaScript source code for a specific script ID
browsercli call get_script_source --scriptId <str> [--startLine <num>] [--endLine <num>] [--offset <num>] [--prettyPrint <bool>] # 获取指定脚本 ID 的 JavaScript 源码。

# Search in loaded script sources using strings or regex
browsercli call search_in_sources --query <str> [--urlFilter <str>] # 在所有已加载的脚本中搜索字符串或正则表达式。

# Search in collected script cache
browsercli call search_in_scripts --pattern <str> [--limit <num>] [--maxTotalSize <num>] # 在本地已收集的脚本缓存中搜索匹配模式。

# Find string in script (returns exact line/col)
browsercli call find_in_script --scriptId <str> --query <str> # 在指定脚本中查找字符串并返回精确行列号。

# Collect scripts with smart modes (summary/priority/incremental/full)
browsercli call collect_code --url <str> [--smartMode <str>] [--returnMode <str>] [--includeInline <bool>] [--includeExternal <bool>] [--includeDynamic <bool>] [--maxTotalSize <num>] [--maxFileSize <num>] [--pattern <str>] [--limit <num>] [--topN <num>] # 智能收集并保存当前页面相关的 JavaScript 代码。

# Compare collected file summaries
browsercli call collection_diff [--includeUnchanged <bool>] # 对比之前和当前收集的代码文件摘要差异。
```

### 3. JavaScript Code Analysis & Deobfuscation

Analyze, summarize, and deobfuscate JavaScript with static analysis and AI support.

```bash
# AI-assisted JavaScript deobfuscation
browsercli call deobfuscate_code --code <str> [--aggressive <bool>] [--renameVariables <bool>] # AI 辅助的 JavaScript 反混淆。

# Analyze code structure, business logic, and security
browsercli call understand_code --code <str> [--focus <str>] # 分析代码结构、业务逻辑和潜在的安全缺陷。

# Summarize one or multiple code files, or project context
browsercli call summarize_code [--mode <str>] [--code <str>] [--url <str>] # 对单个或多个代码文件或项目上下文进行归纳摘要。

# Detect cryptographic algorithms/libraries from source code
browsercli call detect_crypto --code <str> [--useAI <bool>] # 检测 JavaScript 源码中的加密算法和特征。
```

### 4. Dynamic Hooking (Highly Recommended)

Hooks are the preferred method for monitoring runtime behavior as they do not pause execution.

```bash
# Create a hook configuration script
browsercli call create_hook --type <str> [--params <arr>] [--description <str>] [--action <str>] [--hookId <str>] [--capture <arr>] [--condition <arr>] # 创建针对函数/请求/属性等的 Hook 脚本定义。

# Inject a hook script (persistent=true keeps it active across page navigations)
browsercli call inject_hook --hookId <str> --script <str> [--persistent <bool>] [--world <str>] # 向页面中注入指定的 Hook 脚本。

# Get captured hook logs
browsercli call get_hook_data [--hookId <str>] [--view <str>] [--maxRecords <num>] [--type <str>] [--event <str>] [--phase <str>] # 获取 Hook 捕获到的时序数据和日志记录。

# Manage hooks
browsercli call list_hooks # 列出当前活跃的函数挂钩（Hooks）。
browsercli call list_created_hooks [--hookId <str>] # 列出所有已创建的 Hook 条目。
browsercli call list_persistent_hooks # 列出所有跨页面跳转保留的持久化 Hook。
browsercli call remove_hook --hookId <str> # 移除指定的 Hook 实例。

# Hook specific functions or libraries
browsercli call hook_function --target <str> [--hookId <str>] # 挂钩劫持指定的 JavaScript 函数。
browsercli call unhook_function --hookId <str> # 移除已安装的指定函数挂钩。
browsercli call hook_cryptojs [--algorithms <arr>] [--logFormat <str>] # 挂钩 CryptoJS 库以拦截加解密参数。
browsercli call hook_jsencrypt [--logFormat <str>] # 挂钩 JSEncrypt RSA 库以拦截公私钥及文本。
browsercli call hook_smcrypto [--algorithms <arr>] [--logFormat <str>] # 挂钩 SM-crypto 国密库以拦截 SM2/SM3/SM4 参数。

# Auto-inject preset debug and crypto hooks
browsercli call auto_hook [--url <str>] [--preset <str>] [--autoInject <bool>] [--waitAfterHookMs <num>] [--useAI <bool>] [--hookCrypto <bool>] [--hookRsa <bool>] [--hookSmCrypto <bool>] [--hookTimers <bool>] [--hookEval <bool>] [--hookCookie <bool>] [--hookXhr <bool>] [--hookFetch <bool>] [--exportResults <bool>] [--exportWaitMs <num>] # 根据预设组合自动生成并注入各种调试和加密库的挂钩。
```

### 5. Debugging & Breakpoints

Set breakpoints when you must inspect local stack frames and scoped variables.

```bash
# Set JavaScript breakpoint
browsercli call set_breakpoint --url <str> --lineNumber <num> [--condition <str>] # 设置 JavaScript 断点。支持按脚本 URL 和行号设置，可选条件表达式。
browsercli call remove_breakpoint --breakpointId <str> # 移除指定 ID 的断点。
browsercli call list_breakpoints # 列出当前调试会话中的所有活跃断点。

# Set breakpoint automatically based on text query
browsercli call set_breakpoint_on_text --text <str> [--urlFilter <str>] [--condition <str>] # 在搜索到的指定代码文本行上自动设置断点。

# XHR Breakpoints
browsercli call break_on_xhr [--url <str>] # 当 XHR/Fetch 请求的 URL 包含指定字符串时触发断点挂起。
browsercli call remove_xhr_breakpoint [--url <str>] # 移除 XHR 拦截断点。
browsercli call xhr_to_js_breakpoint [--url <str>] # 设置 XHR 断点以定位发起请求的对应 JavaScript 代码行。

# Execution control (requires pause state)
browsercli call step_into # 单步进入函数调用内部（需处于暂停状态）。
browsercli call step_over # 单步跳过当前函数调用（需处于暂停状态）。
browsercli call step_out # 单步跳出当前函数并继续执行（需处于暂停状态）。
browsercli call resume # 从暂停状态恢复执行。
browsercli call pause # 强制暂停当前 JavaScript 代码的执行。

# State inspection
browsercli call get_paused_info # 获取断点暂停时的调用栈和变量作用域等上下文。
browsercli call get_ai_debug_status # 获取当前调试器的综合状态信息。
browsercli call inspect_locals # 检查当前暂停调用栈中所有栈帧的局部变量。
browsercli call inspect_object --expression <str> # 深度分析并结构化展示指定 JavaScript 对象结构。
browsercli call evaluate_on_callframe --expression <str> # 在当前暂停调用栈帧的上下文中执行 JavaScript 表达式。
```

### 6. Anti-Detection & Stealth

Bypass protection mechanisms, anti-debugging checks, and web driver detection.

```bash
# Anti-anti-debug toolkit (fixes window size, freezes time, blocks page close/history navigation, etc.)
browsercli call anti_anti_debug # 激活防反调试防护，锁定视口、冻结时间或防止页面关闭。

# Bypass infinite loop debugger statements
browsercli call bypass_debugger # 通过动态过滤 debugger 关键字规避无限 debugger 卡死。

# Custom User Agent
browsercli call set_user_agent --userAgent <str> # 为当前页面配置自定义的浏览器 User-Agent 字符串。

# Inject anti-detection stealth scripts
browsercli call inject_stealth [--preset <str>] # 注入隐身防爬检测脚本（屏蔽 webdriver、隐藏特征等）。
browsercli call list_stealth_features # 列出隐身防爬检测模块支持的子特征列表。
browsercli call list_stealth_presets # 列出可用的隐身防爬配置预设。
```

### 7. WebAssembly Analysis (Wasm)

Decompile, optimize, disassemble, and run WebAssembly modules.

```bash
# Detect available native Wasm toolchain
browsercli call wasm_capabilities # 检测本地是否安装有 WASM 分析相关的 native 工具链。

# Dump a captured WebAssembly module
browsercli call wasm_dump [--moduleIndex <num>] [--outputPath <str>] # 将网页已编译加载的 Wasm 模块提取并存盘为本地 .wasm 文件。

# Disassemble .wasm to WAT
browsercli call wasm_disassemble --inputPath <str> [--outputPath <str>] [--foldExprs <bool>] # 反汇编本地 .wasm 文件为可读的 WebAssembly 文本格式（WAT）。

# Decompile a .wasm file
browsercli call wasm_decompile --inputPath <str> [--outputPath <str>] [--foldExprs <bool>] [--inlineExport <bool>] [--maxWatChars <num>] # 反编译本地 .wasm 文件为类似 C 语法的伪代码。

# Inspect Wasm sections, signatures, strings
browsercli call wasm_inspect_sections --inputPath <str> [--sections <str>] [--includeFunctionSignatures <bool>] [--includeStringScan <bool>] [--maskSensitiveStrings <bool>] [--maxStringSlots <num>] [--maxSummaryLines <num>] # 扫描并导出 Wasm 文件的结构区块、导出表及常量字符。

# Run a Wasm function offline using wasmtime/wasmer
browsercli call wasm_offline_run --inputPath <str> --functionName <str> [--args <arr>] [--runtime <str>] [--timeoutMs <num>] # 在本地离线沙箱中直接运行执行指定的 Wasm 导出函数。

# Optimize .wasm files using wasm-opt
browsercli call wasm_optimize --inputPath <str> [--outputPath <str>] [--level <str>] # 运用 wasm-opt 工具压缩或优化 Wasm 文件结构。

# Trace Wasm events at the JS-Wasm boundary
browsercli call wasm_vmp_trace [--maxEvents <num>] [--filterModule <str>] # 追踪并输出 JavaScript 与 Wasm 之间的接口调用行为日志。

# Inspect WebAssembly memory dumps or patterns
browsercli call wasm_memory_inspect [--offset <num>] [--length <num>] [--format <str>] [--searchPattern <str>] # 检查或在内存中检索导出的 WebAssembly.Memory 缓冲数据。
```

### 8. DOM Query & Element Interaction

Automate page actions such as clicks, typing, and form submissions.

```bash
# Query elements
browsercli call query_dom --selector <str> [--all <bool>] [--limit <num>] # 根据 CSS 选择器查询 DOM 元素的位置、属性及可见性。
browsercli call get_dom_structure [--maxDepth <num>] [--includeText <bool>] # 获取简化压缩后的 DOM 树结构。
browsercli call find_clickable_elements [--filterText <str>] # 在当前页面智能搜索可点击的 DOM 元素。

# Interaction
browsercli call click --selector <str> [--dblClick <bool>] # 模拟点击指定的 DOM 元素。
browsercli call click_at --selector <str> # 在目标元素的中心物理坐标处执行 CDP 鼠标点击（防劫持）。
browsercli call click_element --selector <str> # 点击指定的 DOM 元素。
browsercli call fill --selector <str> --value <str> # 为输入框、下拉菜单等元素填充指定的值。
browsercli call fill_form  # 批量填充页面上的表单数据（通常通过 stdin 输入 JSON 键值对）。
browsercli call type_text --selector <str> --text <str> [--delay <num>] # 模拟真实键盘打字形式往输入框输入文本。
browsercli call press_key --key <str> # 模拟触发特定的物理按键或快捷组合键。
browsercli call hover --selector <str> # 将鼠标悬停在指定元素上方。
browsercli call drag --fromSelector <str> --toSelector <str> # 将 DOM 元素从起点选择器位置拖拽到终点。
browsercli call set_files --selector <str> --filePaths <arr> # 用底层的 CDP DOM 接口往文件输入元素中直接添加文件列表。
browsercli call upload_file --selector <str> --filePath <str> # 触发并完成本地文件向网页文件上传框的传送。
browsercli call scroll_by --direction <str> [--pixels <num>] # 沿指定方向或像素滚动页面，并等待懒加载数据稳定。
browsercli call wait_for_element --selector <str> [--timeout <num>] # 同步阻塞等待特定的 DOM 元素在页面中生成渲染。
browsercli call handle_dialog --action <str> [--promptText <str>] # 自动处理页面中弹出的 alert/confirm/prompt 对话框。

# Capture
browsercli call take_screenshot [--format <str>] [--quality <num>] [--fullPage <bool>] [--filePath <str>] # 对当前页面（或长页面）截图。
```

### 9. Network & WebSocket Analysis

Inspect HTTPS requests, request initiators (call stack), and WebSockets.

```bash
# List network requests
browsercli call list_network_requests [--pageSize <num>] [--pageIdx <num>] [--includePreservedRequests <bool>] [--targetPageIdx <num>] [--waitForRequest <str>] [--waitTimeoutMs <num>] [--headerFilter <str>] [--urlFilter <str>] [--includeSignatureEvidence <bool>] # 检索并列出当前页面抓包捕获的所有 HTTP/HTTPS 请求报文。

# Get detailed request and response details
browsercli call get_network_request [--reqid <num>] [--maxBodyLength <num>] # 获取指定 ID 对应请求和响应的全部详细正文。
browsercli call clear_network_requests [--targetPageIdx <num>] # 清理抓包缓存，重置网络请求计数器。

# Retrieve the initiator JavaScript stack trace for a request
browsercli call get_request_initiator --requestId <num> # 获取发起指定网络请求的 JavaScript 调用栈轨迹。

# Replay or export network requests
browsercli call replay_network_request --reqid <num> [--method <str>] [--url <str>] [--headers <arr>] [--replaceHeaders <bool>] [--maxBodyLength <num>] # 重新播放指定的网络请求。
browsercli call export_request_as_curl --reqid <num> [--method <str>] [--url <str>] [--headers <arr>] [--replaceHeaders <bool>] [--includeCookies <bool>] # 导出指定网络请求为 cURL 命令。
browsercli call replay_network_request_batch --reqid <num> [--concurrency <num>] [--maxBodyLength <num>] # 批量并发重放指定的网络请求。


# WebSocket Inspection
browsercli call list_websocket_connections [--pageSize <num>] [--pageIdx <num>] [--urlFilter <str>] [--includePreservedConnections <bool>] # 列出当前页面开启的所有 WebSocket 连接。
browsercli call get_websocket_messages --wsid <num> [--direction <str>] [--groupId <str>] [--pageSize <num>] [--pageIdx <num>] [--show_content <bool>] # 抓取并展示指定 WebSocket 连接收发的帧内容。
browsercli call get_websocket_message --wsid <num> --frameIndex <num> # 获取 WebSocket 连接的特定单帧数据内容。
browsercli call analyze_websocket_messages --wsid <num> [--direction <str>] # 对指定连接收发的 Websocket 帧按格式模式进行智能归纳和类型聚类。
```

### 10. Environment Rebuilding & Evidence Logging

Document clues and reconstruct local emulation scripts.

```bash
# Append structured reverse-engineering evidence to task logs
browsercli call record_reverse_evidence --taskId <str> --taskSlug <str> --targetUrl <str> --goal <str> [--channel <str>] [--targetKeywords <arr>] [--targetUrlPatterns <arr>] [--targetFunctionNames <arr>] [--targetActionDescription <str>] --entry <arr> # 将捕捉到的关键逆向证据结构化追加到任务凭证日志中。

# Orchestrate local environment building
browsercli call rebuild_bundle [--url <str>] [--targetUrl <str>] [--targetFunctionNames <arr>] [--targetKeywords <arr>] [--targetUrlPatterns <arr>] [--goal <str>] [--autoGenerate <bool>] [--maxEvidenceItems <num>] [--taskId <str>] [--taskSlug <str>] # 根据证据生成本地 Node 环境模拟执行基础目录和脚本。

# Export local Node rebuild bundle code
browsercli call export_rebuild_bundle --taskId <str> --taskSlug <str> --targetUrl <str> --goal <str> [--autoGenerate <bool>] [--targetKeywords <arr>] [--targetUrlPatterns <arr>] [--targetFunctionNames <arr>] [--targetActionDescription <str>] [--maxEvidenceItems <num>] [--entryCode <str>] [--envCode <str>] [--polyfillsCode <str>] [--capture <arr>] [--notes <arr>] # 导出完整组装后的本地离线扣算法复现 Node 包。

# Diff runtime failures with browser capabilities to suggest environment patches
browsercli call diff_env_requirements --runtimeError <str> [--observedCapabilities <arr>] # 对比本地运行异常与浏览器能力，智能给出本地补环境的修复建议。

# Trace signature generation workflow (correlation of requests, hooks, frame inspection)
browsercli call trace_signature_generation [--requestUrlPattern <str>] [--headerKeyword <str>] [--maxResults <num>] [--includeSensitiveValues <bool>] [--taskId <str>] # 针对签名机制自动串联请求、Hook、断点及变量关系以还原生成链。
```

### 11. Workflow Helpers, Site Experiences & Templates

Package specific patterns, target profiles, and reusable scripts.

```bash
# Recommendation and workflow guidance
browsercli call recommend_next_step [--taskId <str>] [--browserHealthy <bool>] [--pageReady <bool>] [--taskGoal <str>] [--currentStage <str>] [--taskStatus <str>] [--hasTargetRequest <bool>] [--hookRecordCount <num>] [--hasRebuildBundle <bool>] [--hasPassingRebuild <bool>] [--firstDivergenceKnown <bool>] # 根据当前的分析状态推荐后续逆向工程的建议步骤。
browsercli call explain_reverse_stage --stage <str> [--includeDocs <bool>] # 解释说明指定的逆向阶段的目标、准入准出标准和避坑指南。
browsercli call list_parameter_workflows # 列出当前预置的各种业务解密工作流指引。
browsercli call get_parameter_workflow --id <str> # 获取特定解密工作流的详细步骤说明。
browsercli call recommend_parameter_workflow --query <str> # 根据用户的参数或目标描述推荐匹配的工作流。

# Site Experience profiles
browsercli call list_site_experiences # 列出所有已建档的目标站对抗及逆向实践经验。
browsercli call search_site_experience [--url <str>] [--name <str>] # 搜索获取特定目标站点的逆向对抗建档。
browsercli call create_site_experience --domain <str> --name <str> [--aliases <arr>] [--platformFeatures <str>] [--validPatterns <str>] [--knownPitfalls <str>] # 新建目标站点逆向经验对抗策略档案。
browsercli call update_site_experience --id <num> [--name <str>] [--aliases <arr>] [--platformFeatures <str>] [--validPatterns <str>] [--knownPitfalls <str>] # 更新已保存的目标站点逆向经验档案。
browsercli call delete_site_experience --id <num> # 删除选定的站点逆向经验档案。
```

### 12. Session Management, Diagnostics & Video

```bash
# Save and restore browser state
browsercli call save_session_state [--sessionId <str>] [--includeCookies <bool>] [--includeLocalStorage <bool>] [--includeSessionStorage <bool>] # 备份当前的浏览器 Cookie 与 Storage 会话状态。
browsercli call restore_session_state --sessionId <str> [--navigateToSavedUrl <bool>] [--clearStorageBeforeRestore <bool>] # 从备份中恢复浏览器的会话状态并还原环境。
browsercli call list_session_states # 列出当前所有备份的会话状态列表。
browsercli call delete_session_state --sessionId <str> # 删除指定的会话备份文件。
browsercli call dump_session_state --sessionId <str> [--path <str>] [--pretty <bool>] [--encrypt <bool>] # 导出浏览器会话状态（支持加密导出）。
browsercli call load_session_state [--sessionId <str>] [--path <str>] [--snapshotJson <str>] [--overwrite <bool>] # 载入并覆写外部导出的浏览器会话快照。

# Media operations
browsercli call capture_video_frame --selector <str> [--seekTime <num>] [--outputPath <str>] [--format <str>] [--quality <num>] # 截取网页中 HTML5 视频元素的特定单帧。
browsercli call get_video_info --selector <str> # 获取页面视频元素的播放时长、进度等基本数据。
browsercli call seek_video --selector <str> --time <num> # 调节页面上视频元素的播放进度到指定时间点。
```
