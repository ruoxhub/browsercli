# 工具分类速查

按功能域组织的完整工具索引。工具名后标注关键参数，`*` 表示必填。

## 1. 工作流 (Workflow)

端到端自动化工作流，覆盖观察→Hook→复现全流程。

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `observe_flow` | `--url*` | 观察模式：收集页面脚本、识别加密/混淆、生成风险评估 |
| `auto_hook` | `--url*` | 自动生成并注入 Hook（基于 preset 或自定义选项） |
| `rebuild_bundle` | `--url*` | 从证据构建本地 Node.js 复现环境 |
| `trace_signature_generation` | | 签名追踪工作流：关联网络请求、Hook 诊断、XHR 断点 |
| `analyze_target` | `--url*` | 一键逆向：收集代码→安全/加密分析→Hook 关联 |

## 2. DOM 操作 (DOM)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `query_dom` | `--selector*` | CSS 选择器查询 DOM 元素 |
| `get_dom_structure` | | 获取 DOM 树结构 |
| `find_clickable_elements` | | 查找可点击的按钮/链接 |

## 3. 网络请求 (Network)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `list_network_requests` | | 列出所有网络请求（支持过滤/分页/等待） |
| `get_network_request` | | 获取单个请求详情（含响应体） |

## 4. 用户输入 (Input)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `click` | `--selector*` | 单击/双击元素 |
| `press_key` | `--key*` | 按键/组合键 |
| `fill_form` | | 批量填表单 |
| `upload_file` | `--selector* --filePath*` | 上传文件 |
| `hover` | `--selector*` | 鼠标悬停 |
| `drag` | `--fromSelector* --toSelector*` | 拖拽 |
| `click_at` | `--selector*` | CDP 级真实鼠标点击（绕过拦截） |
| `set_files` | `--selector* --filePaths*` | CDP 级设置文件（绕过拦截） |
| `fill` | `--selector* --value*` | 填充输入框/下拉框 |

## 5. 页面操作 (Page)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `click_element` | `--selector*` | CSS 选择器点击元素 |
| `type_text` | `--selector* --text*` | 输入文本（带延迟模拟） |
| `wait_for_element` | `--selector*` | 等待元素出现 |
| `scroll_by` | `--direction*` | 滚动页面（支持懒加载等待） |
| `save_session_state` | | 保存会话状态（Cookie/Storage） |
| `restore_session_state` | `--sessionId*` | 恢复会话状态 |
| `list_session_states` | | 列出已保存会话 |
| `delete_session_state` | `--sessionId*` | 删除会话状态 |
| `dump_session_state` | `--sessionId*` | 导出会话状态到文件 |
| `load_session_state` | | 加载会话状态（文件/JSON） |
| `check_browser_health` | | 检查浏览器连接健康状态 |

## 6. 导航 (Navigation)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `list_pages` | | 列出所有浏览器页面 |
| `select_page` | `--pageIdx*` | 切换到指定页面 |
| `new_page` | `--url*` | 新建页面并导航 |
| `navigate_page` | | 导航（URL/前进/后退/刷新） |

## 7. 截图与视频 (Screenshot)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `take_screenshot` | | 截图（支持全页/元素） |
| `capture_video_frame` | `--selector*` | 捕获视频当前帧 |
| `get_video_info` | `--selector*` | 获取视频元素信息 |
| `seek_video` | `--selector* --time*` | 跳转视频时间点 |

## 8. 设备模拟 (Emulation)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `emulate_mobile` | `--enable*` | 模拟移动设备 |
| `emulate_network` | `--throttlingOption*` | 模拟网络条件（限速/离线） |
| `emulate_cpu` | `--throttlingRate*` | 模拟 CPU 限速 |
| `resize_page` | `--width* --height*` | 调整视口尺寸 |

## 9. 反检测 (Stealth)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `set_user_agent` | `--userAgent*` | 设置自定义 User-Agent |
| `inject_stealth` | | 注入反检测脚本（隐藏 webdriver 等） |
| `list_stealth_features` | | 列出可用反检测功能 |
| `list_stealth_presets` | | 列出可用反检测预设 |

## 10. 性能 (Performance)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `start_performance_trace` | `--reload* --autoStop*` | 开始性能追踪 |
| `stop_performance_trace` | | 停止性能追踪并分析 |
| `get_performance_metrics` | | 获取页面性能指标 |
| `performance_analyze_insight` | `--insightName*` | 分析特定性能洞察 |

## 11. 调试器 (Debugger)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `set_breakpoint` | `--url* --lineNumber*` | 设置断点 |
| `remove_breakpoint` | `--breakpointId*` | 移除断点 |
| `list_breakpoints` | | 列出所有活跃断点 |
| `step_into` | | 单步进入 |
| `step_over` | | 单步跳过 |
| `step_out` | | 单步跳出 |
| `resume` | | 恢复执行 |
| `pause` | | 暂停执行 |
| `list_scripts` | | 列出所有 JS 脚本 |
| `get_script_source` | `--scriptId*` | 获取脚本源码 |
| `search_in_sources` | `--query*` | 搜索所有源码 |
| `get_storage` | | 获取 Cookie/localStorage/sessionStorage |
| `break_on_xhr` | `--url*` | XHR/Fetch URL 断点 |
| `remove_xhr_breakpoint` | `--url*` | 移除 XHR 断点 |
| `monitor_events` | | 监控 DOM 事件 |
| `stop_monitor` | `--monitorId*` | 停止事件监控 |
| `trace_function` | `--target*` | 日志点追踪函数调用（不暂停） |
| `get_ai_debug_status` | | 获取调试状态概览 |
| `inspect_object` | `--expression*` | 深度检查 JS 对象 |
| `list_hooks` | | 列出所有活跃 Hook |
| `find_in_script` | `--scriptId* --query*` | 在指定脚本中搜索 |
| `get_request_initiator` | `--requestId*` | 获取网络请求 JS 调用栈 |
| `get_paused_info` | | 获取暂停状态信息 |
| `evaluate_on_callframe` | `--expression*` | 在调用帧上下文执行表达式 |
| `inspect_locals` | | 检查暂停帧局部变量 |
| `set_breakpoint_on_text` | `--text*` | 按代码文本设置断点 |
| `hook_function` | `--target*` | Hook 函数：记录调用/参数/返回值 |
| `unhook_function` | `--hookId*` | 移除函数 Hook |
| `xhr_to_js_breakpoint` | | XHR 断点→JS 断点定位 |
| `start_continuous_debugging` | | 开始连续调试会话 |
| `stop_continuous_debugging` | | 停止连续调试会话 |

## 12. Hook 系统 (Hook)

通用 Hook 管理和专项 Hook。

### 12a. 通用 Hook 管理

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `create_hook` | `--type*` | 创建 Hook 脚本（function/fetch/xhr/property/cookie/websocket/eval/timer） |
| `inject_hook` | `--hookId* --script*` | 注入已创建的 Hook 脚本 |
| `get_hook_data` | | 获取 Hook 捕获的数据（支持过滤/分页） |
| `remove_hook` | `--hookId*` | 移除 Hook |
| `list_created_hooks` | | 列出所有已创建 Hook |

### 12b. 专项 Hook

| 工具 | 用途 |
|------|------|
| `hook_xhr_open` | Hook XMLHttpRequest.open |
| `hook_xhr_set_request_header` | Hook XMLHttpRequest.setRequestHeader |
| `hook_fetch` | Hook window.fetch（可选 --url 过滤） |
| `hook_cookie` | Hook document.cookie |
| `hook_websocket` | Hook WebSocket |
| `hook_json_parse` | Hook JSON.parse |
| `hook_json_stringify` | Hook JSON.stringify |
| `hook_local_storage` | Hook localStorage |
| `hook_session_storage` | Hook sessionStorage |
| `hook_date_now` | Hook Date.now()（固定返回值） |
| `hook_performance_now` | Hook performance.now()（固定返回值） |
| `hook_random` | Hook Math.random（固定返回值） |
| `hook_promise` | Hook Promise resolve |
| `hook_history` | Hook History API |
| `hook_history_go` | 拦截 history.go/back（反调试） |
| `hook_location_href` | 拦截页面跳转（反调试） |
| `hook_close` | 拦截 window.close（反调试） |
| `hook_console_log` | 保护 console.log |
| `hook_console_clear` | 拦截 console.clear（反调试） |
| `hook_console_protect` | 保护 console 方法 |
| `hook_console_table` | 中和 console.table（反时间检测） |
| `fixed_window_size` | 固定窗口尺寸 |
| `anti_anti_hook` | 反反 Hook：让 Hook 方法看起来像原生 |

## 13. 对话框与帧 (Dialog / Frames)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `handle_dialog` | `--action*` | 处理 alert/confirm/prompt 对话框 |
| `list_frames` | | 列出所有帧（含 iframe） |
| `select_frame` | `--frameIdx*` | 切换到指定帧上下文 |

## 14. 脚本执行 (Script)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `evaluate_script` | `--function*`（也接受 `--script`） | 在页面执行 JavaScript |
| `inject_preload_script` | `--script*` | 注入预加载脚本（未来文档生效） |

## 15. 站点经验 (Site Experience)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `search_site_experience` | | 按域名/名称搜索站点经验 |
| `list_site_experiences` | | 列出所有站点经验 |
| `create_site_experience` | `--domain* --name*` | 创建站点经验 |
| `update_site_experience` | `--id*` | 更新站点经验 |
| `delete_site_experience` | `--id*` | 删除站点经验 |

## 16. 扩展管理 (Extensions)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `update_extensions` | | 更新 Chrome 扩展 |

## 17. 代码分析 (Analyzer)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `deobfuscate_code` | `--code*` | AI 辅助 JS 去混淆 |
| `understand_code` | `--code*` | AI + 静态分析代码结构/安全 |
| `summarize_code` | | 代码/项目级摘要 |
| `detect_crypto` | `--code*` | 检测加密算法/库 |
| `record_reverse_evidence` | `--taskId* --taskSlug* --targetUrl* --goal*` | 记录逆向证据到任务 artifact |
| `risk_panel` | | 综合风险评分（分析器+加密检测+Hook 信号） |
| `export_session_report` | | 导出会话报告（JSON/Markdown） |

## 18. 代码收集 (Collector)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `collect_code` | `--url*` | 从页面收集 JS 代码（多种智能模式） |
| `collection_diff` | | 比较前后收集差异 |
| `search_in_scripts` | `--pattern*` | 在收集的脚本缓存中正则搜索 |

## 19. 本地复现 (Rebuild)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `export_rebuild_bundle` | `--taskId* --taskSlug* --targetUrl* --goal*` | 导出本地复现 Bundle |
| `diff_env_requirements` | `--runtimeError*` | 对比本地运行时差异，建议环境补丁 |

## 20. 反调试 (Anti-Debug)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `anti_anti_debug` | | 一键反调试：固定窗口/冻结时间/拦截跳转等 |
| `bypass_debugger` | | 绕过无限 debugger 语句 |

## 21. 加密库 Hook (Crypto)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `hook_cryptojs` | | Hook CryptoJS（AES/DES/MD5/SHA/HMAC） |
| `hook_jsencrypt` | | Hook JSEncrypt RSA（公私钥/明文/密文） |
| `hook_smcrypto` | | Hook SM-crypto（SM2/SM3/SM4） |

## 22. WebAssembly (Wasm)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `wasm_capabilities` | | 检测本地 Wasm 工具链 |
| `wasm_dump` | | 导出 .wasm 文件到磁盘 |
| `wasm_disassemble` | `--inputPath*` | .wasm → WAT 反汇编 |
| `wasm_decompile` | `--inputPath*` | .wasm 反编译（含函数摘要） |
| `wasm_inspect_sections` | `--inputPath*` | 检查 Wasm 二进制段 |
| `wasm_offline_run` | `--inputPath* --functionName*` | 离线执行 Wasm 函数 |
| `wasm_optimize` | `--inputPath*` | 优化 .wasm 文件 |
| `wasm_vmp_trace` | | 追踪 Wasm 运行时事件 |
| `wasm_memory_inspect` | | 检查 Wasm 内存导出 |

## 23. 代码模板 (Code Templates)

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `get_code_template` | `--templateName*` | 读取代码模板 |
| `inject_code_template` | `--templateName*` | 注入代码模板到页面 |
| `list_code_templates` | | 列出可用代码模板 |

## 25. WebSocket

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `list_websocket_connections` | | 列出所有 WebSocket 连接 |
| `get_websocket_messages` | `--wsid*` | 获取 WS 消息（按方向/分组过滤） |
| `get_websocket_message` | `--wsid* --frameIndex*` | 获取单条 WS 消息 |
| `analyze_websocket_messages` | `--wsid*` | 分析 WS 消息模式/分组（二进制/protobuf 必用） |
