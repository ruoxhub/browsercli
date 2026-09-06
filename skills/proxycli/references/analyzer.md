# JavaScript Code Analysis & Deobfuscation Reference

Code understanding, AST deobfuscation, crypto detection, and CAPTCHA state inspection tools for `proxycli`.

## Overview

Statically and dynamically inspect obfuscated JavaScript code, detect encryption schemes, and assess CAPTCHA status.

| Tool Name          | Description                                                          | Key Parameters                                                        |
| ------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `deobfuscate_code` | Deobfuscate JavaScript (string decryption, AST flattening, renaming) | `--code <str>`, `[--aggressive <bool>]`, `[--renameVariables <bool>]` |
| `understand_code`  | Analyze code structure, business logic, and security                 | `--code <str>`, `[--focus <str>]`                                     |
| `summarize_code`   | Summarize code files or project contexts                             | `[--mode <str>]`, `[--code <str>]`, `[--url <str>]`                   |
| `detect_crypto`    | Detect crypto algorithms/libraries (MD5, AES, RSA, SM2/3/4)          | `--code <str>`, `[--useAI <bool>]`                                    |
| `detect_captcha`   | Detect CAPTCHA challenge status or wait for clear                    | `[--action <str>]`, `[--timeout <num>]`                               |
| `analyze_target`   | Rapid target fingerprinting and security risk evaluation             | `--url <str>`                                                         |
| `risk_panel`       | Display security and risk control panel for current site             | `[--code <str>]`, `[--useAI <bool>]`, `[--includeHookSignals <bool>]` |

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

### 2. understand_code

Perform structural analysis on minified or reversed code snippets to extract business logic, inputs, outputs, and side-effects.

```bash
# Focus on business logic
proxycli call understand_code --code "function e(t,n){...}" --focus business
```

### 3. summarize_code

Summarize scripts or project modules to obtain high-level architecture before diving into details.

```bash
proxycli call summarize_code --mode single --url "https://example.com/assets/app.js"
```

### 4. detect_crypto

Scan JavaScript source code for cryptographic signatures (S-boxes, IVs, constants, module exports) such as AES, DES, RSA, HMAC, SHA, SM2/3/4.

```bash
# Scan for crypto implementations
proxycli call detect_crypto --code "..." --useAI true
```

### 5. detect_captcha

Inspect the current page to determine if a CAPTCHA challenge is blocking navigation or execution. Note: this tool only evaluates status, it does NOT solve CAPTCHAs.

```bash
# Immediate evaluation of page state
proxycli call detect_captcha --action detect

# Wait for human verification or challenge clearance (timeout 1000-300000ms)
proxycli call detect_captcha --action wait_for_clear --timeout 60000
```

### 6. analyze_target & risk_panel

Assess the target domain's bot detection, WAF type, and frontend protection posture before planning an attack.

```bash
# Analyze URL target profile
proxycli call analyze_target --url "https://example.com"

# View current page risk indicators
proxycli call risk_panel
```
