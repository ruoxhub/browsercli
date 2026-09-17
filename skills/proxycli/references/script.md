# 脚本收集、缓存检索与源码定位参考文档 (Script & Source Reference)

页面脚本探测、源码缓存提取、正则检索、智能收集及目标 Target 快照工具。

## 概览 (Overview)

用于定位页面加载的业务 JS 脚本、Webpack 打包 chunk，提取代码片段并快速通过关键词匹配找到签名、加密及参数生成逻辑。

| 工具名称                | 功能描述                                                                               | 核心参数                                                                        |
| :---------------------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| `list_scripts`          | 列出当前页面已加载的所有 JavaScript 脚本（包含 scriptId、URL 与 SourceMap）            | `[--filter <str>]`                                                              |
| `get_script_source`     | 按 scriptId 获取 JS 源码本地缓存路径（触发 CDP 并写入临时文件，支持行号切片）          | `--scriptId <str>`, `[--filePath <str>]`, `[--startLine <num> --endLine <num>]` |
| `search_in_sources`     | 在所有已加载的 JS 源码中全文正则/字符串搜索，返回 scriptId、行号及 sourcePath 缓存路径 | `--query <str>`, `[--urlFilter <str>]`, `[--isRegex <bool>]`                    |
| `search_in_scripts`     | 使用正则表达式在本地已收集的脚本缓存中搜索                                             | `--pattern <str>`, `[--limit <num>]`, `[--maxTotalSize <num>]`                  |
| `find_in_script`        | 在指定脚本内精确定位字符串出现位置（精确行列号及上下文字符）                           | `--scriptId <str>`, `--query <str>`, `[--contextChars <num>]`                   |
| `collect_code`          | 智能收集页面关联脚本到本地磁盘（支持 summary/priority/incremental/full 模式）          | `--url <str>`, `[--smartMode <str>]`, `[--pattern <str>]`                       |
| `collection_diff`       | 对比上一次与当前收集到的脚本文件摘要，探测动态加载或热更新脚本                         | `[--includeUnchanged <bool>]`                                                   |
| `list_targets`          | 列出 Chromium 当前可见的所有 Target 及其脚本快照能力                                   | 无                                                                              |
| `dump_target_scripts`   | 一次性读取指定 Chromium Target 当前已解析的全部脚本源码                                | `--targetId <str>`                                                              |
| `inject_preload_script` | 为当前页面或上下文的后续文档注册预加载脚本（可使用预设 preset）                        | `[--script <str>]`, `[--preset <str>]`                                          |

---

## 详细命令与示例

### 1. 查找并读取页面脚本源码

```bash
# 1. 列出所有脚本，通过业务域名或关键词过滤
proxycli call list_scripts --filter "app"

# 2. 全局搜索关键函数或混淆变量特征（轻量高效，返回匹配文件路径）
proxycli call search_in_sources --query "encryptPassword(" --urlFilter "bundle.js"

# 3. 按 scriptId 截取指定行范围的代码并写入本地文件
proxycli call get_script_source \
  --scriptId "42" \
  --startLine 120 \
  --endLine 250 \
  --filePath "artifacts/sources/app_slice.js"
```

### 2. 批量智能收集脚本 (`collect_code`)

```bash
# 优先模式：挑出核心业务与非第三方库脚本
proxycli call collect_code --url "https://example.com/target" --smartMode priority

# 增量模式：仅下载新增或变动脚本
proxycli call collect_code --url "https://example.com/target" --smartMode incremental
```

### 3. 注册前置预加载脚本 (`inject_preload_script`)

```bash
# 注入通用 Hook 预设，在目标页面任何首屏 JS 执行前生效
proxycli call inject_preload_script --preset "anti-debugger"
```
