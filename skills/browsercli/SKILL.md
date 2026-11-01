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

```bash
# 查看当前 Worker 的浏览器连接状态
browsercli browser status

# 默认启动本地浏览器（以用户配置或系统 Chromium 启动）
browsercli browser connect

# 连接已有的远程 Chrome 实例（CDP 端口接管）
browsercli browser connect --browser-url "http://127.0.0.1:9222"
browsercli browser connect --ws-endpoint "ws://127.0.0.1:9222/devtools/browser/..."

# 以源码级防检测 CloakBrowser 启动（强反爬站点推荐，独立 profile 隔离）
browsercli browser connect --cloak

# 本地启动指定渠道 / 自定义执行路径
browsercli browser connect --channel stable
browsercli browser connect --executable-path "/path/to/chrome"

# 强制断开卡死的浏览器连接
browsercli browser disconnect --force
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

| 分类 / 领域              | 详细参考文档                                         | 涵盖的核心能力与代表工具                                                                                                                                                                   |
| :----------------------- | :--------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **浏览器与页面控制**     | [`references/browser.md`](./references/browser.md)   | 多标签管理、iframe 切换、视口控制、设备/网络模拟、健康检查 (`browser connect`, `list_pages`, `new_page`, `select_frame`, `emulate_mobile`, `check_browser_health`)                         |
| **脚本收集与源码定位**   | [`references/script.md`](./references/script.md)     | 脚本列举、源码按行截取、全局正则搜索、预加载脚本注入 (`list_scripts`, `get_script_source`, `search_in_sources`, `collect_code`)                                                            |
| **动态 Hook 与加密拦截** | [`references/hook.md`](./references/hook.md)         | 非阻塞 Hook、Hook 生命周期管理、便捷函数 Hook (`create_hook`, `inject_hook`, `get_hook_data`, `hook_function`, `unhook_function`)。加密库 / JSVMP 专用拦截脚本见 `skills/web-reverse-hook` |
| **调试器与断点步进**     | [`references/debugger.md`](./references/debugger.md) | 行/条件/XHR 断点、单步执行、局部变量检查、日志点追踪、表达式求值 (`set_breakpoint`, `break_on_xhr`, `step_into`, `inspect_locals`, `evaluate_script`, `trace_function`)                    |
| **DOM 交互与样式排查**   | [`references/dom.md`](./references/dom.md)           | 多定位器查询、拟人化点击/填充、CDP 绝对坐标点击、表单填充、样式层叠排查 (`query_dom`, `click`, `click_at`, `fill`, `fill_form`, `drag`, `take_screenshot`, `get_css_styles`)               |
| **网络嗅探与 WebSocket** | [`references/network.md`](./references/network.md)   | 网络流量嗅探、**发起者调用栈定位**、请求重放覆写、cURL 导出、WebSocket 帧聚类 (`list_network_requests`, `get_request_initiator`, `replay_network_request`, `export_request_as_curl`)       |
| **反反调试与隐身伪装**   | [`references/stealth.md`](./references/stealth.md)   | 绕过无限 debugger 死循环、反反调试防护罩 (`bypass_debugger`, `anti_anti_debug`)                                                                                                            |
| **WebAssembly 逆向**     | [`references/wasm.md`](./references/wasm.md)         | Wasm 模块捕获与磁盘 dump、JS-Wasm 跨边界调用追踪、线性内存搜索 (`collect_wasm`, `wasm_dump`, `wasm_vmp_trace`, `wasm_memory_inspect`)                                                      |
| **会话持久化与存储导出** | [`references/session.md`](./references/session.md)   | HttpOnly Cookie/Storage 导出 (`get_storage`)                                                                                                                                               |
| **环境诊断与验证码探测** | [`references/evidence.md`](./references/evidence.md) | 运行环境自检、页面验证码只读探测 (`diagnose_environment`, `detect_captcha`)                                                                                                                |
| **控制台消息日志**       | [`references/console.md`](./references/console.md)   | 控制台 Console 日志采集与单条消息结构化查询 (`list_console_messages`, `get_console_message`)                                                                                               |
| **全量工具速查字典**     | [`references/model.md`](./references/model.md)       | 全部 93 个 MCP 工具的 A-Z 快速检索字典与参数链接映射                                                                                                                                       |
