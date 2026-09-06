# Anti-Detection & Stealth Reference

Bypass anti-debugging traps, disable debugger statements, and inject stealth scripts for `proxycli`.

## Overview

Modern web applications deploy anti-debugging loops (`setInterval` + `debugger`), webdriver detection, and environment fingerprinting. These tools neutralize detection vectors.

| Tool Name               | Description                                                                | Key Parameters      |
| ----------------------- | -------------------------------------------------------------------------- | ------------------- |
| `anti_anti_debug`       | Freeze time, fix viewport, disable close/history traps                     | None                |
| `bypass_debugger`       | Filter out infinite loop `debugger` statements dynamically                 | None                |
| `set_user_agent`        | Configure custom User-Agent string                                         | `--userAgent <str>` |
| `inject_stealth`        | Inject anti-detection scripts (mask webdriver, permissions, chrome object) | `[--preset <str>]`  |
| `list_stealth_features` | List all supported stealth sub-features                                    | None                |
| `list_stealth_presets`  | List available stealth presets                                             | None                |

---

## Detailed Commands

### 1. bypass_debugger

Bypass websites with infinite `debugger;` loops triggered via `Function("debugger")()` or recurring timers.

```bash
# Activate dynamic debugger statement bypass
proxycli call bypass_debugger
```

### 2. anti_anti_debug

Enable anti-anti-debugging measures: fixes viewport dimensions, disables page close prevention, blocks history navigation spam, and stabilizes window dimensions.

```bash
proxycli call anti_anti_debug
```

### 3. inject_stealth

Inject anti-fingerprinting scripts to pass bot detection benchmarks (e.g. CreepJS, Cloudflare Turnstile bot checks). Masks `navigator.webdriver`, `window.chrome`, WebGL vendor/renderer, plugins, and permissions.

```bash
# Inject standard stealth preset
proxycli call inject_stealth --preset standard

# List available features and presets
proxycli call list_stealth_features
proxycli call list_stealth_presets
```

### 4. set_user_agent

Override browser User-Agent header and `navigator.userAgent` property.

```bash
proxycli call set_user_agent --userAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
```
