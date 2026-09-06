# DOM Query & Element Interaction Reference

DOM inspection, click/input simulation, form automation, and page screenshots for `proxycli`.

## Overview

Automate user interactions (clicks, keyboard input, drag & drop, file uploads) to trigger encryption routines and generate network traffic.

| Tool Name                   | Description                                                       | Key Parameters                                          |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| `query_dom`                 | Query elements by CSS selector (position, attributes, visibility) | `--selector <str>`, `[--all <bool>]`, `[--limit <num>]` |
| `get_dom_structure`         | Retrieve simplified/compressed DOM hierarchy                      | `[--maxDepth <num>]`, `[--includeText <bool>]`          |
| `find_clickable_elements`   | Search for clickable interactive elements                         | `[--filterText <str>]`                                  |
| `click` / `click_element`   | Simulate mouse click on target element                            | `--selector <str>`, `[--timeoutMs <num>]`               |
| `click_at`                  | Physical CDP coordinate click at element center (anti-hijack)     | `--selector <str>`                                      |
| `fill` / `type_text`        | Fill value or simulate real keyboard typing                       | `--selector <str>`, `--value/--text <str>`              |
| `fill_form`                 | Batch fill form fields                                            | `[--timeoutMs <num>]`                                   |
| `press_key`                 | Dispatch specific physical keyboard key or combo                  | `--key <str>`                                           |
| `hover` / `drag`            | Hover mouse over element or drag between elements                 | `--selector <str>`, `--fromSelector / --toSelector`     |
| `set_files` / `upload_file` | Upload files via CDP or DOM input                                 | `--selector <str>`, `--filePath / --filePaths`          |
| `scroll_by`                 | Scroll page and wait for lazy-loaded assets                       | `--direction <str>`, `[--pixels <num>]`                 |
| `wait_for_element`          | Synchronously wait until selector appears                         | `--selector <str>`, `[--timeout <num>]`                 |
| `handle_dialog`             | Auto-dismiss or accept alert/confirm/prompt                       | `--action <str>`, `[--promptText <str>]`                |
| `take_screenshot`           | Capture full-page or viewport screenshot                          | `[--fullPage <bool>]`, `[--filePath <str>]`             |

---

## Detailed Commands

### 1. Element Querying

```bash
# Query element visibility, bounds, and attributes
proxycli call query_dom --selector "button#submit"

# Find clickable elements containing specific text
proxycli call find_clickable_elements --filterText "Login"

# Get simplified DOM structure (depth 3)
proxycli call get_dom_structure --maxDepth 3
```

### 2. Clicks & Input Simulation

```bash
# Standard click
proxycli call click --selector "button#login-btn"

# CDP physical coordinate click (recommended for sliders and anti-bot protected buttons)
proxycli call click_at --selector "div.slider-handle"

# Typing with realistic key delays
proxycli call type_text --selector "input#username" --text "test_user" --delay 100

# Direct value fill (faster)
proxycli call fill --selector "input#password" --value "P@ssw0rd123"
```

### 3. Drag, Upload & Wait

```bash
# Drag slider element across track
proxycli call drag --fromSelector "div.slider-knob" --toSelector "div.slider-target"

# Upload local file to file input
proxycli call upload_file --selector "input[type=file]" --filePath "artifacts/sample.png"

# Wait for dynamic element to render
proxycli call wait_for_element --selector "div.verify-success" --timeout 10000
```

### 4. Screenshots & Dialogs

```bash
# Take full-page screenshot
proxycli call take_screenshot --fullPage true --filePath "artifacts/screenshots/page.png"

# Automatically accept next dialog
proxycli call handle_dialog --action accept
```
