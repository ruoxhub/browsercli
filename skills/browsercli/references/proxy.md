# MITM 代理抓包、规则改写与本地透明拦截参考文档 (MITM Proxy Reference)

非浏览器流量抓取、HTTPS 解密、请求/响应实时动态改写、HAR 导出与本地进程级透明代理工具。

## 概览 (Overview)

用于拦截非浏览器环境的流量（如 Python/cURL 爬虫脚本、移动端手机 App、微信小程序、Electron 桌面客户端、系统后台服务等）。支持动态生成/导出自签名根证书，支持配置二级 upstream 上游代理。

| 工具名称                    | 功能描述                                                                                     | 核心参数                                                      |
| :-------------------------- | :------------------------------------------------------------------------------------------- | :------------------------------------------------------------ |
| `start_mitm_proxy`          | 启动 MITM 抓包代理服务（默认端口 8888，支持二级 upstream 代理）                              | `[--port <num>]`, `[--upstreamProxy <str>]`                   |
| `stop_mitm_proxy`           | 停止 MITM 代理服务并释放监听端口                                                             | 无                                                            |
| `export_mitm_ca`            | 导出根 CA 证书文件（PEM 或 DER 格式），供客户端信任以解密 HTTPS                              | `--outputPath <str>`, `[--format <str>]`                      |
| `list_mitm_requests`        | 列出 MITM 捕获的请求（内存环形缓冲，支持 URL/Host/Method/状态码多重过滤）                    | `[--urlFilter <str>]`, `[--host <str>]`, `[--pageSize <num>]` |
| `get_mitm_request`          | 获取单条抓包请求的完整结构化详情（支持导出为 curl 命令或另存 Body）                          | `--id <num>`, `[--saveTo <str>]`, `[--format <str>]`          |
| `clear_mitm_requests`       | 清空所有捕获记录，清空后请求 ID 从 1 重新开始递增                                            | 无                                                            |
| `mitm_add_rule`             | 新增或覆盖改写规则（`block` / `map_local` / `map_remote` / `modify_header` / `modify_body`） | `--action <obj>`, `[--id <str>]`, `[--urlFilter <str>]`       |
| `mitm_list_rules`           | 列出当前生效的全部改写规则                                                                   | 无                                                            |
| `mitm_remove_rule`          | 按 ID 移除指定的改写规则                                                                     | `--id <str>`                                                  |
| `mitm_clear_rules`          | 清空全部改写规则                                                                             | 无                                                            |
| `mitm_add_host_filter`      | 配置域名过滤（`allow` 白名单 / `block` 黑名单；白名单非空时其余全部旁路）                    | `--action <str>`, `--host <str>`                              |
| `mitm_list_host_filters`    | 列出当前生效的域名黑白名单                                                                   | 无                                                            |
| `mitm_remove_host_filter`   | 移除指定的域名过滤规则                                                                       | `--action <str>`, `--host <str>`                              |
| `mitm_clear_host_filters`   | 清空全部域名黑白名单                                                                         | 无                                                            |
| `mitm_list_local_processes` | 列出当前持有 TCP 网络连接的本地进程（pid/名称），辅助选取拦截目标                            | 无                                                            |
| `mitm_configure_local_apps` | 配置 Local Applications 透明拦截模式：接管 Windows 系统代理，仅解密目标进程                  | `[--enabled <bool>]`, `[--targets <arr>]`                     |
| `mitm_export_har`           | 将当前捕获缓冲导出为标准 HAR 1.2 格式文件                                                    | `[--outputPath <str>]`                                        |

---

## 交互式终端抓包控制台 (REPL)

除了通过 MCP 工具调用，`browsercli` 还提供了专门的独立交互式终端：

```bash
# 启动交互式 MITM 抓包 REPL（默认端口 8888）
browsercli proxy

# 自定义端口并配置二级上游 SOCKS5 代理
browsercli proxy --port 9090 --upstream "socks5://127.0.0.1:1080"

# 自动接管 Windows 系统代理
browsercli proxy --sysproxy

# 查看代理运行状态
browsercli proxy status
```

---

## 详细命令与示例

### 1. 启动服务与信任 CA 证书

```bash
# 1. 启动代理监听
browsercli call start_mitm_proxy --port 8888

# 2. 导出 CA 证书给客户端安装
browsercli call export_mitm_ca --outputPath "artifacts/mitm_ca.crt" --format pem

# 客户端验证示例（如 curl）：
# curl -x http://127.0.0.1:8888 --cacert artifacts/mitm_ca.crt https://api.example.com/test
```

### 2. 动态修改与 Mock 请求响应 (`mitm_add_rule`)

```bash
# 本地 Mock 接口返回
browsercli call mitm_add_rule \
  --id "mock_user_info" \
  --action '{"type":"map_local","urlRegex":"https://api\\.example\\.com/user","localPath":"artifacts/mock_user.json","statusCode":200}'

# 篡改请求 Header（注入测试 Token）
browsercli call mitm_add_rule \
  --id "inject_auth" \
  --action '{"type":"modify_header","urlRegex":".*","requestHeaders":{"Authorization":"Bearer test_token"}}'
```

### 3. Windows 本地进程透明拦截

```bash
# 1. 查找微信或目标桌面应用进程名
browsercli call mitm_list_local_processes

# 2. 启用系统代理透明拦截，仅对 WeChat.exe 流量做 MITM 解密，其余正常直连
browsercli call mitm_configure_local_apps --enabled true --targets '["WeChat.exe"]'
```
