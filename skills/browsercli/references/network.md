# 网络流量嗅探、请求重放与 WebSocket 分析参考文档 (Network Reference)

HTTP/HTTPS 请求捕获、发起者调用栈追踪、参数重放覆盖、cURL 导出及 WebSocket 帧解码分析工具。

## 概览 (Overview)

网络分析是逆向分析的入口与第一站。核心工作流是：**找到包含加密字段的请求 → 通过发起者调用栈（Initiator Stack）精准回溯到前端业务源码中的签名生成函数**。

| 工具名称                       | 功能描述                                                                             | 核心参数                                                                |
| :----------------------------- | :----------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `list_network_requests`        | 列出捕获的 HTTP/HTTPS 请求（支持 URL/Header/资源类型过滤，支持等待新请求）           | `[--urlFilter <str>]`, `[--waitForRequest <str>]`, `[--pageSize <num>]` |
| `get_network_request`          | 获取请求详情（完整请求头、POST Body、响应头及响应体，支持另存到文件）                | `--reqid <num>`, `[--maxBodyLength <num>]`, `[--saveTo <str>]`          |
| `clear_network_requests`       | 清空捕获请求缓存，清空后 reqid 从 1 重新开始递增                                     | `[--targetPageIdx <num>]`                                               |
| `get_request_initiator`        | **核心逆向利器**：获取该网络请求的 JavaScript 发起者调用栈（精准定位到源文件与行号） | `--requestId <num>`                                                     |
| `replay_network_request`       | 在浏览器上下文环境重放请求（自动携带 Cookie/Storage），支持覆写方法、头与 Body       | `--reqid <num>`, `[--method <str>]`, `[--headers <arr>]`                |
| `export_request_as_curl`       | 将捕获的网络请求导出为开箱即用的标准 cURL 终端命令                                   | `--reqid <num>`, `[--includeCookies <bool>]`                            |
| `replay_network_request_batch` | 变体批量重放请求（用于测试签名字段有效性、时效性与重放攻击）                         | `--reqid <num>`, `[--variants <arr>]`, `[--concurrency <num>]`          |
| `list_websocket_connections`   | 列出当前页面所有的活动 WebSocket 连接（获取 wsid）                                   | `[--urlFilter <str>]`                                                   |
| `get_websocket_messages`       | 获取指定 WebSocket 连接的帧数据流（支持发送/接收方向、分组过滤及明细展示）           | `--wsid <num>`, `[--direction <str>]`, `[--show_content <bool>]`        |
| `get_websocket_message`        | 按帧索引获取单条 WebSocket 消息并支持解码（如二进制/Protobuf 文本转储）              | `--wsid <num>`, `--frameIndex <num>`, `[--decode <str>]`                |
| `analyze_websocket_messages`   | 对 WebSocket 帧消息进行模式分组与特征指纹聚类（自动区分心跳包与业务消息）            | `--wsid <num>`, `[--direction <str>]`                                   |

---

## 详细命令与示例

### 1. 嗅探过滤网络请求

```bash
# 过滤包含 /api/trade 的敏感业务请求
browsercli call list_network_requests --urlFilter "/api/trade"

# 等待即将发出的接口请求（最长等 5 秒）
browsercli call list_network_requests --waitForRequest "/api/user/order" --waitTimeoutMs 5000
```

### 2. 追踪请求发起者调用栈 (`get_request_initiator`)

这是逆向工程中最核心的破局点：

```bash
browsercli call get_request_initiator --requestId 5
```

输出示例：

```json
{
  "initiator": {
    "type": "script",
    "stack": [
      {
        "functionName": "sendRequest",
        "url": "https://example.com/js/api.js",
        "lineNumber": 42
      },
      {
        "functionName": "calcSignAndDispatch",
        "url": "https://example.com/js/security.js",
        "lineNumber": 188
      }
    ]
  }
}
```

此时即可直接定位到 `security.js` 第 188 行，使用 `get_script_source` 读取该处源码并使用 `hook_function` 拦截。

### 3. 请求重放与参数测试

验证服务端校验规则（例如：修改时间戳是否报错、去除某个 header 是否被拒）：

```bash
# 1. 直接以当前上下文原样重放
browsercli call replay_network_request --reqid 5

# 2. 导出为 cURL 命令在外网机器复现
browsercli call export_request_as_curl --reqid 5 --includeCookies true

# 3. 批量模糊测试签名字段
browsercli call replay_network_request_batch \
  --reqid 5 \
  --variants '[
    {"url": "https://api.example.com/data?t=1"},
    {"url": "https://api.example.com/data?t=999999999"}
  ]'
```

### 4. WebSocket 逆向分析

```bash
# 1. 获取活动连接列表
browsercli call list_websocket_connections

# 2. 对帧做模式聚类，过滤高频心跳 ping/pong，找出核心业务数据帧
browsercli call analyze_websocket_messages --wsid 1

# 3. 读取并解码单条业务消息帧
browsercli call get_websocket_message --wsid 1 --frameIndex 14 --decode auto
```
