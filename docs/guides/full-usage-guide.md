# JSReverser-MCP 完整使用指南

## 目录

1. [项目简介](#1-项目简介)
2. [核心方法论](#2-核心方法论)
3. [快速开始](#3-快速开始)
4. [浏览器连接方式](#4-浏览器连接方式)
5. [客户端配置](#5-客户端配置)
6. [工具能力一览](#6-工具能力一览)
7. [完整逆向工作流](#7-完整逆向工作流)
8. [补环境规范](#8-补环境规范)
9. [纯算法提纯](#9-纯算法提纯)
10. [任务产物管理](#10-任务产物管理)
11. [外部 AI 配置](#11-外部-ai-配置)
12. [常见问题](#12-常见问题)

---

## 1. 项目简介

### 1.1 是什么

**JSReverser-MCP** 是一个将前端 JavaScript 逆向流程标准化的 MCP（Model Context Protocol）服务。它的目标不仅是做页面调试，而是把整个逆向工程流程串成一套可复用的工作流：

- **页面观察** → 发现目标请求和脚本
- **运行时采样** → Hook 采样关键函数调用
- **本地复现** → 导出 rebuild bundle
- **补环境** → 在 Node 中逐项补齐缺失的浏览器能力
- **证据沉淀** → 把关键数据写入 task artifact

### 1.2 适用场景

- 请求签名参数逆向（如京东 h5st、抖音 a-bogus）
- 风控参数定位（如某手 falcon）
- 加密参数提取
- 页面运行时行为分析
- 本地 Node 复现与移植

---

## 2. 核心方法论

本项目遵循一套经过验证的逆向工程方法论：

| 原则                         | 含义                                       |
| ---------------------------- | ------------------------------------------ |
| `Observe-first`              | 先在浏览器里确认请求、脚本、函数和依赖来源 |
| `Hook-preferred`             | 先做最小化 Hook 采样，不优先使用断点       |
| `Breakpoint-last`            | 当 Hook 不够时才进入暂停式调试             |
| `Rebuild-oriented`           | 把页面证据导出为本地可复现工程             |
| `Evidence-first`             | 每一步都沉淀为 task artifact               |
| `Pure-extraction-after-pass` | 补环境通过后再进入纯算法提纯               |

### 2.1 执行顺序

```
1. 页面观察 → 2. 运行时采样 → 3. 证据入库 → 4. local rebuild
→ 5. 逐项补环境 → 6. first divergence 定位 → 7. 纯算法提纯
```

### 2.2 默认原则

- ❌ 不要跳过页面证据直接猜环境
- ❌ 不要一次性全量模拟浏览器
- ❌ 不要把真实任务目录直接提交 Git

---

## 3. 快速开始

### 3.1 安装依赖并构建

```bash
# 1. 克隆项目后，进入目录
cd JSReverser-MCP

# 2. 安装依赖
npm install

# 3. 构建项目
npm run build
```

构建完成后，入口文件为：`build/src/index.js`

### 3.2 启动方式

#### 方式一：直接启动（自动打开浏览器）

```bash
npm run start
```

这种方式会由 MCP 自动启动一个 Chrome 实例，适合快速验证服务是否正常工作。

#### 方式二：调试模式启动

```bash
npm run start-debug
```

启动时带有更详细的日志输出，便于排查问题。

---

## 4. 浏览器连接方式

### 4.1 为什么要直连浏览器

如果你已经手动登录、完成了验证码或复杂交互，直接接管当前 Chrome 比重新打开一个干净实例更实用：

- ✅ 复用登录态
- ✅ 复用 Cookie / Storage
- ✅ 保留手动操作后的页面状态

### 4.2 启动带 remote debugging 的 Chrome

#### Windows

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\tmp\chrome-mcp"
```

#### macOS

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mcp
```

#### Linux

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mcp
```

### 4.3 确认 remote debugging 已开启

访问：`http://127.0.0.1:9222/json/version`

如果能看到 `webSocketDebuggerUrl`，说明 remote debugging 已正常开启。

### 4.4 连接方式选择

| 方式            | 命令                                   | 适用场景             |
| --------------- | -------------------------------------- | -------------------- |
| `--browserUrl`  | `--browserUrl http://127.0.0.1:9222`   | 最简单，适合新手     |
| `--wsEndpoint`  | `--wsEndpoint ws://127.0.0.1:9222/...` | 更精确，已知具体实例 |
| `--autoConnect` | `--autoConnect`                        | 本机端口固定为 9222  |

示例：

```bash
node build/src/index.js --browserUrl http://127.0.0.1:9222
```

### 4.5 验证连接成功

推荐验证顺序：

1. 手动打开一个目标页面
2. 启动 MCP
3. 调用 `list_pages` - 查看是否出现你打开的页面
4. 调用 `list_network_requests` 或 `list_scripts`

如果能看到当前页面的请求和脚本，说明接管成功。

---

## 5. 客户端配置

### 5.1 Claude Code

```bash
# 最简单配置
claude mcp add js-reverse node /ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js

# 接管已打开的 Chrome
claude mcp add js-reverse node /ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js -- --browserUrl http://127.0.0.1:9222
```

### 5.2 Cursor

`Settings → MCP → New MCP Server`

- Command: `node`
- Args: `[/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js]`

如需接管浏览器，Args 改为：

```json
[
  "/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js",
  "--browserUrl",
  "http://127.0.0.1:9222"
]
```

### 5.3 Codex

在 `config.toml` 中配置：

```toml
[mcp_servers.js-reverse]
command = "node"
args = [
  "/ABSOLUTE/PATH/JSReverser-MCP/build/src/index.js",
  "--browserUrl",
  "http://127.0.0.1:9222"
]
```

---

## 6. 工具能力一览

### 6.1 页面观察与脚本定位

| 工具                | 用途                        |
| ------------------- | --------------------------- |
| `list_scripts`      | 列出当前页面已加载的脚本    |
| `get_script_source` | 查看指定脚本源码            |
| `find_in_script`    | 在单个脚本里定位字符串/变量 |
| `search_in_scripts` | 批量搜索已采集的脚本        |

### 6.2 Hook 与运行时采样

| 工具             | 用途                        |
| ---------------- | --------------------------- |
| `create_hook`    | 创建可复用的 hook 定义      |
| `inject_hook`    | 注入 hook 到页面开始采样    |
| `get_hook_data`  | 读取 hook 采集的调用记录    |
| `hook_function`  | 直接 hook 全局函数/对象方法 |
| `trace_function` | 按源码函数名追踪调用链      |

### 6.3 断点与调试控制

| 工具                     | 用途                      |
| ------------------------ | ------------------------- |
| `set_breakpoint`         | 按脚本 URL 和行号设置断点 |
| `set_breakpoint_on_text` | 按代码文本自动定位断点    |
| `resume`                 | 继续执行到下一个断点      |
| `pause`                  | 手动暂停 JS 执行          |
| `step_over`              | 单步，跳过函数            |
| `step_into`              | 单步，进入函数            |
| `step_out`               | 单步，跳出函数            |

### 6.4 网络请求分析

| 工具                    | 用途                 |
| ----------------------- | -------------------- |
| `list_network_requests` | 列出当前页面网络请求 |
| `get_network_request`   | 查看单个请求详细内容 |
| `get_request_initiator` | 追溯请求发起者       |
| `break_on_xhr`          | 在目标请求发出时中断 |

### 6.5 页面状态与存储

| 工具                    | 用途                                        |
| ----------------------- | ------------------------------------------- |
| `check_browser_health`  | 检查浏览器连接状态                          |
| `list_console_messages` | 查看 console 输出                           |
| `get_storage`           | 读取 cookie / localStorage / sessionStorage |
| `evaluate_script`       | 在当前页面执行 JS                           |
| `search_in_sources`     | 在所有源码中搜索关键字                      |

### 6.6 WebSocket 观察

| 工具                         | 用途                |
| ---------------------------- | ------------------- |
| `list_websocket_connections` | 列出 WebSocket 连接 |
| `analyze_websocket_messages` | 按帧特征分组消息    |
| `get_websocket_messages`     | 查看具体消息内容    |

### 6.7 本地复现与补环境

| 工具                      | 用途               |
| ------------------------- | ------------------ |
| `export_rebuild_bundle`   | 导出本地复现工程   |
| `diff_env_requirements`   | 比对缺失的环境能力 |
| `record_reverse_evidence` | 写入 task artifact |

### 6.8 页面自动化

| 工具              | 用途               |
| ----------------- | ------------------ |
| `navigate_page`   | 跳转/回退/刷新页面 |
| `query_dom`       | 查询页面元素       |
| `click_element`   | 触发点击           |
| `type_text`       | 输入文本           |
| `take_screenshot` | 截图取证           |

### 6.9 深度分析

| 工具               | 用途                             |
| ------------------ | -------------------------------- |
| `collect_code`     | 采集页面代码                     |
| `understand_code`  | AI 分析代码结构（需配置外部 AI） |
| `deobfuscate_code` | 去混淆处理                       |
| `risk_panel`       | 综合风险评估                     |

### 6.10 会话与登录态复用

| 工具                    | 用途             |
| ----------------------- | ---------------- |
| `save_session_state`    | 保存当前会话状态 |
| `restore_session_state` | 恢复会话状态     |
| `dump_session_state`    | 导出为 JSON 文件 |
| `load_session_state`    | 从 JSON 加载会话 |

---

## 7. 完整逆向工作流

### 7.1 阶段总览

逆向任务分为 6 个阶段：

```
Observe → Capture → Rebuild → Patch → PureExtraction → Port
```

任何任务都应明确自己当前处于哪个阶段。

### 7.2 详细定义

完整的阶段定义、完成判据和禁止事项，见 [Reverse Workflow 协议](../reference/reverse-workflow.md)。

该文档是 6 阶段工作流的唯一权威来源。以下为本阶段快速参考：

| 阶段              | 一句话目标                     | 完成判据                                   |
| ----------------- | ------------------------------ | ------------------------------------------ |
| 1. Observe        | 确认目标请求、脚本、触发动作   | 能回答"请求谁发起、哪段脚本参与、如何触发" |
| 2. Capture        | Hook 采样运行时数据            | 至少一条可复用的真实运行样本               |
| 3. Rebuild        | 导出本地可运行 Node 工程       | 本地有稳定复现入口，能看到运行错误         |
| 4. Patch          | 按 first divergence 驱动补环境 | env rebuild 稳定跑通，服务端验收通过       |
| 5. PureExtraction | 分离环境噪音和算法输入         | Node pure implementation 与 fixture 对齐   |
| 6. Port           | 迁移到 Python 或其他宿主       | 外部语言版本与 Node pure 对齐              |

---

## 8. 补环境规范

### 8.1 三阶段目标

| 阶段            | 目标                                | 产物                                       |
| --------------- | ----------------------------------- | ------------------------------------------ |
| Node 补环境复现 | 最小依赖集合、确认 first divergence | env/env.js, env/polyfills.js, env/entry.js |
| 可移植 JS 导出  | 减少调试脚手架依赖                  | run/exported-runtime.js                    |
| 纯算法提纯      | 明确输入契约、固定夹具              | run/pure-\*.js                             |

### 8.2 文件职责边界

#### env/env.js

- 提供基础宿主（window/self/global）
- 提供最小 storage shim
- 提供最小编码/加密壳

#### env/polyfills.js

- 放代理诊断层
- 放可复用的函数伪装能力
- 放"缺函数壳"和访问日志辅助逻辑

#### env/entry.js

- 加载 env.js → polyfills.js
- 读 capture.json
- 加载目标脚本
- 输出 first divergence

### 8.3 补丁判定表

| 观测现象                                              | 常见缺口         | 推荐补法                 |
| ----------------------------------------------------- | ---------------- | ------------------------ |
| navigator.userAgent 返回 undefined                    | 基础值缺失       | 直接补最小常量值         |
| document.createElement is not a function              | 函数壳缺失       | 用 makeFunction 挂函数壳 |
| Cannot read properties of undefined (reading 'style') | 返回对象结构缺失 | 给该函数补最小返回对象   |
| localStorage.getItem is not a function                | 宿主对象方法缺失 | 补最小方法集             |
| Illegal invocation / brand check 失败                 | 宿主建模方式错误 | 先修对象形态或 this 绑定 |

### 8.4 推荐判断顺序

```
1. 先跑一次 env/entry.js
2. 看本地报错
3. 读代理诊断日志，定位首个异常访问
4. 记录并确认当前 first divergence
5. 回到页面证据确认真实来源
6. 只补当前 first divergence 对应的最小因果单元
7. 立即重跑 env/entry.js
```

---

## 9. 纯算法提纯

### 9.1 进入条件

只有满足以下条件，才允许进入 PureExtraction：

- ✅ 目标请求、脚本、关键函数已确认
- ✅ 本地 env rebuild 已稳定跑通
- ✅ 已记录至少一条 first divergence 及修复路径
- ✅ 已至少一次服务端验收通过

### 9.2 推荐步骤

1. **Freeze**：固定一条已通过验收的样本
2. **Hook Local Runtime**：在本地 runtime 上继续 hook
3. **Define Boundary**：明确哪些是算法输入、哪些是环境状态
4. **Build Fixture**：在 run/ 下固化夹具
5. **Extract Node Pure**：提纯 Node 纯算实现
6. **Verify Node Pure**：验证与 runtime fixture 对齐
7. **Port**：迁移到 Python 或其他宿主

---

## 10. 任务产物管理

### 10.1 目录结构

```
artifacts/tasks/
├── _TEMPLATE/              # 任务模板
│   ├── task.json
│   ├── runtime-evidence.jsonl
│   ├── network.jsonl
│   ├── scripts.jsonl
│   ├── env/
│   │   ├── env.js
│   │   ├── polyfills.js
│   │   ├── entry.js
│   │   └── capture.json
│   ├── run/
│   └── report.md
└── <task-id>/              # 具体任务目录（本地私有）
    ├── task.json
    ├── runtime-evidence.jsonl
    ├── network.jsonl
    ├── scripts.jsonl
    ├── env/
    │   ├── env.js
    │   ├── polyfills.js
    │   ├── entry.js
    │   └── capture.json
    ├── run/
    └── report.md
```

### 10.2 必备文件

- `task.json` - 任务描述
- `network.jsonl` - 网络请求记录
- `scripts.jsonl` - 脚本列表
- `runtime-evidence.jsonl` - 运行时证据
- `env/env.js` - 基础宿主
- `env/polyfills.js` - 代理诊断层
- `env/entry.js` - 入口
- `env/capture.json` - 页面采集数据
- `report.md` - 任务报告

### 10.3 安全边界

- case 只保留抽象方法和流程
- 真实任务目录默认本地保留
- 敏感值必须脱敏后才允许共享
- Git 默认只提交 `_TEMPLATE`

---

## 11. 外部 AI 配置

### 11.1 支持的 Provider

- `openai` - GPT-4o
- `anthropic` - Claude
- `gemini` - Gemini

### 11.2 配置方式

通过 MCP server 的 `env` 传入：

```toml
[mcp_servers.js-reverse.env]
DEFAULT_LLM_PROVIDER = "anthropic"
ANTHROPIC_API_KEY = "your_key"
ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022"
```

### 11.3 功能依赖

| 功能                         | AI 依赖        |
| ---------------------------- | -------------- |
| `understand_code`            | 强依赖         |
| `detect_crypto(useAI=true)`  | 可选           |
| `analyze_target(useAI=true)` | 可选           |
| `deobfuscate_code`           | 有 AI 效果更好 |
| 其他工具                     | 不依赖         |

---

## 12. 常见问题

### Q1: MCP 启动成功但无法接管浏览器

检查项：

1. Chrome 是否带 `--remote-debugging-port=9222` 启动
2. 访问 `http://127.0.0.1:9222/json/version` 确认 websocket URL 存在
3. `--browserUrl` 和 `--wsEndpoint` 不要同时配置

### Q2: 补环境时一直报 "undefined"

原因：first divergence 定位不准确

建议：

1. 先用 polyfills.js 的代理层看日志
2. 确认是缺基础值、缺函数壳还是缺返回对象
3. 按补丁判定表选择正确补法

### Q3: 环境补完了但服务端验签失败

检查项：

1. 确认 cookie、token 等状态是否正确
2. 检查时间相关字段是否需要同步
3. 确认 first divergence 是否还有遗漏

### Q4: 不知道目标参数在哪个脚本

建议步骤：

1. 用 `list_network_requests` 找到目标请求
2. 用 `get_request_initiator` 追溯发起者
3. 用 `list_scripts` 列出脚本列表
4. 用 `search_in_scripts` 搜索关键字符串

### Q5: Hook 抓不到目标函数

可能原因：

1. 函数名被混淆
2. 函数在 iframe 中
3. 函数是动态生成的

建议：

1. 用 `break_on_xhr` 在请求发出时中断
2. 用 `set_breakpoint_on_text` 按代码文本定位
3. 检查 `list_frames` 确认是否在 iframe 中

---

## 附录：工具索引

完整工具参数说明见 [docs/reference/tool-reference.md](docs/reference/tool-reference.md)

按逆向流程选工具可继续看 [docs/reference/reverse-workflow.md](docs/reference/reverse-workflow.md)
