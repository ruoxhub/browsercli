# Windows / PowerShell 使用注意事项与已知问题

> 更新时间：2026-05-09
> 基于实际逆向任务执行过程整理

---

## 1. PowerShell 参数转义问题

### 问题描述

通过 `js-reverse call <tool> --function "JS_CODE"` 传递 JavaScript 代码时，PowerShell 对引号、括号、大括号的转义规则极其复杂，导致大部分包含复杂表达式的参数无法正确传递。

### 常见失败模式

```powershell
# 失败：内嵌引号被 PowerShell 吞掉
js-reverse call hook_function --function "document.querySelector('#btn').click()"

# 失败：大括号被 PowerShell 解析为脚本块
js-reverse call evaluate_script --expression "(() => { return window.__hookStore })()"

# 失败：管道传递仍有转义问题
Get-Content script.js | js-reverse call evaluate_script --expression -
```

### 解决方案

1. **优先使用 `--data` JSON 格式传参**：

   ```powershell
   js-reverse call evaluate_script --data '{"expression":"document.title"}'
   ```

2. **将复杂 JS 写入文件，用简单调用引用**：

   ```powershell
   # 先写入脚本文件
   Set-Content -Path hook.js -Value 'document.querySelectorAll("script").length'
   # 再用简单调用读取
   js-reverse call evaluate_script --data '{"expression":"document.querySelectorAll(\"script\").length"}'
   ```

3. **建议 CLI 增加 `--file` 参数**（见改进建议）

---

## 2. 执行上下文混乱

### 问题描述

`auto_hook` 注入的 Hook 数据存储在 `window.__hookStore`（content-script 上下文），但 `evaluate_script` 默认在 `main world` 执行，两者无法互通。

### 实际表现

```powershell
# auto_hook 成功注入
js-reverse call auto_hook --data '{"preset":"network-core"}'
# OK: Hook network-core injected

# 尝试读取 Hook 数据 — 失败
js-reverse call evaluate_script --data '{"expression":"window.__hookStore"}'
# 返回 undefined 或空对象
```

### 根因

根据 `tool-io-contract.md`，Hook 数据的写入路径是 `__hookStore`（页面侧），读取路径是 `hookManager.getAllKnownHookIds()` + `getRecords()`（服务侧）。正确做法是用 `get_hook_data` 或 `list_hooks` 从服务侧读取，而不是从页面侧直接访问。

### 正确做法

```powershell
# 从服务侧获取 Hook 数据
js-reverse call get_hook_data --data '{"hookId":"network-core-fetch"}'
js-reverse call list_hooks
```

---

## 3. 工具参数格式不明确

### 问题描述

多个工具的参数命名风格不一致，CLI 帮助信息不够清晰，导致试错成本高。

### 具体案例

| 工具                    | 问题                                         | 正确用法                                |
| ----------------------- | -------------------------------------------- | --------------------------------------- |
| `observe_flow`          | 文档说支持 `--url`，实际需用 `--data` + JSON | `--data '{"url":"..."}'`                |
| `wait_for_request`      | `--waitForRequest` 参数名风格不一致          | `--data '{"waitForRequest":"playurl"}'` |
| `list_network_requests` | `--headerFilter` 传参方式不明                | `--data '{"headerFilter":"playurl"}'`   |

### 建议

统一使用 `--data '<JSON>'` 传参格式，避免 `--kebab-case` 和 `--camelCase` 混用问题。

---

## 4. 网络请求捕获需要页面主动触发

### 问题描述

`auto_hook --preset network-core` 注入成功，但如果页面不主动发起请求，则无法捕获到目标请求。`wait_for_request` 超时是常见问题。

### 场景

- 视频页面不会自动播放，需要手动点击播放按钮
- `send_mouse_click` / `find_clickable_elements` 对复杂播放器组件效果不佳
- 最终只能用 `evaluate_script` 执行 `document.querySelector('video').play()` 触发

### 解决方案

1. **注入脚本触发行为**：`evaluate_script` 执行 `video.play()` 等直接操作
2. **预加载脚本**：在页面加载前用 `inject_preload_script` 提前挂 Hook，确保不漏首屏请求
3. **建议 `wait_for_request` 增加轮询模式**（见改进建议）

---

## 5. 高级工具对调试器状态有依赖

### 问题描述

多个工具（`pause`、`set_breakpoint`、`list_scripts`、`collect_code`）在调试器未附加时失败，但错误信息不明确。

### 依赖关系

| 工具             | 前置条件          | 失败表现                |
| ---------------- | ----------------- | ----------------------- |
| `pause`          | 调试器已附加      | "Debugger not attached" |
| `set_breakpoint` | 调试器已附加      | 同上                    |
| `list_scripts`   | 调试器已附加      | 返回空列表              |
| `collect_code`   | 调试器 + 页面就绪 | 调用失败                |

### 解决方案

使用调试器工具前，确保：

1. 浏览器以 `--remote-debugging-port` 启动
2. Worker 已成功连接
3. 优先使用 Hook 类工具（不依赖调试器状态），仅在需要检查局部变量时使用断点

---

## 6. Windows 控制台编码问题

### 问题描述

Python 脚本中的 emoji 字符（`✅`/`❌`）在 Windows GBK 控制台无法显示，导致输出乱码或脚本崩溃。

### 解决方案

```python
# 方案 1：替换为 ASCII
print("[OK] Signature valid")
print("[FAIL] Signature mismatch")

# 方案 2：设置控制台编码
import sys
sys.stdout.reconfigure(encoding='utf-8')

# 方案 3：环境变量
$env:PYTHONIOENCODING="utf-8"
python script.py
```

---

## 7. API 响应结构需二次提取

### 问题描述

`factor` 等 API 的响应嵌套在 `body` 字段中，直接访问 `factor['sv']` 会失败，需要 `factor['body']['sv']`。

### 建议

- 调用 API 后先打印完整响应结构，确认嵌套层级
- 编写验证脚本时做防御性访问：`factor.get('body', {}).get('sv')`

---

## 改进建议汇总

| 优先级 | 改进项                              | 描述                                                             | 状态                |
| ------ | ----------------------------------- | ---------------------------------------------------------------- | ------------------- |
| P0     | CLI 增加 `--file` 参数              | 允许从文件读取复杂参数，彻底避免 PowerShell 转义问题             | ✅ 已实现           |
| P0     | 统一参数格式文档                    | 所有工具参数统一为 JSON schema，CLI 帮助信息需明确 `--data` 用法 | ✅ 已实现           |
| P1     | `auto_hook` 增加 `--export-results` | 自动将 Hook 数据写入 `artifacts/`，无需手动 `get_hook_data`      | ✅ 已实现           |
| P1     | `list_network_requests` 轮询模式    | 超时后返回已有请求而非空列表，方便排查                           | ✅ 已实现           |
| P1     | 调试器工具增加状态检查              | 调用 `pause`/`set_breakpoint` 前自动检查调试器状态，给出明确提示 | 待实现              |
| P2     | 补充 Windows PowerShell 使用指南    | 官方文档补充 Windows 专用示例与注意事项                          | ✅ 已实现（本文档） |
| P2     | 响应结构文档化                      | 工具返回值结构需在 `tool-io-contract.md` 中明确记录              | 待实现              |

### 已实现功能用法

#### `--file` 参数

```powershell
# 1. 将复杂参数写入 JSON 文件
@'
{
  "preset": "network-core",
  "autoInject": true,
  "exportResults": true,
  "exportWaitMs": 5000
}
'@ | Set-Content -Path params.json -Encoding UTF8

# 2. 使用 --file 读取
js-reverse call auto_hook --file params.json

# 命令行参数优先级高于文件参数
js-reverse call auto_hook --file params.json --preset api-signature
```

#### `auto_hook --export-results`

```powershell
# 注入 Hook 并自动导出数据
js-reverse call auto_hook --data '{"preset":"network-core","autoInject":true,"exportResults":true}'

# 自定义等待时间（默认 3000ms）
js-reverse call auto_hook --data '{"preset":"network-core","autoInject":true,"exportResults":true,"exportWaitMs":5000}'
```

导出路径：`artifacts/tasks/auto-hook-<timestamp>/hook-data.json`

#### `list_network_requests` 轮询模式

```powershell
# 等待匹配请求，超时后返回已有请求而非空列表
js-reverse call list_network_requests --data '{"waitForRequest":"playurl","waitTimeoutMs":10000}'

# 超时后返回：
# - success=false 如果没有任何匹配请求
# - success=true 如果有历史匹配请求（timedOut=true 标记超时）
# - waitedFor 字段记录等待的 URL 片段
```
