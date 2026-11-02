# 扩展管理参考文档 (Extensions Reference)

Chrome 扩展（Extension）的安装、卸载、列表查询、热重载与 Action 交互工具（需 `--categoryExtensions=true` 启用）。

## 概览 (Overview)

用于在浏览器自动化与逆向分析过程中加载自定义未打包插件（Unpacked Extension）、管理调试插件、开发改动后免重启重载扩展代码，以及模拟点击工具栏触发扩展 Action。

| 工具名称                   | 功能描述                                    | 核心参数       |
| :------------------------- | :------------------------------------------ | :------------- |
| `list_extensions`          | 列出已装扩展的 name/ID/version/enabled      | 无             |
| `install_extension`        | 从本地绝对路径安装未打包扩展                | `--path <str>` |
| `reload_extension`         | 重载未打包扩展（代码修改后免重启重新生效）  | `--id <str>`   |
| `trigger_extension_action` | 触发扩展默认 action（相当于点击工具栏图标） | `--id <str>`   |
| `uninstall_extension`      | 卸载未打包扩展                              | `--id <str>`   |

---

## 详细命令与示例

### 1. 从本地路径安装未打包扩展 (`install_extension`)

从包含 `manifest.json` 的解压/构建目录安装扩展：

```bash
# 安装未打包扩展（需传入绝对路径）
browsercli call install_extension --path "/path/to/extension/dist"

# Windows 路径示例
browsercli call install_extension --path "D:/work/crawler/apps/browser/.output/chrome-mv3"
```

返回内容包含分配的扩展 ID，例如：

```
Extension installed. Id: nikbificejcmcpkllhnkdjahimocfabm
```

### 2. 查看已安装扩展列表 (`list_extensions`)

查询浏览器当前已加载的所有扩展信息：

```bash
browsercli call list_extensions
```

输出格式示例：

```
## Extensions
- id=nikbificejcmcpkllhnkdjahimocfabm "Browser RPC" v3.1.0 Enabled
```

### 3. 热重载扩展 (`reload_extension`)

在开发插件过程中修改了代码、Content Script 或 Background Worker 时，无需重启整个浏览器，直接通过扩展 ID 热重载：

```bash
browsercli call reload_extension --id "nikbificejcmcpkllhnkdjahimocfabm"
```

### 4. 触发扩展 Action / 模拟点击插件图标 (`trigger_extension_action`)

触发扩展针对当前活动标签页的 Action（相当于用户点击浏览器右上角的扩展图标）：

```bash
browsercli call trigger_extension_action --id "nikbificejcmcpkllhnkdjahimocfabm"
```

### 5. 卸载扩展 (`uninstall_extension`)

卸载指定的未打包扩展：

```bash
browsercli call uninstall_extension --id "nikbificejcmcpkllhnkdjahimocfabm"
```
