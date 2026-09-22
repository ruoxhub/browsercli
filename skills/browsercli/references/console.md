# Console 消息日志参考文档 (Console Reference)

页面控制台日志采集与单条消息结构化查询工具。

## 概览 (Overview)

用于排查前端页面控制台报错、打印的调试参数及 CSP 违规警告。

| 工具名称                | 功能描述                                                              | 核心参数                                                                         |
| :---------------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| `list_console_messages` | 列出当前选中页面自上次导航以来的 Console 消息，支持分页与保留消息过滤 | `[--pageSize <num>]`, `[--pageIdx <num>]`, `[--includePreservedMessages <bool>]` |
| `get_console_message`   | 按消息 ID 获取单条 Console 消息的结构化详情（包含类型、文本与参数）   | `--msgid <num>`                                                                  |

---

## 详细命令与示例

### 1. list_console_messages

获取页面上所有 `console.log` / `warn` / `error` / `debug` 输出。

```bash
# 列出最近一页控制台消息
browsercli call list_console_messages --pageSize 50

# 包含页面导航前保留的历史消息
browsercli call list_console_messages --includePreservedMessages true
```

### 2. get_console_message

根据消息列表中的 `msgid` 获取完整的参数对象或展开结构。

```bash
browsercli call get_console_message --msgid 12
```
