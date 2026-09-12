# CAPTCHA State Inspection Reference

CAPTCHA state inspection tool for `proxycli`.

## Overview

Inspect the current page to determine whether a CAPTCHA challenge is blocking navigation or execution.

| Tool Name        | Description                                       | Key Parameters                          |
| ---------------- | ------------------------------------------------- | --------------------------------------- |
| `detect_captcha` | Detect CAPTCHA challenge status or wait for clear | `[--action <str>]`, `[--timeout <num>]` |

---

## Detailed Commands

### 1. detect_captcha

Inspect the current page to determine if a CAPTCHA challenge is blocking navigation or execution. Note: this tool only evaluates status, it does NOT solve CAPTCHAs.

```bash
# Immediate evaluation of page state
proxycli call detect_captcha --action detect

# Wait for human verification or challenge clearance (timeout 1000-300000ms)
proxycli call detect_captcha --action wait_for_clear --timeout 60000
```
