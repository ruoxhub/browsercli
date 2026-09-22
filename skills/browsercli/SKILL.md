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

## 1. 快速入门与 Daemon 会话运维

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

# 默认启动 Chromium 浏览器连接
browsercli browser connect

# 以源码级防检测 CloakBrowser 启动（强反爬站点推荐，独立 profile 隔离）
browsercli browser connect --cloak

# 无头模式与自定义执行路径
browsercli browser connect --headless --executable-path "/path/to/chrome"

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

### Web 控制台

```bash
# 启动并自动打开 Web 可视化控制台
browsercli web

# 停止 Web 控制台
browsercli web stop
```

### 长耗时任务救援与任务队列

```bash
# 查看当前正在执行的阻塞工具任务
browsercli jobs list
browsercli jobs list --json

# 取消卡住的任务
browsercli jobs cancel <job-id>
```

---

## 2. 核心逆向方法论与反检测哲学

严格遵循四大核心逆向准则：**Observe-first（观察优先）**、**Hook-preferred（Hook 优于断点）**、**Breakpoint-last（断点兜底）** 与 **Evidence-first（证据沉淀）**。

```text
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌───────────────────────┐
│ 1. 观察流量      │ ──> │ 2. 非阻塞拦截     │ ──> │ 3. 分析与追踪   │ ──> │ 4. 算法复现与证据     │
│ 接口与发起栈定位 │     │ 动态 Hook / 探针 │     │ AST反混淆/断点  │     │ 离线补环境 / 报告闭环 │
└─────────────────┘     └──────────────────┘     └─────────────────┘     └───────────────────────┘
```

1. **Observe-first（观察优先）**：先通过网络嗅探 `list_network_requests` 锁定目标接口，调用 `get_request_initiator` 获取发起者调用栈，使用 `list_scripts` / `collect_code` 收集脚本，不破坏页面运行状态。
2. **Hook-preferred（Hook 优于断点）**：优先使用非阻塞 Hook（`hook_function`、`create_hook` + `inject_hook`）截取动态参数、密钥与返回值，避免冻结主线程导致心跳超时或触发防调试检测。加密库与 JSVMP 的专用拦截脚本见 `skills/web-reverse-hook`。
3. **Breakpoint-last（断点兜底）**：仅在深层控制流混淆、动态作用域变量检查时才使用断点（`set_breakpoint`、`break_on_xhr`、`step_into`、`inspect_locals`）。
4. **Evidence-first（证据沉淀）**：逆向产出必须可验证，把结构化结论写入 `artifacts/tasks/<task-id>/`（证据落盘工具已随 `src/tools/analyzer` 下线）。

### 反检测分层哲学（零 JS 注入防护）

- **协议层（Patchright）**：默认启用。不预先开启 `Runtime.enable`，保持 CDP 域干净无特征。
- **源码层（CloakBrowser 二进制）**：`browsercli browser connect --cloak` 启用，49 个 C++ patch，profile 与普通模式物理隔离。
- **启动参数层**：默认走最小集 `MINIMAL_STEALTH_ARGS`，严禁在默认启动路径上追加已废弃的被检自动化 flag。
- **JS 注入层（StealthScripts）**：默认**不**注入。严禁隐式全局注入，仅在特定场景由用户通过 `inject_stealth` 或 `--js-stealth` 显式 opt-in。

---

## 3. 模块化工具速查索引 (Tool Reference Index)

各领域工具的详细参数签名与使用示例已模块化整理在 `references/` 目录中，可按需精读：

| 分类 / 领域              | 详细参考文档                                               | 涵盖的核心能力与代表工具                                                                                                                                                                   |
| :----------------------- | :--------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **浏览器与页面控制**     | [`references/browser.md`](./references/browser.md)         | 多标签管理、iframe 切换、视口控制、设备/网络模拟、健康检查 (`list_pages`, `new_page`, `select_frame`, `emulate_mobile`, `check_browser_health`)                                            |
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

---

## 4. 典型逆向实战手册 (Playbooks)

### 实战 A：请求签名逆向全链路定位（从接口到源码与 Hook）

1. 过滤网络请求定位签名字段所在的接口：

   ```bash
   browsercli call list_network_requests --urlFilter "/api/v1/order"
   ```

2. **核心破局**：查询该网络请求的 JavaScript 发起者调用栈：

   ```bash
   browsercli call get_request_initiator --requestId <reqid>
   ```

3. 依据调用栈返回的 `scriptId` 和行号范围截取源码：

   ```bash
   browsercli call get_script_source --scriptId <scriptId> --startLine 120 --endLine 180 --filePath "artifacts/sources/sign_logic.js"
   ```

4. 安装非阻塞 Hook 截获签名函数参数与密钥：

   ```bash
   browsercli call hook_function --target "window.calcSign" --hookId "sign_hook" --logArgs true --logResult true
   ```

5. 触发页面交互并提取运行时拦截数据：

   ```bash
   browsercli call click --selector "button#submit"
   browsercli call get_hook_data --hookId "sign_hook" --view detail
   ```

6. 导出当前会话的 Cookie 与 Storage 状态快照：

   ```bash
   browsercli call get_storage --type cookies
   ```

### 实战 B：绕过定时器死循环 debugger 与反反调试

当页面遭遇 `setInterval` 触发的无限 `debugger;` 陷阱或窗口检测时：

```bash
# 1. 动态过滤并消除 eval/Function 构造器中的 debugger 关键字
browsercli call bypass_debugger

# 2. 启用反反调试防护罩（固定视口、冻结时间偏差、阻止历史导航）
browsercli call anti_anti_debug
```

### 实战 C：JSVMP 虚拟机加固保护逆向分析

面对复杂字节码解释执行的 JSVMP 防护（如高强度风控 Token 计算）：

1. 在目标页面或 SDK 初始化前注入运行时探针（探针脚本由 `skills/web-reverse-hook` 生成）：

   ```bash
   node skills/web-reverse-hook/scripts/build-hook.js jsvmp-transparent --script-url app.js --out jsvmp.js
   browsercli call evaluate_script --file jsvmp.js
   ```

2. 采集当前环境基准指纹，用于离线环境比对（生成器见 `skills/web-reverse-env/scripts/compare-env.js`）：

   ```bash
   node skills/web-reverse-env/scripts/compare-env.js \
     --properties navigator.userAgent,screen.width,devicePixelRatio --out env.js
   browsercli call evaluate_script --file env.js
   ```

### 实战 D：WebAssembly (Wasm) 核心加密模块分析

1. 重导航并拦截网络加载与运行时动态编译的 Wasm 模块：

   ```bash
   browsercli call collect_wasm --url "https://example.com/security" --waitAfterLoadMs 3000 --captureBase64 <bool>
   ```

2. 将 Wasm 导出到磁盘本地文件：

   ```bash
   browsercli call wasm_dump --moduleIndex 0 --outputPath "artifacts/wasm/core.wasm"
   ```

3. 追踪 JS 与 Wasm 跨边界参数传递，或搜索线性内存：

   ```bash
   browsercli call wasm_vmp_trace --maxEvents 100
   browsercli call wasm_memory_inspect --searchPattern "token=" --length 1024
   ```

4. 导出后可结合 `skills/wsam-reverse` 进行离线反编译（`wasm-decompile`）与静态代码审计。

---

## 5. 离线算法还原与交付闭环

逆向分析提取出核心算法后，交付标准化闭环流程：

1. **沉淀结构化证据**：把调用关系、入参、出参和密钥常量写入 `artifacts/tasks/<task-id>/`。
2. **纯算法提取与精简**：调用 `skills/web-reverse-algorithm` 与 `skills/ast-deobfuscation` 剥离无用的混淆分支和冗余包装器。
3. **Node.js 离线环境对齐**：使用 `skills/web-reverse-env` 与 `skills/web-js-env-patcher`，对照真实浏览器采集的环境基准（`skills/web-reverse-env/scripts/compare-env.js` 生成采集脚本）进行最小化 Mock，确保离线执行计算结果与浏览器输出 100% 严格一致。
