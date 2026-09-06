# Script Collection & Search Reference

Script discovery, source retrieval, keyword matching, and target snapshots for `proxycli`.

## Overview

Inspect and collect JavaScript source code loaded by Chromium targets.

| Tool Name             | Description                                       | Key Parameters                                                                  |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `list_scripts`        | List all loaded scripts in the active page        | `[--filter <str>]`                                                              |
| `get_script_source`   | Get JavaScript source code for a script ID        | `--scriptId <str>`, `[--filePath <str>]`, `[--startLine <num> --endLine <num>]` |
| `search_in_sources`   | Search loaded scripts using regex or string       | `--query <str>`, `[--urlFilter <str>]`                                          |
| `search_in_scripts`   | Search locally cached scripts                     | `--pattern <str>`, `[--limit <num>]`, `[--maxTotalSize <num>]`                  |
| `find_in_script`      | Find text in specific script (exact line/col)     | `--scriptId <str>`, `--query <str>`                                             |
| `collect_code`        | Smart collect scripts to local disk               | `--url <str>`, `[--smartMode <str>]`, `[--pattern <str>]`                       |
| `collection_diff`     | Compare changes between collection runs           | `[--includeUnchanged <bool>]`                                                   |
| `list_targets`        | List Chromium targets and script snapshot status  | None                                                                            |
| `dump_target_scripts` | Dump scripts parsed by a specific Chromium target | `--targetId <str>`                                                              |

---

## Detailed Commands

### 1. list_scripts

List all loaded scripts in the active page. Filter by script URL pattern or name.

```bash
# List all loaded scripts
proxycli call list_scripts

# List scripts matching a URL keyword
proxycli call list_scripts --filter "app"
```

### 2. get_script_source

Retrieve the source code of a specific script by its `scriptId`. Supports slicing by line range for large bundle files.

```bash
# Read full script source
proxycli call get_script_source --scriptId "42"

# Read lines 100 to 200 of a minified bundle
proxycli call get_script_source --scriptId "42" --startLine 100 --endLine 200

# Save script source directly to a local file
proxycli call get_script_source --scriptId "42" --filePath "artifacts/scripts/vendor.js"
```

### 3. search_in_sources

Search across all loaded script sources for sensitive function names, encryption keys, or parameter names (e.g. `signature`, `_0x`, `encrypt`).

```bash
# Search for signature calculation keyword
proxycli call search_in_sources --query "sign("

# Search with URL filter to isolate business logic
proxycli call search_in_sources --query "encrypt" --urlFilter "main.js"
```

### 4. search_in_scripts

Search inside locally collected/cached script files.

```bash
proxycli call search_in_scripts --pattern "AES" --limit 20
```

### 5. find_in_script

Find a query string in a specific script and return the exact line and column numbers. Helpful before placing precise breakpoints.

```bash
proxycli call find_in_script --scriptId "42" --query "window.loginSign"
```

### 6. collect_code

Collect and persist all JavaScript code related to the page. `smartMode` supports: `summary`, `priority`, `incremental`, `full`.

```bash
# Collect core business scripts
proxycli call collect_code --url "https://example.com" --smartMode priority

# Full dump of all scripts under size limit
proxycli call collect_code --url "https://example.com" --smartMode full --maxTotalSize 10485760
```

### 7. collection_diff

Compare code file summaries between different collection passes to detect dynamically loaded or mutated scripts.

```bash
proxycli call collection_diff --includeUnchanged false
```

### 8. list_targets & dump_target_scripts

When regular debugger collection cannot cover ServiceWorkers, WebWorkers, or background pages, use Chromium Target snapshots.

```bash
# 1. Inspect targets and acquire targetId
proxycli call list_targets

# 2. Dump parsed scripts for that target
proxycli call dump_target_scripts --targetId "CB8F8E32D9..."
```
