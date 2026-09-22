# browsercli 工具问题分析与优化建议

> 基于 browser-rpc 项目中浏览器 RPC / 平台验证实战的体验总结
> 日期：2026-08-24
> 工具版本：browsercli v1.0.0（Worker 报告 146 个工具）
> Worker：`http://127.0.0.1:8765`（transport: http）

---

## 一、目标与边界

本文档只记录本次实战中**实际遇到、可复现或可验证**的问题，并给出最小优化建议。

**证据来源**（均为本会话实际执行的命令输出，非推断）：

- `browsercli status` —— 表格型输出，`Active Sessions: 100`
- `browsercli call list_pages` —— 嵌套 YAML 输出，23 个页面，出现 `selectedIndex: 10` ↔ `selectedPageId: "page-11"` 的错位
- `browsercli jobs list` —— 89 条 job，多次 `evaluate_script failed`，但 job 行无错误原因
- `browsercli list-tools` —— 146 个工具，与 SKILL.md 记录的工具面严重不符
- `browsercli call --help` —— 存在 `--param` / `--data` / `--file` / `--stdin` 四种调用方式

**不做假设**：

- 不假设所有页面、所有会话都会复现同一问题。
- 不把一次 browser-rpc 平台验证实战直接推导为通用产品路线。
- 不建议新增大功能，除非它能修复当前链路中的明确断点。

**成功标准**：

1. 所有命令提供统一的机器可读输出，消费者无需多重回退解析。
2. `evaluate_script` 失败时能返回可诊断的错误原因。
3. SKILL.md 与真实工具面（`list-tools`）保持一致，消除文档漂移。
4. 页面寻址（index 与 pageId）严格一致，自动化脚本不会选错页。

---

## 二、P0：核心稳定性与可用性

### 2.1 输出格式不统一，且嵌套过深

**现象**：同为 CLI，至少存在三种输出形态：

| 命令 | 输出形态 |
|------|---------|
| `status` | 表格（`headers` / `rows`） |
| `call list_pages` 等 | 嵌套 YAML：`result.structuredContent.data.value` |
| `config` | 扁平 `command/action/resolved/file/status` |

`evaluate_script` 的返回值官方文档自己都写了「JSON 值在 `data.value`，兼容字符串在 `result`」这种双路径。

**影响**：消费方必须写脆弱的解析链路。`browser-rpc/scripts/verify_platforms_browsercli.py` 里塞满了保底逻辑——PyYAML 读 stdout → `data.value` 取不到再回退 `result` 字符串 → 再 `json.loads`，还要 `res.get('results') or res.get('results[109]')` 硬编码兜底。

**最小修复建议**：

- 为所有命令统一加 `--format json`（或 `--json`），固定一种 schema，如 `{ ok, data, error }`。
- 表格 / 嵌套 YAML 只作为人类可读的默认展示，机器路径只走 JSON。
- 明确 `evaluate_script` 返回值的唯一契约，不再提供「`data.value` vs `result`」双路径。

**验收标准**：

- 消费者不再依赖 PyYAML 或多重 `.get()` 回退。
- 用 `--format json` 跑任意命令，`JSON.parse(stdout)` 直接得到稳定结构。

### 2.2 `evaluate_script` 失败成黑盒

**现象**：`jobs list` 89 条记录中多次 `evaluate_script failed`，但 job 行只有状态「failed」，看不到任何错误信息。

**影响**：无法定位是 JS 语法错误、页面上下文切换失败、超时还是 Worker 竞争导致。配合 SKILL.md 专门写的 Worker 恢复流程（`jobs cancel`、`browser disconnect --force`），说明卡 job / 失败是常态而非偶发。

**最小修复建议**：

- job 行加一列 `error`，或提供 `browsercli jobs log <job-id>` 查看失败详情。
- `evaluate_script` 失败时至少把 JS 异常的 `message`/`stack` 回填进 job 记录或 stdout。

**验收标准**：

- 任何 `failed` job 都能在不翻阅额外日志的情况下看到原因。
- 语法错误、上下文错误、超时三类失败可在输出中区分。

---

## 三、P1：一致性漂移

### 3.1 SKILL.md 严重滞后于真实工具面

**现象**：`~/.claude/skills/browsercli/SKILL.md` 只覆盖一部分工具，且部分是旧签名。真实 `list-tools` 有 146 个工具，以下整块领域 SKILL.md 完全未记录：

- **JSVMP**：`hook_jsvmp_interpreter`、`analyze_jsvmp_vm`、`analyze_pipeline`
- **性能**：`start_performance_trace` / `stop_performance_trace` / `get_performance_metrics` / `performance_analyze_insight`
- **模拟**：`emulate_mobile` / `emulate_network` / `emulate_cpu` / `resize_page`
- **其他**：`list_console_messages` / `get_console_message`、`inject_preload_script`、`trace_function`、`observe_flow`、`diagnose_environment`、`compare_env`、`update_extensions`

且文档里的 `create_hook --type/--params/...` 签名已是旧形态。

**影响**：Agent（尤其依赖 SKILL.md 的 Claude Code 技能调用）会按过时签名调用，或根本不知道有更优工具可用。

**最小修复建议**：

- 让 SKILL.md 由 `list-tools` 自动生成——`list-tools` 是工具面唯一天实来源，加一个 `--schema json` 输出机器可读签名清单，SKILL.md 由它渲染。
- 至少先手工补上 JSVMP / 性能 / 模拟三大块。

**验收标准**：

- SKILL.md 中的工具名与 `list-tools` 输出集合一致、签名一致。
- 新增工具后，无需手工同步文档。

### 3.2 三种调用风格并存，文档只教了最脆弱的一种

**现象**：`browsercli call --help` 显示有 `--param value` / `--data <json>` / `--file <params.json>` / `--stdin` 四种。SKILL.md 通篇只用内联 `--flag value`。

**影响**：多行 JS 走内联 flag 会被 shell 转义打爆。`verify_platforms_browsercli.py` 是被迫走 `--stdin` + `shell=True` 的活例，而 `--file`（脚本存文件再执行）这种最稳妥方式反而没在文档里突出。

**最小修复建议**：

- 把 `--file` / `--stdin` 立为多行 JS 的标准姿势，示例优先 `browsercli call evaluate_script --file hook.js`。
- 内联 flag 只保留给真正一行能写完的参数。

**验收标准**：

- 文档示例复制到 Windows PowerShell 无需修改即可运行。
- 复杂脚本的文档示例不再依赖 shell 转义。

### 3.3 页面寻址 off-by-one

**现象**：`list_pages` 返回 23 个页面，却出现 `selectedIndex: 10` 对应 `selectedPageId: "page-11"`。index 与 pageId 不是同一套编号。

**影响**：自动化脚本按 index 选页会对错页；`verify_platforms_browsercli.py` 这类全平台验证在页面多开时极易踩坑。

**最小修复建议**：

- `select_page` 统一用 `pageId`（而非裸 index）。
- 让 `selectedIndex` 与 `selectedPageId` 严格一致，消除错位。

**验收标准**：

- `selectedIndex: N` 与 `selectedPageId: "page-(N+1)"` 不再出现交叉错位。
- 按 index 选页与按 pageId 选页结果一致。

### 3.4 共享 Worker 竞争

**现象**：`status` 显示 `Active Sessions: 100`，同一个 Worker lane 被大量会话共享。

**影响**：命令响应时间抖动，`evaluate_script` 在共享场景下更容易失败/卡住。

**最小修复建议**：

- 在 `status` 中暴露当前 lane 的排队深度，或为长任务提供「独占 lane」选项。
- 文档明确「何时需要 `jobs cancel` / `browser disconnect --force`」的触发阈值。

**验收标准**：

- 用户/Agent 在发起长任务前能判断当前是否符合执行条件。

---

## 四、P2：仓库侧验证脚本硬编码

**现象**：`browser-rpc/scripts/verify_platforms_browsercli.py` 硬编码了平台数 `109`、端口 `8766`、输出格式串 `[3d}/109]`；平台一旦增减，脚本即漂移误报。

**影响**：验证脚本对平台数量敏感，无法作为稳定守卫。

**最小修复建议**：

- 从 `/data` 动态读 `len(platforms)`，去掉 `109`、`8766`、`[3d}%d]` 这些魔法值。
- 端口用空闲探测或参数化，避免与正在运行的本地服务冲突。

---

## 五、优化建议优先级总览

| 优先级 | 建议 | 对应问题 |
|--------|------|---------|
| 1 | 统一 `--format json` 输出契约 | 2.1 |
| 2 | job 失败携带错误原因 / `jobs log` | 2.2 |
| 3 | SKILL.md 由 `list-tools` 自动生成 | 3.1 |
| 4 | 多行 JS 标准姿势改为 `--file` / `--stdin` | 3.2 |
| 5 | 页面寻址单一化（pageId，消除 off-by-one） | 3.3 |
| 6 | `evaluate_script` 失败回填异常信息 | 2.2 |
| 7 | 暴露 Worker lane 排队深度 / 独占选项 | 3.4 |
| 8 | 去硬编码（`verify_platforms_browsercli.py`） | P2 |

---

## 附录：本会话实际观察到的原始证据

```text
# 1. status —— 表格型输出
headers[2]: Property,Value
rows[5]:
  - [2]: Worker URL,http://127.0.0.1:8765
  - [2]: Status,Online (ok)
  - [2]: Active Sessions,100
  - [2]: Available Tools,146
command: status
online: true

# 2. list_pages —— 嵌套 YAML + index/pageId 错位
pageInfos[23]{index,pageId,url,title}: ...
selectedIndex: 10
selectedPageId: page-11

# 3. jobs list —— failed 无原因
job_mt6xercr_76ylut,evaluate_script,failed,...
job_mt6xexgi_a10mv2,evaluate_script,failed,...

# 4. call --help —— 四种调用方式
Usage: browsercli call <tool-or-skill-name> [--param value] [--data <json>] [--file <params.json>]
       browsercli call evaluate_script --file <script.js>
       browsercli call <tool-or-skill-name> --stdin

# 5. list-tools —— 146 工具；SKILL.md 未覆盖 JSVMP/性能/模拟等领域
hook_jsvmp_interpreter / analyze_jsvmp_vm / analyze_pipeline
start_performance_trace / stop_performance_trace / performance_analyze_insight
emulate_mobile / emulate_network / emulate_cpu / resize_page
```