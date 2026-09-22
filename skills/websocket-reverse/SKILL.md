---
name: websocket-reverse
description: WebSocket 协议逆向时使用，覆盖 连接发现 → 消息分组分析 → 单条下钻 → protobuf/二进制解码 → hook 拦截 全链路（list_websocket_connections / analyze_websocket_messages / get_websocket_message 等），所有工具统一经 browsercli CLI 调用。
---

# WebSocket 协议逆向

WebSocket 在直播、IM、行情、协作工具里越来越常见。与 HTTP 不同，**首屏可能在 WS 握手中已经包含认证参数**（`Sec-WebSocket-Protocol` / `Cookie` / query）。

> **核心心法**：**先用 `analyze_websocket_messages` 看分组，再下钻单条**。直接拉所有消息会被 protobuf / 二进制 / 高频心跳淹没。

---

## browsercli 前置

本技能所有工具都是 worker 侧的 MCP 工具，**必须通过 browsercli 调用**：

```bash
# 连接浏览器（headless 默认），并确认 worker 状态
browsercli browser connect
browsercli status

# WebSocket / Hook / 网络工具都属于默认 workflow profile，无需切 profile。
# 可用性自检（可选）：
browsercli list-tools --json | jq -r '.[].name' | grep -E '^(list_websocket|analyze_websocket|get_websocket|create_hook|inject_hook)'

# 工具调用通用形式（连字符↔下划线自动转换：analyze-websocket-messages ⇄ analyze_websocket_messages）
browsercli call <tool-name> [--param value] [--data '{"k":"v"}'] [--file params.json]
```

**参数约定**：

- 数组 / 对象参数：`--data '{"key":"value"}'`，或复杂参数写入文件 `--file params.json`
- 消息体大、参数多的调用（下钻 / hook），优先 `--file params.json`，避免 PowerShell/bash 转义

---

## 工作流

```bash
# 1. 列连接
browsercli call list_websocket_connections --urlFilter "wss://api.target.com"

# 2. 必做：消息模式分析（按 fingerprint 分组 + 统计 + 样本）
browsercli call analyze_websocket_messages --wsid <id> \
  --direction <sent|received>   # 可选，默认全部方向

# 3. 按分组查看
browsercli call get_websocket_messages --wsid <id> --groupId <g> \
  --direction <sent|received> --pageSize 50
# 看的是"某类型消息"在时间线上的分布

# 4. 单条下钻（该工具返回单条完整消息，无需 show_content）
browsercli call get_websocket_message --wsid <id> --frameIndex <idx>

# 5. 拦截 / 伪造（如需）
browsercli call create_hook --type websocket --description "WS capture"
browsercli call inject_hook --persistent true
```

---

## 关键决策

### 何时需要 `create_hook --type websocket`

默认 `list_websocket_connections` 拿到的就是**已建立**的连接，但只读 message stream。如下场景才需要自己 hook：

| 场景                     | 原因                            | 做法                                                                                          |
| ------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------- |
| 拦截发送（伪造心跳）     | 默认只观察收发的 server message | hook `WebSocket.send` 拦截 client 帧（`create_hook --type websocket` → `inject_hook`）        |
| 拦截构造（修改重连参数） | 默认只看到已建立连接            | hook `WebSocket` 构造函数记录 url/protocols（`create_hook --type websocket` → `inject_hook`） |
| 抓取握手 query 中的签名  | 默认不抓 HTTP 升级请求          | 配合 `browsercli call list_network_requests --urlFilter <wss-host>` 查升级前的 HTTP 请求        |

### 何时只读不 hook

| 场景                 | 原因                                                   |
| -------------------- | ------------------------------------------------------ |
| 协议是文本 JSON      | 直接 `get_websocket_messages --show_content true` 即可 |
| 协议是二进制但有规律 | `analyze_websocket_messages` 会自动 fingerprint 分组   |
| 目标只是看消息内容   | 不需要 hook，只读足够                                  |

---

## 二进制 / protobuf 处理

**最常见的踩坑**：直接看原始 message 被高基数二进制糊一脸。

正确做法：

1. `browsercli call analyze_websocket_messages --wsid <id>`
   → 返回每组的：消息数 / 平均大小 / 样本 indices
2. 找**最少的、最规律的**那组（如心跳 / ack）→ 它们的 pattern 是稳定的
3. 找**最大变化**的那组（payload 实际数据）→ 下钻样本
4. 把样本 base64 拿出来，放到本地用 protobuf decoder / 自写脚本反序列化

```
browsercli call analyze_websocket_messages --wsid 3
# → {
#     groups: [
#       {id: 'A', count: 1234, avgSize: 8,  samples: [0, 100, 200, ...]},  // 心跳
#       {id: 'B', count: 42,   avgSize: 256, samples: [3, 4, 5, ...]},   // 实际数据
#       {id: 'C', count: 5,    avgSize: 4096, samples: [1, 2, ...]}      // 大 payload
#     ]
#   }
```

`browsercli call get_websocket_messages --groupId B --show_content true` → 取 B 组的样本 raw bytes。

---

## 心跳与重连

很多 WS 协议有客户端心跳（如每 30s 发一个空帧）。如果你的本地 Node 复现要在 `Patch` 阶段跑通，可能需要：

1. 用 `create_hook --type websocket` 抓心跳间隔
2. 在 Node 复现里定时器模拟（不要直接禁用心跳，server 会断连）

---

## 协议推断速查

| 现象                                          | 可能协议                  |
| --------------------------------------------- | ------------------------- |
| 文本消息看着像 JSON                           | 直接 `JSON.parse`         |
| 文本消息像 base64                             | 大概率 protobuf / msgpack |
| 二进制且首字节是 `0x08` / `0x0A` 等           | protobuf（varint 编码）   |
| 二进制且每条前 4 字节是长度前缀               | 自定义 length-prefixed    |
| 二进制且每条前 2 字节是魔数（如 `0xBE 0xEF`） | 自定义 framed             |
| 偶发长消息 + 大量短消息                       | 大量心跳 + 偶发数据       |

---

## 输出产物

WebSocket 逆向后建议沉淀：

| 文件                     | 内容                                      |
| ------------------------ | ----------------------------------------- |
| `ws-protocol.md`         | 消息分组表 + 心跳间隔 + 认证参数来源      |
| `ws-samples/<group>.bin` | 各分组的 raw 样本（base64 编码）          |
| `ws-decode.js`           | protobuf / 自定义格式的解码器（站点无关） |

---

## 失败回退

| 现象                                | 解决                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyze_websocket_messages` 返回空 | 连接已关闭，重建并立即抓                                                                                                                                   |
| `get_websocket_message` 超时        | 消息体太大，先 `analyze` 看 avgSize                                                                                                                        |
| 协议是 protobuf 但没 `.proto`       | 用 skill `code-analysis` 反推 JS 侧；或用 [protoscope](https://github.com/square/protoscope) 试解                                                          |
| WS 加密（WSS + 自实现）             | 通常是 mTLS 或自定义 handshake 加密，先看 `list_network_requests` 找 handshake                                                                             |
| 心跳触发后立刻断连                  | 可能是 client 必须发特定心跳格式才能保活；用 `create_hook --type websocket` 看真实心跳                                                                     |
| 工具不可用（profile 报错）          | 本技能工具属默认 `workflow` profile；若报错先 `browsercli list-tools --json` 确认可用列表                                                                    |
| 页面反调试卡死 worker（409）        | 不要依赖 DOM 交互（fill/click）去触发 WS；优先 HTTP 侧路 + 本地 Node 重建，必要时 `browsercli jobs cancel` / 重启 worker（详见 wasm-reverse 技能"实战警示"） |

---

## 案例

- `references/cases/case-websocket-protobuf.md`（待补：protobuf WS 完整流程）

完整案例参考：`docs/reference/reverse-workflow.md` + `scripts/cases/` 中的实际站点抽象 case。

---

## 关联

- 完整六阶段工作流（Observe / Capture / Rebuild / Patch / PureExtraction / Port）：`skills/browsercli-playbook/SKILL.md` + `docs/reference/reverse-workflow.md`
- 工具参数与 profile 门控：`skills/browsercli-playbook/references/tool-catalog.md` / `profile-tool-gating.md`
- 失败回退决策树：`skills/browsercli-playbook/references/fallbacks.md`
