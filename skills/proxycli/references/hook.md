# Dynamic Hooking Reference

Non-blocking runtime interception, crypto parameter logging, and hook lifecycle management for `proxycli`.

## Overview

Hooks intercept parameters and return values without halting script execution. They are the preferred technique over breakpoints for reverse engineering.

| Tool Name               | Description                                           | Key Parameters                                               |
| ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| `create_hook`           | Create hook configuration (function/property/request) | `--type <str>`, `[--params <arr>]`, `[--action <str>]`       |
| `inject_hook`           | Inject hook script into page (supports persistence)   | `--hookId <str>`, `--script <str>`, `[--persistent <bool>]`  |
| `get_hook_data`         | Retrieve captured runtime data and argument logs      | `[--hookId <str>]`, `[--view <str>]`, `[--maxRecords <num>]` |
| `list_hooks`            | List currently active hooks in page                   | None                                                         |
| `list_created_hooks`    | List all created hook definitions                     | `[--hookId <str>]`                                           |
| `list_persistent_hooks` | List hooks that persist across page navigations       | None                                                         |
| `remove_hook`           | Remove an active hook instance                        | `--hookId <str>`                                             |
| `hook_function`         | Quickly hook a specific JavaScript function           | `--target <str>`, `[--hookId <str>]`                         |
| `unhook_function`       | Unhook a specific hijacked function                   | `--hookId <str>`                                             |
| `hook_cryptojs`         | Hook CryptoJS encrypt/decrypt calls                   | `[--algorithms <arr>]`, `[--logFormat <str>]`                |
| `hook_jsencrypt`        | Hook JSEncrypt RSA encryption calls                   | `[--logFormat <str>]`                                        |
| `hook_smcrypto`         | Hook SM-crypto (SM2/SM3/SM4) calls                    | `[--algorithms <arr>]`, `[--logFormat <str>]`                |
| `auto_hook`             | Inject bundled presets (crypto, cookies, XHR, eval)   | `[--preset <str>]`, `[--autoInject <bool>]`                  |

---

## Detailed Commands

### 1. create_hook & inject_hook

Create and inject custom JavaScript hooks into the page context. Set `--persistent true` so the hook automatically re-applies when the page redirects or reloads.

```bash
# Create custom function hook definition
proxycli call create_hook --type function --params '["window.generateToken"]' --description "Capture token input"

# Inject hook into page (persistent across navigations)
proxycli call inject_hook --hookId "hook_token_01" --script "(function(){ const orig = window.generateToken; window.generateToken = function(...args){ console.log('[HOOK]', args); return orig.apply(this, args); }; })();" --persistent true
```

### 2. get_hook_data

Fetch captured payloads, arguments, stack traces, and return values logged by installed hooks.

```bash
# Get recent 50 records for a specific hook
proxycli call get_hook_data --hookId "hook_token_01" --maxRecords 50

# View summary of all hook data
proxycli call get_hook_data --view summary
```

### 3. hook_function & unhook_function

Directly hijack a target function on `window` or an object path without writing boilerplate JS.

```bash
# Hook global function
proxycli call hook_function --target "window.md5" --hookId "hk_md5"

# Unhook when done
proxycli call unhook_function --hookId "hk_md5"
```

### 4. Library Presets: hook_cryptojs, hook_jsencrypt, hook_smcrypto

Pre-packaged hooks for standard crypto libraries commonly bundled in web applications.

```bash
# Hook CryptoJS (AES, DES, MD5, SHA256, etc.)
proxycli call hook_cryptojs --algorithms '["AES", "MD5", "SHA256"]'

# Hook JSEncrypt (RSA public key encryption)
proxycli call hook_jsencrypt --logFormat json

# Hook SM-crypto (SM2, SM3, SM4 Chinese national standards)
proxycli call hook_smcrypto --algorithms '["sm2", "sm3", "sm4"]'
```

### 5. auto_hook

Inject an all-in-one suite of observation hooks to capture crypto calls, cookie changes, XHR/Fetch dispatches, timers, and `eval()`.

```bash
# Auto hook with API signature preset
proxycli call auto_hook --preset api-signature --autoInject true --waitAfterHookMs 2000

# Targeted auto-hooking
proxycli call auto_hook --hookCrypto true --hookCookie true --hookXhr true --exportResults true
```

### 6. Hook Management: list & remove

```bash
# List all active runtime hooks
proxycli call list_hooks

# List persistent hooks that survive navigation
proxycli call list_persistent_hooks

# Remove hook by ID
proxycli call remove_hook --hookId "hook_token_01"
```
