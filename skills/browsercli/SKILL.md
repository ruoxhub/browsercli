---
name: browsercli
description: 当需要通过 browsercli CLI 控制浏览器自动化、抓取与重放 HTTP/WebSocket 网络请求、追踪请求发起者调用栈、动态注入 JavaScript Hook 与加密拦截、安装 JSVMP 运行时探针、捕获与追踪 WebAssembly、设置断点与单步调试、绕过无限 debugger 与反反调试、模拟真实 DOM 拟人化交互、提取 Cookie/Storage 快照、沉淀逆向证据时使用。只要用户提到“浏览器逆向”、“抓包分析”、“Hook 加密”、“查找签名”、“调试混淆代码”或“browsercli”均应使用。
---

# BrowserCLI 逆向工程与浏览器自动化技能

`browsercli` 是用于浏览器自动化操作、客户端 JavaScript/WebAssembly 逆向工程与流量拦截的核心命令行工具。基于本地命名管道（POSIX 为 Unix Socket）与后台常驻 Daemon 通信。

所有 MCP 工具调用均遵循标准统一格式：

```bash
browsercli call <tool_name> [arguments]
```

---

## 快速入门与 Daemon 会话运维

在展开逆向分析前，优先确保 Daemon 会话与浏览器连接处于健康状态：

### 会话生命周期管理

```bash
# 检查当前工作区活跃会话与环境状态
browsercli status

# 列出注册表中的全部会话
browsercli list

# 拉起或探活当前会话（支持 -s 指定多会话隔离）
browsercli open
browsercli -s=task_01 open

# 正常关闭当前会话
browsercli close

# 异常故障时强杀全部孤儿 daemon 进程
browsercli kill-all
```

### 浏览器连接与反检测控制

**ego lite 是默认浏览器来源。** 不带任何目标参数的 `browsercli browser connect` 直接连接正在运行的 ego lite，复用其真实登录态：

```bash
# 查看当前 Worker 的浏览器连接状态（期望 Mode=ego）
browsercli browser status

# 默认连接 ego lite（无需 --ego，它是默认值）
browsercli browser connect

# 显式写 --ego 等价，便于脚本自证意图
browsercli browser connect --ego

# 显式关闭 ego，改走远程/本地浏览器
browsercli browser connect --ego=false --browser-url "http://127.0.0.1:9222"

# 以源码级防检测 CloakBrowser 启动（强反爬站点推荐，独立 profile 隔离）
browsercli browser connect --cloak

# 本地启动指定渠道 / 自定义执行路径
browsercli browser connect --channel stable
browsercli browser connect --executable-path "/path/to/chrome"

# 强制断开卡死的浏览器连接
browsercli browser disconnect --force
```

默认值只在**完全没得选**时生效：显式 `--ego=false`、`BROWSER_EGO=false`、任一目标参数（`--browser-url` / `--ws-endpoint` / `--channel` / `--executable-path`），或 `--cloak`，都会让默认值让位。未安装 ego lite 的机器上无参 `connect` 会**直接报错并提示设置 `EGO_BROWSER_CLI`**，不会静默降级成本地 Chromium——因为两者的登录态与反检测面完全不同，"连上了哪个浏览器"不能是隐式的。

### ego lite 接管细节（默认来源，复用真实登录态）

ego 不启动新浏览器，而是通过本地 CDP 桥接接管**正在运行的 ego lite**，直接使用其中已登录的真实会话，无需重新配置 Cookie 或应对反爬审批弹窗。

```bash
# 1. 连上 ego —— 无参 connect 就是它，写 --ego 只是把默认值写明
browsercli browser connect

# 2. 确认已进入 ego 模式
browsercli browser status          # 期望 Mode=ego

# 3. 之后的工具调用与普通模式完全一致
browsercli call new_page --url "https://www.baidu.com"
```

**标签页归属与保留策略**

ego 会在独立的 Agent 任务空间（TaskSpace）里建页，与用户私人标签页物理隔离——工具只能看到、也只能操作自己空间内的页面。

```bash
# 断开时保留分析现场，标签页交还给用户手动接管
browsercli browser connect --ego --keep-page

# 不传 --keep-page（默认）：本次新建的任务空间被关闭，其标签页一并消失
browsercli browser disconnect
```

保留策略有一条不在文档表面上的规则：**只有本次运行「新建」的任务空间会被关闭**。若复用了工作区已有的同名空间，或回收了上次遗留的空间，断开时一律保留（转为 `user` 归属），因为其中的标签页不全是本次创建的。所以"默认关闭"只在全新空间上成立。

需要人工复核 Hook 采样结果、断点现场或抓包证据时用 `--keep-page`；纯自动化跑完即弃则保持默认。

**查看任务空间与 Profile**

```bash
# 列出 ego 里的任务空间归属与全部可用 Profile（无需已连接浏览器）
browsercli browser space list
```

输出中的 `Profile ID` 就是 `--profile` 的取值；标记为默认的那个在不指定时使用。

```bash
# 指定新任务空间使用的 Profile（仅在新建空间时生效）
browsercli browser connect --ego --profile "Profile 1"
```

复用已有空间时会保留其原 Profile，并在诊断日志中提示，不会静默切换。

**ego 模式下的参数约束**

```bash
# ❌ 以下参数在 ego 下不生效，会被直接拒绝：
#    --cloak / --headless / --user-data-dir / --isolated
#    --minimal-stealth / --full-stealth-args / --js-stealth / --accept-insecure-certs
browsercli browser connect --ego --cloak

# ❌ ego 与连接目标互斥，不能同时指定：
#    --browser-url / --ws-endpoint / --channel / --executable-path
browsercli browser connect --ego --browser-url http://127.0.0.1:9222
```

ego 模式既不本地启动浏览器，也不附连指定端点，因此上述两类参数都被视为自相矛盾而拒绝。

**已知能力边界**

- ego lite 未实现 `Storage` 域，`get_storage --type cookies` 会失败；`localStorage` / `sessionStorage` 正常。
- 截图要求 ego 窗口处于非最小化状态，否则 `take_screenshot` 报 `Cannot capture a screenshot while the window is minimized`。
- 若工具报 `Task space N does not exist`，说明桥接持有的任务空间已被外部关闭（ego 的 selected task space 是进程级全局状态，其他 ego 客户端可将其切走）。恢复方式：

  ```bash
  browsercli browser disconnect && browsercli browser connect --ego
  ```

### 任务脚手架与全局配置

```bash
# 快速创建标准化逆向工程任务目录与模板文件
browsercli scaffold my-task --url "https://example.com" --goal "提取签名算法"

# 查看与修改全局配置（~/.browsercli/config.json）
browsercli config get
browsercli config set cloak=true
```

### 长耗时任务救援与任务队列

```bash
# 查看当前正在执行的阻塞工具任务
browsercli jobs list
browsercli jobs list --json

# 取消卡住的任务
browsercli jobs cancel <job-id>
```



## 模块化工具速查索引 (Tool Reference Index)

各领域工具的详细参数签名与使用示例已模块化整理在 `references/` 目录中，可按需精读：

| 分类 / 领域              | 详细参考文档                                               | 涵盖的核心能力与代表工具                                                                                                                                                                   |
| :----------------------- | :--------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **浏览器与页面控制**     | [`references/browser.md`](./references/browser.md)         | ego lite 默认接管、多标签管理、iframe 切换、视口控制、设备/网络模拟、健康检查 (`browser connect`, `list_pages`, `new_page`, `select_frame`, `emulate_mobile`, `check_browser_health`)       |
| **脚本收集与源码定位**   | [`references/script.md`](./references/script.md)           | 脚本列举、源码按行截取、全局正则搜索、预加载脚本注入 (`list_scripts`, `get_script_source`, `search_in_sources`, `collect_code`)                                                            |
| **动态 Hook 与加密拦截** | [`references/hook.md`](./references/hook.md)               | 非阻塞 Hook、Hook 生命周期管理、便捷函数 Hook (`create_hook`, `inject_hook`, `get_hook_data`, `hook_function`, `unhook_function`)。加密库 / JSVMP 专用拦截脚本见 `skills/web-reverse-hook` |
| **调试器与断点步进**     | [`references/debugger.md`](./references/debugger.md)       | 行/条件/XHR 断点、单步执行、局部变量检查、日志点追踪、表达式求值 (`set_breakpoint`, `break_on_xhr`, `step_into`, `inspect_locals`, `evaluate_script`, `trace_function`)                    |
| **DOM 交互与样式排查**   | [`references/dom.md`](./references/dom.md)                 | 多定位器查询、拟人化点击/打字、CDP 绝对坐标点击、表单填充、样式层叠排查 (`query_dom`, `click_at`, `type_text`, `fill_form`, `drag`, `take_screenshot`, `get_css_styles`)                   |
| **网络嗅探与 WebSocket** | [`references/network.md`](./references/network.md)         | 网络流量嗅探、**发起者调用栈定位**、请求重放覆写、cURL 导出、WebSocket 帧聚类 (`list_network_requests`, `get_request_initiator`, `replay_network_request`, `export_request_as_curl`)       |
| **反反调试与隐身伪装**   | [`references/stealth.md`](./references/stealth.md)         | 绕过无限 debugger 死循环、反反调试防护罩、User-Agent 自定义、按需隐身预设 (`bypass_debugger`, `anti_anti_debug`, `set_user_agent`, `inject_stealth`)                                       |
| **WebAssembly 逆向**     | [`references/wasm.md`](./references/wasm.md)               | Wasm 模块捕获与磁盘 dump、JS-Wasm 跨边界调用追踪、线性内存搜索 (`collect_wasm`, `wasm_dump`, `wasm_vmp_trace`, `wasm_memory_inspect`)                                                      |
| **会话持久化与媒体控制** | [`references/session.md`](./references/session.md)         | HttpOnly Cookie/Storage 导出、会话快照持久化备份与恢复、视频帧截取 (`get_storage`, `save_session_state`, `restore_session_state`, `capture_video_frame`)                                   |
| **环境诊断与验证码探测** | [`references/evidence.md`](./references/evidence.md)       | 运行环境自检、页面验证码只读探测 (`diagnose_environment`, `detect_captcha`)                                                                                                                |
| **控制台消息日志**       | [`references/console.md`](./references/console.md)         | 控制台 Console 日志采集与单条消息结构化查询 (`list_console_messages`, `get_console_message`)                                                                                               |
| **性能监控与分析**       | [`references/performance.md`](./references/performance.md) | Core Web Vitals 评估、CDP 性能轨迹录制与瓶颈 Insight 诊断 (`start_performance_trace`, `stop_performance_trace`, `get_performance_metrics`)                                                 |
| **全量工具速查字典**     | [`references/model.md`](./references/model.md)             | 全部 113 个 MCP 工具的 A-Z 快速检索字典与参数链接映射                                                                                                                                      |
