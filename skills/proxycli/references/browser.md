# Browser Navigation & Page Control Reference

Browser navigation, tab context, frame switching, and health check tools for `proxycli`.

## Overview

Manage browser targets, lifecycle, iframes, and health before and during reverse engineering.

| Tool Name              | Description                                      | Key Parameters                                              |
| ---------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| `list_pages`           | List all open pages with index, URL, and title   | None                                                        |
| `select_page`          | Switch active page context by index              | `--pageIdx <num>`                                           |
| `new_page`             | Create new tab and navigate to URL               | `--url <str>`, `[--timeout <num>]`, `[--preloadHook <str>]` |
| `navigate_page`        | Navigate current page (back/forward/reload/goto) | `[--type <str>]`, `[--url <str>]`, `[--ignoreCache <bool>]` |
| `list_frames`          | List all frames (including iframes) in page      | None                                                        |
| `select_frame`         | Select frame context for subsequent JS execution | `--frameIdx <num>`                                          |
| `check_browser_health` | Check browser connection and runtime health      | None                                                        |

---

## Detailed Commands

### 1. list_pages

List all open pages, including their target index, current URL, and title. Always run this first to locate your target page index.

```bash
proxycli call list_pages
```

### 2. select_page

Switch the current controlling page context to the specified page index (`pageIdx`).

```bash
proxycli call select_page --pageIdx 0
```

### 3. new_page

Open a new browser tab and navigate to a URL. Can optionally inject a preload hook script or preset before the page scripts load.

```bash
# Basic tab creation
proxycli call new_page --url "https://example.com/login"

# Create tab with custom timeout and preload hook
proxycli call new_page --url "https://example.com" --timeout 30000 --preloadHook "console.log('Preload injected');"
```

### 4. navigate_page

Control current page navigation. `--type` supports `url` (default), `back`, `forward`, `reload`.

```bash
# Jump to URL
proxycli call navigate_page --url "https://example.com/target"

# Reload without cache
proxycli call navigate_page --type reload --ignoreCache true

# Navigate back
proxycli call navigate_page --type back
```

### 5. list_frames

List all frames and iframes in the current page, displaying their frame IDs, names, and URLs. Crucial when the target form or verification slider is embedded inside an iframe.

```bash
proxycli call list_frames
```

### 6. select_frame

Switch JavaScript execution and DOM context to a specific frame. Subsequent `evaluate_script` and DOM queries will execute within this frame.

```bash
proxycli call select_frame --frameIdx 1
```

### 7. check_browser_health

Run a diagnostic check on browser connection, active page status, and protocol responsiveness.

```bash
proxycli call check_browser_health
```
