# 逆向证据沉淀与报告参考文档 (Evidence & Reports Reference)

逆向工程证据持久化、会话报告导出、环境自检与 Pipeline 编排工具。

## 概览 (Overview)

用于在逆向分析过程中沉淀可复现的结构化证据（加密函数、密钥、明密文对、调用链），导出任务交付报告，以及编排自动化分析流水线。

| 工具名称                  | 功能描述                                                           | 核心参数                                                                     |
| :------------------------ | :----------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| `record_reverse_evidence` | 将结构化逆向证据追加到任务审计日志（`artifacts/tasks/<task-id>/`） | `--entry <arr>`, `[--taskId <str>]`, `[--targetUrl <str>]`, `[--goal <str>]` |
| `export_session_report`   | 将当前逆向工程会话导出为 JSON 或 Markdown 报告                     | `[--format <str>]`, `[--includeHookData <bool>]`                             |
| `diagnose_environment`    | 运行环境诊断，检查 Node 版本、构建产物与 artifacts 状态            | `[--checks <arr>]`                                                           |
| `detect_captcha`          | 只读评估当前页面是否存在验证码挑战（可等待稳定清除，不执行破解）   | `[--action <str>]`, `[--timeout <num>]`                                      |
| `analyze_pipeline`        | 编排执行标准分析流水线（代码采集 → 并行加密/混淆探测 → 生成报告）  | `--url <str>`, `[--deep <bool>]`                                             |

---

## 详细命令与示例

### 1. record_reverse_evidence

逆向分析的核心准出动作：必须将验证过的关键结论（如加密入口函数、密钥常量、输入输出样本等）沉淀为证据文件。

```bash
proxycli call record_reverse_evidence \
  --taskId "task_demo_01" \
  --taskSlug "api-sign-extract" \
  --targetUrl "https://example.com/login" \
  --goal "提取请求签名计算函数" \
  --entry '[{
    "name": "window.calcSign",
    "key": "aes_secret_key_123",
    "algorithm": "AES-CBC",
    "inputSample": "{\"uid\": 10001, \"t\": 1710000000}",
    "outputSample": "a9f8b2c1d0e..."
  }]'
```

### 2. export_session_report

将当前会话拦截的请求、Hook 采样日志、断点记录统一打包生成交付报告。

```bash
# 导出 Markdown 格式的完整会话报告
proxycli call export_session_report --format markdown --includeHookData true

# 导出结构化 JSON 格式供程序读取
proxycli call export_session_report --format json
```

### 3. analyze_pipeline

一键对目标页面运行编排分析流水线，全量采集脚本并探测常见加解密与混淆特征。

```bash
proxycli call analyze_pipeline --url "https://example.com/target" --deep true
```

### 4. detect_captcha & diagnose_environment

```bash
# 检查当前页面是否弹出了人机验证码
proxycli call detect_captcha --action detect

# 等待人工完成验证或挑战消除（最长等 60 秒）
proxycli call detect_captcha --action wait_for_clear --timeout 60000

# 运行本地运行时环境健康诊断
proxycli call diagnose_environment
```
