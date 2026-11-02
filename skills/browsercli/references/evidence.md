# 逆向证据沉淀、交互录制与环境诊断参考文档 (Evidence, Recording & Diagnostics Reference)

环境自检、验证码探测、交互轨迹录制与会话视频录制工具。

## 概览 (Overview)

用于在逆向分析与自动化交互过程中对运行环境做健康自检、对页面验证码挑战进行探测与等待，以及通过交互轨迹录制器实时捕获点击/输入行为并自动关联因果网络请求沉淀 Operation Evidence，或通过 CDP screencast 录制会话操作视频。结论与提取产物直接写入 `artifacts/tasks/<task-id>/`。

| 工具名称               | 功能描述                                                                                                                  | 核心参数                                                                                                                                                        |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnose_environment` | 运行环境诊断，检查 Node 版本、构建产物与 artifacts 目录状态                                                               | `[--checks <arr>]`                                                                                                                                              |
| `detect_captcha`       | 只读评估当前页面是否存在验证码挑战（可等待稳定清除，不执行破解）                                                          | `[--action <str>]`, `[--timeout <num>]`                                                                                                                         |
| `record_start`         | 启动用户交互轨迹录制器。在当前活动页面注入监听，实时捕获点击、输入、改动等行为，准备与网络请求关联沉淀 Operation Evidence | `-`                                                                                                                                                             |
| `record_stop`          | 停止用户交互轨迹录制器，提取记录的所有交互步骤并与捕获的网络因果请求关联输出 Operation Evidence                           | `-`                                                                                                                                                             |
| `video`                | 通过 CDP screencast 录制与管理浏览器会话视频（支持 capabilities/start/status/stop/save/read/list/discard）                | `--action <str>`, `[--recording_id <str>]`, `[--tab_id <num>]`, `[--quality <str>]`, `[--max_duration_ms <num>]`, `[--output <str>]`, `[--overwrite <bool>]` 等 |

---

## 详细命令与示例

### 1. 环境诊断与验证码探测 (`diagnose_environment`, `detect_captcha`)

```bash
# 检查当前页面是否弹出了人机验证码
browsercli call detect_captcha --action detect

# 等待人工完成验证或挑战消除（最长等 60 秒）
browsercli call detect_captcha --action wait_for_clear --timeout 60000

# 运行本地运行时环境健康诊断
browsercli call diagnose_environment
```

### 2. 用户交互轨迹与因果请求录制 (`record_start`, `record_stop`)

在执行关键用户操作（如点击登录、拖动滑块、提交表单）前启动录制，操作完成后停止录制，即可获取完整的用户交互动作序列以及期间触发的所有因果网络请求列表（Operation Evidence）：

```bash
# 1. 启动交互轨迹录制
browsercli call record_start

# 2. 模拟用户交互操作（如点击提交或填充输入框）
browsercli call click --selector "button#submit"

# 3. 停止录制并提取结构化交互轨迹与因果关联的网络请求
browsercli call record_stop
```

返回数据结构包含：

- `recordingId`: 录制会话唯一标识符
- `startedAt` / `stoppedAt`: 起止时间戳
- `interactions`: 捕获的操作数组（包含 `type`、`target` 元素标签与描述、时间戳）
- `correlatedNetwork`: 录制期间触发的网络请求列表（URL、方法、时间戳、状态等）

### 3. 浏览器会话视频录制 (`video`)

基于 CDP screencast 录制浏览器标签页的真实渲染画面并编码为 MP4，用于动态验证码对抗回放、复杂风控验证留证或自动化流程审查。

#### MCP 工具调用方式 (`browsercli call video`)：

```bash
# 查看当前平台录制能力规格（分辨率、帧率限制、版本等）
browsercli call video --action capabilities

# 开始录制当前活动标签页（支持 standard 1280x720@15fps 或 clear 1920x1080@30fps，默认限时 60 秒）
browsercli call video --action start --quality standard --max_duration_ms 60000

# 检查当前录制状态（进度、已录制帧数、耗时）
browsercli call video --action status --recording_id "rec_12345"

# 停止录制并完成视频流封包
browsercli call video --action stop --recording_id "rec_12345"

# 将录制生成的 MP4 文件另存到指定任务目录
browsercli call video --action save --recording_id "rec_12345" --output "artifacts/recordings/interaction.mp4" --overwrite true

# 列出本地所有已录制的视频缓存
browsercli call video --action list

# 丢弃并清理指定录制缓存
browsercli call video --action discard --recording_id "rec_12345"
```

#### CLI 原生快捷命令 (`browsercli video`)：

除了通过 `browsercli call video --action capabilities` 等 MCP 接口调用外，CLI 亦提供更直观的原生子命令：

```bash
# 启动录制
browsercli video start --quality standard --max-duration 60000

# 查询状态
browsercli video status <recording_id>

# 停止录制
browsercli video stop <recording_id>

# 另存为视频文件
browsercli video save <recording_id> artifacts/recordings/interaction.mp4 --overwrite

# 列出所有录制
browsercli video list

# 丢弃录制缓存
browsercli video discard <recording_id>
```
