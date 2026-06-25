# 工具分类速查（141 个 MCP 工具）

> **权威来源**：`browsercli list-tools --json`。任何文档与 list-tools 冲突时，**以 list-tools 为准**。
>
> **Profile gating**：本目录按"工具能做什么"组织，不标 profile。若当前 profile 下找不到某个工具，先用 `search_tools --query <keyword>` 在 `search` profile 中发现它，然后看 `references/profile-tool-gating.md` 决定是否需要切换到 `workflow` / `full` profile。

---

## 1. 工作流（Workflow, 11）

端到端自动化工作流，覆盖 Observe → Capture → Rebuild → Patch → PureExtraction 全流程，含阶段顾问与参数 blueprint 推荐。

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `observe_flow` | `--url*` | 观察模式：收集脚本、识别加密/混淆、生成风险评估 |
| `analyze_target` | `--url*` | 一键逆向：收集代码 → 安全/加密分析 → Hook 关联 |
| `analyze_pipeline` | `--url*` | Pipeline 编排演示：采集 → 并行分析（加密+混淆） → 报告 |
| `auto_hook` | `--url*` | 自动生成并注入 Hook（基于 preset 或自定义选项） |
| `rebuild_bundle` | `--url*` | 从证据构建本地 Node.js 复现环境 |
| `trace_signature_generation` | | 签名追踪：关联网络请求、Hook 诊断、XHR 断点 |
| `recommend_next_step` | | 逆向阶段顾问：根据任务状态推荐下一步动作（Observe/Capture/Rebuild/Patch/PureExtraction/Port） |
| `explain_reverse_stage` | `--stage*` | 解释指定逆向阶段的目标、准入条件、避免事项和推荐工具 |
| `list_parameter_workflows` | | 列出所有已打包的参数 blueprint 工作流 |
| `get_parameter_workflow` | `--id*` | 按 id 或别名获取指定参数工作流详情（含 parts/mutations） |
| `recommend_parameter_workflow` | `--query*` | 按关键词或自然语言推荐最匹配的参数工作流 |

---

## 2. 工具发现（Tool Discovery, 1）

`search` profile 下的核心入口，用于在 LLM 上下文极紧时按需发现工具。

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `search_tools` | `--query*` | 按自然语言查找工具，返回名称/描述/域/所属 profile |

---

## 3. DOM 操作（DOM, 3）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `query_dom` | `--selector*` | CSS 选择器查询 DOM 元素（支持批量） |
| `get_dom_structure` | | 获取 DOM 树结构（可指定 maxDepth） |
| `find_clickable_elements` | | 查找可点击的按钮/链接（可按文本过滤） |

---

## 4. 网络请求（Network, 2）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `list_network_requests` | | 列出所有请求（支持分页/等待/URL 过滤/header 过滤） |
| `get_network_request` | `--reqid*` | 获取单个请求详情（含响应体） |

---

## 5. 用户输入（Input, 9）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `click` | `--selector*` | 单击/双击元素 |
| `press_key` | `--key*` | 按键/组合键（如 `Control+A`） |
| `fill_form` | | 批量填表单（多 selector + value） |
| `upload_file` | `--selector* --filePath*` | 上传文件（Playwright + filechooser 回退） |
| `hover` | `--selector*` | 鼠标悬停 |
| `drag` | `--fromSelector* --toSelector*` | 拖拽 |
| `click_at` | `--selector*` | CDP 级真实鼠标点击（绕过拦截） |
| `set_files` | `--selector* --filePaths*` | CDP 级设置文件（绕过拦截） |
| `fill` | `--selector* --value*` | 填充输入框/下拉框（自动处理 select） |

---

## 6. 页面操作（Page, 11）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `click_element` | `--selector*` | CSS 选择器点击（Playwright 路径） |
| `type_text` | `--selector* --text*` | 输入文本（可指定 delay 模拟） |
| `wait_for_element` | `--selector*` | 等待元素出现 |
| `scroll_by` | `--direction*` | 滚动页面（up/down/top/bottom，自动等懒加载） |
| `save_session_state` | | 保存会话（Cookie/Storage） |
| `restore_session_state` | `--sessionId*` | 恢复会话（可预先清空 Storage） |
| `list_session_states` | | 列出已保存会话 |
| `delete_session_state` | `--sessionId*` | 删除会话 |
| `dump_session_state` | `--sessionId*` | 导出会话到文件（支持 pretty/encrypt） |
| `load_session_state` | | 加载会话（file/JSON，可覆盖） |
| `check_browser_health` | | 检查浏览器连接健康（用于开局连通性探测） |

---

## 7. 导航（Navigation, 4）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `list_pages` | | 列出所有页面（index/url/title） |
| `select_page` | `--pageIdx*` | 切换当前页面 |
| `new_page` | `--url*` | 新建页面并导航（支持 preloadHook/preloadPreset） |
| `navigate_page` | | 导航（URL/back/forward/reload，可忽略缓存） |

---

## 8. 截图与视频（Media, 4）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `take_screenshot` | | 截图（全页/元素/PNG/JPEG） |
| `capture_video_frame` | `--selector*` | 捕获视频当前帧（可先 seek） |
| `get_video_info` | `--selector*` | 获取视频元素信息（duration/currentTime/paused/src） |
| `seek_video` | `--selector* --time*` | 跳转视频时间点 |

---

## 9. 设备模拟（Emulation, 4）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `emulate_mobile` | `--enable*` | 模拟移动设备（可选 device preset） |
| `emulate_network` | `--throttlingOption*` | 模拟网络（Slow 3G / Fast 3G / Offline 等） |
| `emulate_cpu` | `--throttlingRate*` | CPU 节流（4=4× 减速） |
| `resize_page` | `--width* --height*` | 调整视口尺寸 |

---

## 10. 反检测（Stealth, 4）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `set_user_agent` | `--userAgent*` | 设置自定义 UA |
| `inject_stealth` | | 注入反检测脚本（先 `list_stealth_presets`） |
| `list_stealth_features` | | 列出可用反检测功能 |
| `list_stealth_presets` | | 列出可用反检测预设 |

---

## 11. 性能（Performance, 4）— full profile

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `start_performance_trace` | `--reload* --autoStop*` | 开始性能追踪 |
| `stop_performance_trace` | | 停止并分析 |
| `get_performance_metrics` | | 获取性能指标（navigation/resource/paint） |
| `performance_analyze_insight` | `--insightName*` | 分析特定性能洞察 |

---

## 12. 调试器（Debugger, 31）— full profile

> **建议路径**：Hook 优先。调试器工具用于"Hook 拿不到局部变量"或"需要暂停态"的场景。
> 详细策略：`references/decision-guide.md` "Hook vs 断点" 表格 + `references/hook-patterns.md`。

### 12a. 断点管理

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `set_breakpoint` | `--url* --lineNumber*` | 按 URL + 行号设断点（可加 condition） |
| `set_breakpoint_on_text` | `--text*` | 按代码文本设断点（自动定位 urlFilter 匹配处） |
| `remove_breakpoint` | `--breakpointId*` | 移除断点 |
| `list_breakpoints` | | 列出所有活跃断点 |

### 12b. 执行控制

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `resume` | | 从暂停恢复 |
| `pause` | | 暂停 JS 执行 |
| `step_into` | | 单步进入（返回暂停态信息） |
| `step_over` | | 单步跳过 |
| `step_out` | | 单步跳出 |
| `xhr_to_js_breakpoint` | | XHR 断点（命中后用 `get_paused_info` 定位 JS 断点） |
| `break_on_xhr` | `--url*` | XHR/Fetch URL 触发断点 |
| `remove_xhr_breakpoint` | `--url*` | 移除 XHR 断点 |
| `start_continuous_debugging` | | 开始连续调试会话（注意：当前未接入 AIContinuousDebugger 运行时） |
| `stop_continuous_debugging` | | 停止连续调试会话 |

### 12c. 脚本与源码

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `list_scripts` | | 列出所有已加载脚本（id/url/sourceMap） |
| `get_script_source` | `--scriptId*` | 获取脚本源码（支持行范围/字符偏移） |
| `search_in_sources` | `--query*` | 在所有源码中搜索（正则） |
| `find_in_script` | `--scriptId* --query*` | 在指定脚本中搜索（返回行号+上下文） |

### 12d. 暂停态与调用栈

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `get_paused_info` | | 获取暂停态信息（调用栈/作用域/位置） |
| `inspect_locals` | | 检查所有栈帧的局部变量摘要 |
| `evaluate_on_callframe` | `--expression*` | 在指定调用帧上下文执行 JS 表达式 |
| `inspect_object` | `--expression*` | 深度检查 JS 对象（属性/原型/方法） |
| `get_request_initiator` | `--requestId*` | 获取网络请求的 JS 调用栈（发起者） |

### 12e. 函数级追踪（不暂停）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `hook_function` | `--target*` | Hook 函数：记录调用/参数/返回值（**不暂停，推荐**） |
| `unhook_function` | `--hookId*` | 移除函数 Hook |
| `trace_function` | `--target*` | 日志点追踪函数调用（条件断点方式，**不暂停**） |
| `list_hooks` | | 列出所有活跃 Hook |

### 12f. 存储 / 状态 / 状态查询

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `get_storage` | | 获取 Cookie/localStorage/sessionStorage |
| `get_ai_debug_status` | | 获取调试状态概览（暂停态/断点数/脚本数） |
| `monitor_events` | | 监控 DOM 事件（可指定事件类型） |
| `stop_monitor` | `--monitorId*` | 停止事件监控 |

---

## 13. Hook 系统（Hook, 6）

通用 Hook 生命周期管理（声明式 + 数据回传）。

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `create_hook` | `--type*` | 创建 Hook 脚本，支持 type: `function` / `fetch` / `xhr` / `property` / `cookie` / `websocket` / `eval` / `timer` |
| `inject_hook` | `--hookId* --script*` | 注入 Hook 脚本（`--persistent true` 跨页面生效） |
| `get_hook_data` | | 获取 Hook 捕获数据（支持 raw/summary/detail + 过滤） |
| `remove_hook` | `--hookId*` | 移除 Hook |
| `list_created_hooks` | | 列出所有已创建 Hook |
| `list_persistent_hooks` | | 列出当前 worker 的持久化 Hook |

> **专项 Hook（仍是 first-class 工具）**：
> - `hook_cryptojs` — CryptoJS（AES/DES/MD5/SHA/HMAC）
> - `hook_jsencrypt` — JSEncrypt RSA
> - `hook_smcrypto` — SM-crypto（SM2/SM3/SM4）
> 详见第 20 节 "加密库 Hook"。
>
> **历史命名变更**（v1 时代工具如 `hook_xhr_open` / `hook_fetch` / `hook_date_now` 等已**下线**）。当前统一用 `create_hook --type <t>` + `inject_hook` 实现。用法见 `references/hook-patterns.md`。

---

## 14. 对话框与帧（Dialog / Frames, 3）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `handle_dialog` | `--action*` | 处理 alert/confirm/prompt（accept/dismiss） |
| `list_frames` | | 列出所有帧（含 iframe，返回 index/name/url 树） |
| `select_frame` | `--frameIdx*` | 切换到指定帧上下文（影响后续 evaluate_script/hook） |

---

## 15. 脚本执行（Script, 2）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `evaluate_script` | `--function*`（也接受 `--script`） | 在页面执行 JS（page / content-script 上下文） |
| `inject_preload_script` | `--script*`（也接受 `--preset`） | 注入预加载脚本（对未来文档生效） |

---

## 16. 站点经验（Site Experience, 5）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `search_site_experience` | | 按 URL/名称搜索 |
| `list_site_experiences` | | 列出所有条目 |
| `create_site_experience` | `--domain* --name*` | 创建站点经验 |
| `update_site_experience` | `--id*` | 更新条目 |
| `delete_site_experience` | `--id*` | 删除条目 |

---

## 17. 扩展管理（Extensions, 1）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `update_extensions` | | 点击 chrome://extensions/ 的更新按钮 |

---

## 18. 代码分析（Analyzer, 7）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `deobfuscate_code` | `--code*` | AI 辅助 JS 去混淆（可选 `--aggressive` / `--renameVariables`） |
| `understand_code` | `--code*` | AI + 静态分析（结构/业务/安全，`--focus` 可选） |
| `summarize_code` | | 代码/项目级摘要（`--mode file|project`，可用 `--url`） |
| `detect_crypto` | `--code*` | 检测加密算法/库（可选 `--useAI`） |
| `risk_panel` | | 综合风险评分（分析器 + 加密检测 + Hook 信号） |
| `record_reverse_evidence` | `--taskId* --taskSlug* --targetUrl* --goal* --entry*` | 记录逆向证据到 task artifact |
| `export_session_report` | | 导出会话报告（JSON/Markdown，可包含 Hook 数据） |

---

## 19. 代码收集（Collector, 3）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `collect_code` | `--url*` | 从页面收集 JS（`smartMode`: summary/priority/incremental/full） |
| `collection_diff` | | 比较前后收集差异 |
| `search_in_scripts` | `--pattern*` | 在收集的脚本缓存中正则搜索 |

---

## 20. 本地复现（Rebuild, 2）— full profile

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `export_rebuild_bundle` | `--taskId* --taskSlug* --targetUrl* --goal*` | 导出本地复现 Bundle（`env/entry.js` + `env/env.js` + `env/polyfills.js` + `env/capture.json`） |
| `diff_env_requirements` | `--runtimeError*` | 对比本地运行时差异，建议环境补丁（仅辅助，不替代代理日志） |

---

## 21. 反调试（Anti-Debug, 2）— full profile

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `anti_anti_debug` | | 一键反调试：固定窗口/冻结时间/拦截跳转/屏蔽 webdriver |
| `bypass_debugger` | | 绕过无限 `debugger` 语句（从 eval/Function/constructor 移除） |

---

## 22. 加密库 Hook（Crypto, 3）— full profile

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `hook_cryptojs` | | Hook CryptoJS（AES/DES/MD5/SHA/HMAC） |
| `hook_jsencrypt` | | Hook JSEncrypt RSA（公私钥/明文/密文） |
| `hook_smcrypto` | | Hook SM-crypto（SM2/SM3/SM4） |

---

## 23. WebAssembly（Wasm, 9）— full profile

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `wasm_capabilities` | | 检测本地 Wasm 工具链（wabt / binaryen / wasmtime / wasmer） |
| `wasm_dump` | | 导出 .wasm 文件到磁盘 |
| `wasm_disassemble` | `--inputPath*` | .wasm → WAT 反汇编 |
| `wasm_decompile` | `--inputPath*` | .wasm 反编译（含函数摘要 + 可疑模式） |
| `wasm_inspect_sections` | `--inputPath*` | 检查 Wasm 段（段图/函数签名/字符串扫描） |
| `wasm_offline_run` | `--inputPath* --functionName*` | 离线执行 Wasm 函数（wasmtime/wasmer） |
| `wasm_optimize` | `--inputPath*` | 用 binaryen wasm-opt 优化 |
| `wasm_vmp_trace` | | 追踪 Wasm 运行时事件（VMP 调试） |
| `wasm_memory_inspect` | | 检查 Wasm Memory 导出（hex/ascii + 模式搜索） |

---

## 24. 代码模板（Code Templates, 3）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `list_code_templates` | | 列出可用代码模板 |
| `get_code_template` | `--templateName*` | 读取代码模板（返回 source + description + size） |
| `inject_code_template` | `--templateName*` | 注入代码模板到页面（`frame.evaluate`） |

---

## 25. WebSocket（4）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `list_websocket_connections` | | 列出所有 WS 连接（按页过滤） |
| `analyze_websocket_messages` | `--wsid*` | **必做**：分析消息模式/分组（binary/protobuf 必看） |
| `get_websocket_messages` | `--wsid*` | 获取 WS 消息（按 direction/groupId/page 过滤） |
| `get_websocket_message` | `--wsid* --frameIndex*` | 获取单条消息 |

---

## 26. Console（2）

| 工具 | 必填参数 | 用途 |
|------|----------|------|
| `list_console_messages` | | 列出所有 console 消息（按 type 过滤/分页/包含 preserved） |
| `get_console_message` | `--msgid*` | 获取单条 console 消息的详细结构 |

---

## 27. 浏览器连接管理（隐藏于 Page, 1）

`check_browser_health` 在第 6 节"页面操作"。但在新会话开局时它有特殊地位 — 通常作为**第一个工具调用**：

```bash
browsercli call check_browser_health
# → {status: "ok", pageCount: 3, cdpConnected: true}
```

健康检查失败时不要继续往下走，回到 `start` / `connect` 阶段。

---

## 工具别名 & 模糊匹配

- 连字符 ↔ 下划线自动转换：`observe-flow` ⇄ `observe_flow`
- `evaluate_script` 接受 `--script` 等价于 `--function`（易用性别名）
- 错误工具名返回模糊匹配建议（如 `hook_crypto` → `hook_cryptojs`）
- 复杂参数用 `--file params.json` 避免 PowerShell/bash 转义

---

## 按场景的"必带"工具清单

| 场景 | 至少要掌握 |
|------|----------|
| 任何任务 | `check_browser_health` / `list_pages` / `select_page` / `navigate_page` |
| 网络分析 | `list_network_requests` / `get_network_request` / `get_request_initiator` |
| 签名定位 | `create_hook --type fetch\|xhr` / `hook_function` / `trace_function` / `search_in_sources` |
| 加密检测 | `detect_crypto` / `hook_cryptojs` / `hook_jsencrypt` / `hook_smcrypto` |
| 反调试 | `anti_anti_debug` / `bypass_debugger` + `create_hook --type timer` |
| 复现导出 | `export_rebuild_bundle` / `diff_env_requirements` / `record_reverse_evidence` |
| 去混淆 | `deobfuscate_code` / `understand_code` / `summarize_code` / `risk_panel` |
| WebSocket | `analyze_websocket_messages` / `get_websocket_messages` |
| Wasm | `wasm_capabilities` / `wasm_dump` / `wasm_decompile` |
| 反检测 | `inject_stealth` / `set_user_agent` / `emulate_mobile` |
| 设备调试 | `emulate_network` / `emulate_cpu` / `resize_page` |
| 阶段规划 | `recommend_next_step` / `explain_reverse_stage` / `recommend_parameter_workflow` |
