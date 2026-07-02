# 案例：WebSocket Protobuf 协议逆向

## 目标
- 找到 WS 协议中**业务消息**的 protobuf 字段定义。
- 输出可复用的解码器（站点无关模板）。
- 不提交任何**站点特定 payload / .proto 完整结构**到公开 case。

## 适用场景
- 直播弹幕 / 礼物事件
- IM 消息
- 行情推送
- 实时协作 / 通知

## 输入要求
- WS 主机（`wss://api.target.com/...`）
- 触发动作（让目标产生业务消息的 UI 操作）
- 至少 N 个不同分组的样本（建议 ≥ 20 条）

## 流程

### 1. 抓连接
- `list_websocket_connections`
- `analyze_websocket_messages --wsid <id>`

### 2. 模式分组
- 找**心跳组**（count 多、size 小、规律发送）→ 标记 `heartbeat`
- 找**业务数据组**（count 较少、size 大、payload 变化）→ 标记 `payload`
- 找**控制组**（如 ack / error）→ 标记 `control`

### 3. 心跳协议（先解决）
- 抓出心跳间隔（如 30s）
- 抓出心跳 payload（可能是 `0x00` 空帧 / `\n` / 特定二进制）
- 验证：拦截 `WebSocket.send` 验证心跳何时发
- 输出：`heartbeat-interval`、`heartbeat-bytes`

### 4. 业务消息（核心）
- 取 `payload` 组的多条样本
- 用 `get_websocket_message --frameIndex <i> --show_content true` 拿 raw bytes
- 看首字节 / 前 N 字节：
  - `0x08` / `0x0A` → 大概率 protobuf（varint 字段）
  - `\x00\x00\x00\x00` 长度前缀 → length-prefixed
  - 自定义魔数 → 自实现

### 5. 推断 proto 定义（站点无关）
- 按 protobuf varint 规则反推 field_number
- 不写完整 `.proto` 写进仓库 — 只写**字段编号 + 推测类型 + 样本引用**
- 用 `summarize_code` / `understand_code` 辅助 JS 侧代码（如果 JS 侧也有同源 schema）

### 6. 写解码器（站点无关）
- 解析 varint 长度 / zigzag / 嵌套 message
- 输出 JSON 形式供后续使用
- 解码器放 `artifacts/tasks/<task-id>/run/ws-decode.js`，**不进 scripts/cases/**

### 7. 写记录
- `record_reverse_evidence --taskId <id> --taskSlug <ws-proto> ...`
- 在 task artifact 写：
  - `ws-protocol.md`（分组表 + 心跳 + 认证）
  - `ws-samples/<group>.bin`（样本 base64）
  - `ws-decode.js`（解码器）

## 验证口径
- 解码后字段名与样本能对得上
- 心跳拦截后，server 不会立刻断连（重放原心跳 / 模拟心跳都 OK）
- 业务消息解码后字段稳定（同一动作触发多次 → 字段集一致）

## 常见失败与回退
- **心跳格式不对**：
  - 重看 `create_hook --type websocket` 抓的真实心跳，可能带 CRC / 序列号
  - 不要只 dump 标准 ping frame
- **业务消息反序列化失败**：
  - 可能不是标准 protobuf（如 flatbuffers / capnproto / 自实现）
  - 退到 `wasm_offline_run` 跑 wasm 解码器（如果服务端用 wasm 解码客户端发的）
- **消息加密**：
  - 看 JS 侧有无 `import` 加密函数，配合 `wasm_decompile` 找密钥派生
  - 加密是终点，不是起点 — 先确认能拿到明文帧再讨论

## 输出产物建议
- `ws-protocol.md` — 消息分组 + 心跳 + 认证来源
- `ws-samples/heartbeat.b64` / `ws-samples/payload-<n>.b64` — 原始样本
- `ws-decode.js` — 解码器（站点无关，参数化字段映射）
- `ws-record-evidence.md` — task artifact 条目
- 不输出 `.proto`（除非能完全脱敏）

## 安全边界
- 不提交任何**站点特定 payload**（如具体礼物 ID / 用户 ID / 弹幕文本）。
- 不提交任何**握手时的认证 token / cookie**。
- 不提交**完整的 .proto 定义** — 只写字段编号 + 类型 + 推测的语义。
- `ws-decode.js` 只暴露**通用 protobuf / 通用 framed 解码能力**，不绑站点。
