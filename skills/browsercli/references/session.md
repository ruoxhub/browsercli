# 会话状态持久化、存储导出与视频媒体参考文档 (Session & Storage Reference)

浏览器 Storage/Cookie 提取、会话状态快照导入导出、多抓包会话隔离管理及 HTML5 视频帧截取工具。

## 概览 (Overview)

用于保留已登录凭证、提取完整 HttpOnly Cookie 请求头、在不同环境间无缝迁移状态，以及多抓包会话的分类归档。

| 工具名称                | 功能描述                                                                          | 核心参数                                                          |
| :---------------------- | :-------------------------------------------------------------------------------- | :---------------------------------------------------------------- |
| `get_storage`           | 提取浏览器存储（包含 HttpOnly cookies 及可复制的 Cookie Header、localStorage 等） | `[--type <str>]`, `[--filter <str>]`                              |
| `save_session_state`    | 保存当前浏览器状态快照（Cookies + Storage）到内存会话库                           | `[--sessionId <str>]`, `[--includeCookies <bool>]`                |
| `restore_session_state` | 恢复已保存的浏览器状态快照并自动刷新/重定向                                       | `--sessionId <str>`, `[--navigateToSavedUrl <bool>]`              |
| `list_session_states`   | 列出内存中所有已保存的会话状态快照                                                | 无                                                                |
| `delete_session_state`  | 删除指定的会话状态快照                                                            | `--sessionId <str>`                                               |
| `dump_session_state`    | 将会话状态快照导出为磁盘 JSON 文件（支持加密）                                    | `--sessionId <str>`, `[--path <str>]`, `[--encrypt <bool>]`       |
| `load_session_state`    | 从磁盘文件或 JSON 字符串中加载外部会话快照                                        | `[--sessionId <str>]`, `[--path <str>]`                           |
| `session_create`        | 创建新的抓包隔离会话并设为当前活跃会话                                            | `--name <str>`, `[--targetUrl <str>]`                             |
| `session_list`          | 列出所有已创建的抓包会话                                                          | 无                                                                |
| `session_get_data`      | 获取指定会话捕获的结构化网络请求、Hook 采样日志与快照                             | `[--sessionId <str>]`, `[--includeHooks <bool>]`                  |
| `session_export`        | 将会话捕获的流量导出为 HAR 1.2、JSON 或 cURL 脚本文件                             | `[--sessionId <str>]`, `[--format <str>]`, `[--outputPath <str>]` |
| `capture_video_frame`   | 捕获 HTML5 `<video>` 视频元素的当前画面帧（可选 seek 跳转）                       | `--selector <str>`, `[--seekTime <num>]`, `[--outputPath <str>]`  |
| `get_video_info`        | 查询视频元素元数据（时长、播放进度、暂停状态、src 地址）                          | `--selector <str>`                                                |
| `seek_video`            | 将视频定位跳转到指定的时间戳（秒）                                                | `--selector <str>`, `--time <num>`                                |

---

## 详细命令与示例

### 1. 提取 Cookies 与 Storage (`get_storage`)

无需逐个字段拼接，直接提取标准 `cookieHeader` 供外部 Python / Node / curl 脚本使用：

```bash
# 提取所有 Cookies（含 HttpOnly，返回 ready-to-copy 的 Cookie 头）
browsercli call get_storage --type cookies

# 提取指定域名的 localStorage
browsercli call get_storage --type localStorage --filter "token"
```

### 2. 会话快照备份与还原 (`save_session_state` / `restore_session_state`)

```bash
# 登录成功后，持久化当前会话
browsercli call save_session_state --sessionId "vip_user_session"

# 导出会话快照到磁盘以备离线使用
browsercli call dump_session_state --sessionId "vip_user_session" --path "artifacts/sessions/vip.json"

# 在新打开的浏览器中加载并恢复登录状态
browsercli call load_session_state --path "artifacts/sessions/vip.json"
browsercli call restore_session_state --sessionId "vip_user_session" --navigateToSavedUrl true
```

### 3. 多抓包会话隔离与导出 (`session_*`)

```bash
# 1. 开启一个独立的逆向抓包会话
browsercli call session_create --name "payment_reverse" --targetUrl "https://trade.example.com"

# 2. 执行一系列业务操作与 Hook 采样后，提取数据
browsercli call session_get_data --sessionId "payment_reverse" --includeHooks true

# 3. 导出为 HAR 格式以便在 Charles/Postman 中回放分析
browsercli call session_export --sessionId "payment_reverse" --format har --outputPath "artifacts/payment.har"
```

### 4. 视频播放器逆向与截帧 (`video`)

用于排查带防盗链水印、分片解密播放的前端视频播放器：

```bash
# 查看视频时长和当前播放位置
browsercli call get_video_info --selector "video#player"

# 跳转到第 30 秒并截图截帧
browsercli call capture_video_frame --selector "video#player" --seekTime 30 --outputPath "artifacts/frame_30s.png"
```
