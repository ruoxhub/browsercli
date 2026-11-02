# 故障排查指南

这份文档集中回答 daemon 会话、浏览器连接和工具调用里最常见的问题。

建议排查顺序：

1. 在项目目录执行 `npm install && npm run build`
2. `browsercli status` 确认会话与 daemon 状态
3. `browsercli browser status` 确认浏览器连接状态
4. 调用 `diagnose_environment` 做环境自检
5. 接管浏览器前先用 `http://127.0.0.1:9222/json/version` 确认 remote debugging 已开启
6. 页面取证前再调用 `check_browser_health` 和 `list_pages`

## `browsercli` 连不上或没有会话

`browsercli` 通过本地命名管道（POSIX 为 unix socket）与 detached daemon 通信，
按 workspace-hash 在注册表（`%LOCALAPPDATA%\browsercli\daemon`）里发现会话；
连不上就自动 spawn daemon 并等 stdout 就绪行握手。

常见原因：

- 项目还没构建，`build/src/cli/bin/browsercli.js` 不存在或还是旧版本
- 当前工作目录不是当初拉起会话时的工作目录（注册表按 workspace 定位）
- 旧 daemon 进程残留但 socket 已失效

推荐修复：

```bash
npm install
npm run build
browsercli status      # 看注册表里各会话是否活着
browsercli open        # 探活，失败则自动 spawn 新 daemon
browsercli kill-all    # 强杀全部孤儿 daemon 并清理注册表
```

`browsercli kill-all` 只对带 `--browsercli-daemon` 标记的进程生效，不会误杀手动
起的 daemon。

## 工具列表数量不对或想只看高频工具

```bash
browsercli list-tools            # 默认列全部
browsercli list-tools --json     # 机器可读
```

当前工具面：`full` 114 个，`workflow` profile 62 个。完整清单见
[`../reference/tool-reference.md`](../reference/tool-reference.md)。

## 启动后访问地址不通

browsercli 不是 HTTP Web 服务，daemon 只监听本地命名管道，没有一个需要用浏览器
访问的项目主页。

如果你要接管已打开的 Chrome，需要访问的是 Chrome remote debugging 地址：

```bash
http://127.0.0.1:9222/json/version
```

这个地址能返回 `webSocketDebuggerUrl`，才说明浏览器远程调试端口已经打开。

启动 Chrome 示例：

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-mcp
```

然后让 browsercli 接管：

```bash
browsercli browser connect --browser-url "http://127.0.0.1:9222"
```

`chrome://inspect/#remote-debugging` 模式下 Chromium 会关闭 `/json/*` 端点
（返回 404），此时改用自动探测：

```bash
browsercli browser connect --auto-connect
```

注意：

- 目标业务网站地址不是 `--browser-url`
- remote debugging 地址只填 HTTP 端点，`--browser-url` 与 `--ws-endpoint` 二选一
- 如果 `json/version` 都打不开且 `--auto-connect` 也探测不到，就接管不了这个浏览器

## 代码分析没有内置 AI 了

LLM 集成已彻底移除（`src/services/`、`understand_code` / `summarize_code` /
`risk_panel` / `analyze_target` / `detect_crypto` 等工具、config 的 openai /
llmProvider、Web 控制台均已删除），因此：

- 不存在 `useAI` 参数或 `aiRuntime` / provider 状态；
- `diagnose_environment` 不再返回 AI selection 检查；
- 不再需要 `DEFAULT_LLM_PROVIDER` / `OPENAI_API_KEY` 等环境变量。

需要分析时，用 `collect_code` / `search_in_scripts` / `get_script_source` /
`get_hook_data` 采集证据后由调用方 Agent 自行分析。

## Codex 不愿意继续分析

把任务限定在你拥有或已获授权的目标上，并使用调试、兼容性验证、参数定位、本地复现这类明确的工程目标。

推荐表达：

- 我已获授权分析这个页面，请观察请求、脚本和运行时调用链
- 帮我定位我自己系统里的签名参数生成位置，并导出本地复现工程便于兼容性测试
- 先采证据，再 hook，再补环境，不要跳过证据直接猜

不要要求模型绕过访问控制、窃取凭证、攻击第三方系统或规避安全限制。遇到模型拒绝时，优先补充授权范围、目标页面归属、允许做的操作和预期交付物。

建议入口：

- [docs/reference/reverse-bootstrap.md](../reference/reverse-bootstrap.md)
- [docs/reference/case-safety-policy.md](../reference/case-safety-policy.md)
- [docs/reference/reverse-workflow.md](../reference/reverse-workflow.md)
