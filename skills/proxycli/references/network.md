# Network & WebSocket Analysis Reference

HTTP/HTTPS network sniffing, initiator call stack tracing, request replay, and WebSocket inspection for `proxycli`.

## Overview

Capture, inspect, and replay HTTP requests and WebSocket frames. The initiator stack trace connects network payloads back to the originating JavaScript code.

| Tool Name                      | Description                                             | Key Parameters                                                        |
| ------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `list_network_requests`        | List captured HTTP/HTTPS requests with filters          | `[--urlFilter <str>]`, `[--pageSize <num>]`, `[--headerFilter <str>]` |
| `get_network_request`          | Get detailed request headers, post data, and response   | `--reqid <num>`, `[--maxBodyLength <num>]`                            |
| `clear_network_requests`       | Clear captured requests buffer                          | `[--targetPageIdx <num>]`                                             |
| `get_request_initiator`        | Get JavaScript call stack trace that fired the request  | `--requestId <num>`                                                   |
| `replay_network_request`       | Replay single network request with modified headers/URL | `--reqid <num>`, `[--method <str>]`, `[--headers <arr>]`              |
| `export_request_as_curl`       | Export network request as ready-to-run cURL command     | `--reqid <num>`, `[--includeCookies <bool>]`                          |
| `replay_network_request_batch` | Batch concurrent replay of requests                     | `--reqid <num>`, `[--concurrency <num>]`                              |
| `list_websocket_connections`   | List active WebSocket connections                       | `[--urlFilter <str>]`                                                 |
| `get_websocket_messages`       | Stream and inspect WebSocket frames                     | `--wsid <num>`, `[--direction <str>]`, `[--show_content <bool>]`      |
| `get_websocket_message`        | Fetch specific single WebSocket frame                   | `--wsid <num>`, `--frameIndex <num>`                                  |
| `analyze_websocket_messages`   | Cluster and analyze WebSocket frames by pattern/format  | `--wsid <num>`, `[--direction <str>]`                                 |

---

## Detailed Commands

### 1. list_network_requests

Search and filter captured network traffic.

```bash
# Filter requests matching API pattern
proxycli call list_network_requests --urlFilter "/api/v1"

# Wait for a specific request to appear within timeout
proxycli call list_network_requests --waitForRequest "/api/user/info" --waitTimeoutMs 5000
```

### 2. get_network_request

Retrieve full HTTP request and response bodies.

```bash
proxycli call get_network_request --reqid 12 --maxBodyLength 50000
```

### 3. get_request_initiator (Critical for Reverse Engineering)

Trace the exact JavaScript call stack that triggered the HTTP request. This bridges the gap between network parameters and the encryption function.

```bash
# Identify which JS script and line number sent request #12
proxycli call get_request_initiator --requestId 12
```

### 4. Replay & Export

Verify whether signatures are time-sensitive, nonce-bound, or reusable.

```bash
# Replay request as-is
proxycli call replay_network_request --reqid 12

# Export request to cURL command for external testing
proxycli call export_request_as_curl --reqid 12 --includeCookies true
```

### 5. WebSocket Inspection

Monitor live bidirectional WebSocket connections, protobuf frames, and heartbeat messages.

```bash
# 1. List active WebSocket connections and get wsid
proxycli call list_websocket_connections

# 2. View recent 20 frames on connection #1
proxycli call get_websocket_messages --wsid 1 --pageSize 20 --show_content true

# 3. Cluster frames to distinguish heartbeats from business payloads
proxycli call analyze_websocket_messages --wsid 1
```
