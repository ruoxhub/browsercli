# Debugging & Breakpoints Reference

Breakpoint control, execution stepping, call stack inspection, and runtime evaluation tools for `proxycli`.

## Overview

Use breakpoints when you must freeze execution to inspect local closures, obfuscated variable scopes, and call frames.

| Tool Name                              | Description                                          | Key Parameters                                               |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `set_breakpoint`                       | Set breakpoint by script URL and line number         | `--url <str>`, `--lineNumber <num>`, `[--condition <str>]`   |
| `remove_breakpoint`                    | Remove breakpoint by ID                              | `--breakpointId <str>`                                       |
| `list_breakpoints`                     | List all active breakpoints                          | None                                                         |
| `set_breakpoint_on_text`               | Find text pattern in scripts and place breakpoint    | `--text <str>`, `[--urlFilter <str>]`, `[--condition <str>]` |
| `break_on_xhr`                         | Pause execution when XHR/Fetch URL matches substring | `--url <str>`                                                |
| `remove_xhr_breakpoint`                | Remove XHR breakpoint                                | `--url <str>`                                                |
| `xhr_to_js_breakpoint`                 | Automatically map XHR trigger to JS caller line      | `--url <str>`                                                |
| `step_into` / `step_over` / `step_out` | Step through execution while paused                  | None                                                         |
| `resume` / `pause`                     | Resume or force-pause script execution               | None                                                         |
| `get_paused_info`                      | Get call stack and top frame scope when paused       | None                                                         |
| `inspect_locals`                       | Inspect local variables across call stack frames     | None                                                         |
| `inspect_object`                       | Deep inspection of a JavaScript object               | `--expression <str>`                                         |
| `evaluate_on_callframe`                | Evaluate JS in the context of the paused frame       | `--expression <str>`                                         |
| `evaluate_script`                      | Execute JS in page context without pause/breakpoint  | `--function <str>`, `[--context <str>]`                      |

---

## Detailed Commands

### 1. Setting and Managing Breakpoints

Set breakpoints by URL and line number, or automatically by searching text content across loaded scripts.

```bash
# Set line breakpoint with optional condition
proxycli call set_breakpoint --url "https://example.com/static/js/app.js" --lineNumber 142 --condition "x > 0"

# Set breakpoint on matched code text
proxycli call set_breakpoint_on_text --text "encryptPassword(" --urlFilter "login.js"

# List and remove breakpoints
proxycli call list_breakpoints
proxycli call remove_breakpoint --breakpointId "1:142:0"
```

### 2. XHR / Fetch Breakpoints

Pause execution when a network request is dispatched.

```bash
# Break whenever request URL contains '/api/v1/sign'
proxycli call break_on_xhr --url "/api/v1/sign"

# Remove XHR breakpoint
proxycli call remove_xhr_breakpoint --url "/api/v1/sign"

# Auto-locate JS caller for network request
proxycli call xhr_to_js_breakpoint --url "/api/v1/sign"
```

### 3. Stepping and Execution Control

Execution control tools only work when the browser is in a paused state.

```bash
# Step into function
proxycli call step_into

# Step over current line
proxycli call step_over

# Step out of current function
proxycli call step_out

# Resume execution
proxycli call resume

# Force pause execution (e.g. to catch infinite loops or animations)
proxycli call pause
```

### 4. Paused Inspection & Scope Variables

Inspect the call stack, local variables, and closure scopes while frozen at a breakpoint.

```bash
# Get call stack frames and locations
proxycli call get_paused_info

# Inspect local variables in current scope
proxycli call inspect_locals

# Inspect complex object structure in depth
proxycli call inspect_object --expression "window._signatureContext"

# Evaluate expression inside paused frame context
proxycli call evaluate_on_callframe --expression "this.secretKey"
```

### 5. evaluate_script (Direct Page Execution)

Execute JavaScript in the page or content-script context without needing a breakpoint or paused state. The return value is in `data.value`.

```bash
# Read global variable or evaluate expression
proxycli call evaluate_script --function "window.__INITIAL_STATE__"

# Execute multi-line function in page context
proxycli call evaluate_script --function "(() => { return document.cookie; })()"
```
