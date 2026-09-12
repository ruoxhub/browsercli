# JavaScript Code Analysis & Deobfuscation Reference

Code deobfuscation and CAPTCHA state inspection tools for `proxycli`.

## Overview

Statically and dynamically inspect obfuscated JavaScript code and assess CAPTCHA status.

| Tool Name          | Description                                                          | Key Parameters                                                        |
| ------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `deobfuscate_code` | Deobfuscate JavaScript (string decryption, AST flattening, renaming) | `--code <str>`, `[--aggressive <bool>]`, `[--renameVariables <bool>]` |
| `detect_captcha`   | Detect CAPTCHA challenge status or wait for clear                    | `[--action <str>]`, `[--timeout <num>]`                               |

> 代码理解、摘要、加密识别、风险评分、目标一键分析原由 `understand_code` / `summarize_code` / `detect_crypto` / `risk_panel` / `analyze_target` 工具提供，这些工具已下线；改由 `code-analysis` 与 `target-analysis` 技能指导 Agent 用基础工具自行分析。

---

## Detailed Commands

### 1. deobfuscate_code

AI-assisted and AST-based deobfuscation for obfuscator.io (`_0x`), control flow flattening, string array decoders, and dead code removal.

```bash
# Basic AST cleanup
proxycli call deobfuscate_code --code "var _0x1a2b = ['hello']; console.log(_0x1a2b[0]);"

# Aggressive deobfuscation with variable renaming
proxycli call deobfuscate_code --code "..." --aggressive true --renameVariables true
```

### 2. detect_captcha

Inspect the current page to determine if a CAPTCHA challenge is blocking navigation or execution. Note: this tool only evaluates status, it does NOT solve CAPTCHAs.

```bash
# Immediate evaluation of page state
proxycli call detect_captcha --action detect

# Wait for human verification or challenge clearance (timeout 1000-300000ms)
proxycli call detect_captcha --action wait_for_clear --timeout 60000
```

## 代码分析替代路径

需要结构理解、摘要、加密识别或风险评分时：

1. `collect_code` 采代码、`search_in_scripts` 定位、`get_script_source` 取全文；
2. 按 skill `code-analysis` 的提示词与产出结构自行分析；
3. 目标级工作流按 skill `target-analysis` 复现（采集 + Hook 时间线 + 行动方案）。
