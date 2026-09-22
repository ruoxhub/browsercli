# 逆向证据沉淀与报告参考文档 (Evidence & Reports Reference)

环境自检与页面取证工具。

## 概览 (Overview)

用于在逆向分析过程中对运行环境和页面状态做只读检查。结构化证据落盘工具
（`record_reverse_evidence` / `export_session_report`）已随 `src/tools/analyzer`
模块一并下线，结论改由调用方 Agent 直接写入 `artifacts/tasks/<task-id>/`。

| 工具名称               | 功能描述                                                         | 核心参数                                |
| :--------------------- | :--------------------------------------------------------------- | :-------------------------------------- |
| `diagnose_environment` | 运行环境诊断，检查 Node 版本、构建产物与 artifacts 状态          | `[--checks <arr>]`                      |
| `detect_captcha`       | 只读评估当前页面是否存在验证码挑战（可等待稳定清除，不执行破解） | `[--action <str>]`, `[--timeout <num>]` |

---

## 详细命令与示例

### 1. detect_captcha & diagnose_environment

```bash
# 检查当前页面是否弹出了人机验证码
browsercli call detect_captcha --action detect

# 等待人工完成验证或挑战消除（最长等 60 秒）
browsercli call detect_captcha --action wait_for_clear --timeout 60000

# 运行本地运行时环境健康诊断
browsercli call diagnose_environment
```
