# MITM Proxy & Traffic Capture Reference

MITM proxy management, non-browser traffic sniffing, request/response rewrite rules, HAR export, and local process interception for `proxycli`.

## Overview

Capture, inspect, and modify HTTP/HTTPS traffic from non-browser clients (scripts, curl, Python requests, mobile apps, desktop clients like WeChat/Electron) using the built-in MITM proxy.

| Tool Name                   | Description                                                                           | Key Parameters                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `start_mitm_proxy`          | Start MITM capture proxy server                                                       | `[--port <num>]`, `[--upstreamProxy <str>]`                                         |
| `stop_mitm_proxy`           | Stop MITM proxy and release port                                                      | None                                                                                |
| `export_mitm_ca`            | Export root CA cert (PEM/DER) to trust HTTPS                                          | `--outputPath <str>`, `[--format <str>]`                                            |
| `list_mitm_requests`        | List captured proxy traffic (max 2000 in memory)                                      | `[--urlFilter <str>]`, `[--host <str>]`, `[--method <str>]`, `[--statusCode <num>]` |
| `get_mitm_request`          | Get full headers/bodies for captured request                                          | `--id <num>`, `[--saveTo <str>]`, `[--format <str>]`                                |
| `clear_mitm_requests`       | Clear all captured proxy traffic records                                              | None                                                                                |
| `mitm_export_har`           | Export captured traffic buffer to standard HAR 1.2                                    | `[--outputPath <str>]`                                                              |
| `mitm_add_rule`             | Add rewrite rule (`block`, `map_local`, `map_remote`, `modify_header`, `modify_body`) | `--action <obj>`, `[--id <str>]`, `[--urlFilter <str>]`, `[--host <str>]`           |
| `mitm_list_rules`           | List all active rewrite rules                                                         | None                                                                                |
| `mitm_remove_rule`          | Remove rewrite rule by ID                                                             | `--id <str>`                                                                        |
| `mitm_clear_rules`          | Clear all rewrite rules                                                               | None                                                                                |
| `mitm_add_host_filter`      | Add host filter (`allow` whitelist or `block` blacklist)                              | `--action <str>`, `--host <str>`                                                    |
| `mitm_list_host_filters`    | List all active host filters                                                          | None                                                                                |
| `mitm_remove_host_filter`   | Remove specific host filter                                                           | `--action <str>`, `--host <str>`                                                    |
| `mitm_clear_host_filters`   | Clear all host filters                                                                | None                                                                                |
| `mitm_list_local_processes` | List local processes holding TCP connections                                          | None                                                                                |
| `mitm_configure_local_apps` | Configure system proxy interception for specific target apps                          | `[--enabled <bool>]`, `[--targets <arr>]`                                           |

---

## CLI Interactive Terminal (REPL)

In addition to programmatic tool calls, `proxycli` provides a dedicated interactive terminal command:

```bash
# Start interactive MITM capture REPL (default port: 8888)
proxycli proxy

# Start with custom port and upstream SOCKS5 proxy
proxycli proxy --port 9090 --upstream "socks5://127.0.0.1:1080"

# Start with automatic Windows system proxy takeover
proxycli proxy --sysproxy

# Query running proxy status
proxycli proxy status
proxycli proxy status --json
```

---

## Detailed Tool Commands

### 1. Starting & Stopping the Proxy

```bash
# Start MITM proxy listening on 127.0.0.1:8888
proxycli call start_mitm_proxy --port 8888

# Start with upstream SOCKS5 forwarding
proxycli call start_mitm_proxy --port 8888 --upstreamProxy "socks5://127.0.0.1:1080"

# Stop proxy service
proxycli call stop_mitm_proxy
```

### 2. Exporting and Trusting the CA Certificate

To decrypt HTTPS traffic, clients or operating systems must trust the generated MITM root certificate.

```bash
# Export CA certificate to PEM format
proxycli call export_mitm_ca --outputPath "artifacts/mitm_ca.crt" --format pem

# Example client verification with curl:
# curl -x http://127.0.0.1:8888 --cacert artifacts/mitm_ca.crt https://example.com/api
```

### 3. Inspecting Captured Requests

```bash
# List requests matching URL pattern
proxycli call list_mitm_requests --urlFilter "/api/v1" --method "POST"

# Filter by host
proxycli call list_mitm_requests --host "api.target.com" --statusCode 200

# Get complete request details, headers, and body
proxycli call get_mitm_request --id 1

# Export request directly to a ready-to-run curl command
proxycli call get_mitm_request --id 1 --format curl

# Save large response body directly to file
proxycli call get_mitm_request --id 1 --saveTo "artifacts/response_01.json"

# Clear captured requests
proxycli call clear_mitm_requests
```

### 4. Traffic Filtering (Host Whitelist / Blacklist)

When non-empty, whitelist (`allow`) takes precedence and causes non-whitelisted domains to pass through without interception.

```bash
# Whitelist only target API domain
proxycli call mitm_add_host_filter --action allow --host "api.target.com"

# Block noisy analytics domains
proxycli call mitm_add_host_filter --action block --host "google-analytics.com"

# View active host filters
proxycli call mitm_list_host_filters

# Clear all filters
proxycli call mitm_clear_host_filters
```

### 5. Dynamic Rewrite Rules (Mock, Map, Header & Body Modification)

Rewrite rules intercept and modify traffic on the fly:

```bash
# 1. Map remote request to local mock file
proxycli call mitm_add_rule \
  --action '{"type":"map_local","urlRegex":"https://api\\.example\\.com/config","localPath":"artifacts/mock_config.json","statusCode":200}' \
  --id "rule_mock_config"

# 2. Redirect request to another server (map_remote)
proxycli call mitm_add_rule \
  --action '{"type":"map_remote","urlRegex":"https://prod\\.api\\.com/(.*)","replacement":"https://dev.api.com/$1"}' \
  --id "rule_redirect_dev"

# 3. Modify headers (e.g. inject custom auth token)
proxycli call mitm_add_rule \
  --urlFilter "/api" \
  --action '{"type":"modify_header","phase":"request","set":{"X-Debug-Mode":"1"}}' \
  --id "rule_inject_header"

# 4. Modify response body (regex or literal replace)
proxycli call mitm_add_rule \
  --urlFilter "/bundle.js" \
  --action '{"type":"modify_body","phase":"response","find":"debugger;","replace":"/* disabled */"}' \
  --id "rule_remove_debugger"

# 5. List and remove rules
proxycli call mitm_list_rules
proxycli call mitm_remove_rule --id "rule_mock_config"
proxycli call mitm_clear_rules
```

### 6. Exporting to HAR

Export all captured requests and responses to a standard HAR 1.2 file for viewing in Charles, Fiddler, or Chrome DevTools.

```bash
proxycli call mitm_export_har --outputPath "artifacts/traffic.har"
```

### 7. Local App & Process Interception

Intercept desktop applications or specific Windows executables.

```bash
# List local processes holding network connections
proxycli call mitm_list_local_processes

# Configure transparent system proxy to intercept target desktop application
proxycli call mitm_configure_local_apps --enabled true --targets '["wechat.exe"]'

# Disable system proxy takeover
proxycli call mitm_configure_local_apps --enabled false
```
