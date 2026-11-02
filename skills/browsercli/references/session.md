# 存储导出参考文档 (Storage Reference)

浏览器 Storage/Cookie 提取工具。

## 概览 (Overview)

用于保留已登录凭证、提取完整 HttpOnly Cookie 请求头、在不同环境间无缝迁移状态。

| 工具名称      | 功能描述                                                                          | 核心参数                             |
| :------------ | :-------------------------------------------------------------------------------- | :----------------------------------- |
| `get_storage` | 提取浏览器存储（包含 HttpOnly cookies 及可复制的 Cookie Header、localStorage 等） | `[--type <str>]`, `[--filter <str>]` |

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
