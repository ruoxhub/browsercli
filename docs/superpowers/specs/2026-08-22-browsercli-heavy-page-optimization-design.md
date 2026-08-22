# BrowserCLI Heavy SPA Reverse Engineering Optimization — System Design Spec

- **Date:** 2026-08-22
- **Status:** Approved
- **Target Subsystems:** `browsercli/`, `src/worker/`, `src/modules/debugger/`, `src/modules/network/`, `src/modules/hook/`, `src/tools/`

---

## 1. Background & Motivation

During high-load real-world reverse engineering of complex SPA / Web IDE targets (e.g. Trae with 45+ massive JavaScript chunks, multi-frame context hierarchies, dual XHR/Fetch network stacks, and Protobuf binary WebSocket gateways), the current BrowserCLI runtime encountered several critical stability, performance, and usability bottlenecks:

1. **Worker Deadlock & Job Leakage (P0)**: Tasks encountering long CDP calls timeout on the client side, but underlying CDP operations continue occupying the single-threaded worker. The worker remains in `409 WORKER_BUSY`, causing subsequent probes (`evaluate_script`, `list_pages`) to fail hard without recovery until manual `jobs cancel`.
2. **Script Search Timeout (P1)**: `search_in_sources` downloaded all 45+ source scripts over CDP into Node.js memory before running regex, causing 5-minute timeouts. `search_in_scripts` failed immediately if code was not pre-collected.
3. **Large Response Body Blocking (P1)**: `get_network_request` pulled multi-megabyte payloads in full over RPC, freezing CLI serialisation for minutes.
4. **Fetch Hook Ineffectiveness (P1)**: `create_hook('fetch')` only patched `window.fetch`, missing requests made via `XMLHttpRequest` (e.g. Axios defaults) or cached native closures.
5. **Multi-Frame Execution Context Ambiguity (P2)**: `evaluate_script` without explicit `--frameId` failed when multiple execution contexts existed, requiring manual regex extraction of frame IDs from raw error strings.
6. **Binary/Protobuf WebSocket Decoding Overhead (P2)**: Gateway binary frames containing Protobuf headers and JSON bodies were rendered as truncated base64 previews, requiring tedious manual decoding.
7. **CLI Arguments & Output Inconsistencies (P2)**: Argument mismatches (e.g. `--direction both` failing, unsupported `--action monitor`), and non-standardised output making jq/grep automation difficult.

---

## 2. Goals & Non-Goals

### Goals
- **Self-Healing Worker Runtime**: Ensure cancellation signals cascade through to CDP, isolate read/probe operations from exclusive writes, and implement adaptive backoff retry on 409 responses.
- **Sub-100ms Source Code Search**: Use CDP `Debugger.searchInContent` for zero-memory pre-filtering across scripts; load and cache code on disk lazily.
- **Safe Network & WS Throughput**: Truncate response bodies to 4KB preview by default with `--fullBody` and `--saveTo` options; introduce zero-schema Protobuf/JSON payload auto-decoding for WebSocket messages.
- **Robust Hooking & Multi-Frame Navigation**: Simultaneously hook Fetch and XHR with protocol-level fallback; auto-fallback to Top/Main frame in script evaluations and return structured ambiguity diagnostics.
- **CLI Standardisation**: Support `--json` on all listing commands, align parameter schemas, and document all action/capture capabilities.

### Non-Goals
- Replacing Playwright/CDP with an entirely new browser automation engine.
- Implementing a full-blown protobuf compiler `.proto` code generator (heuristics and zero-schema extraction suffice for reverse inspection).

---

## 3. Architecture & Subsystem Design

```
+-----------------------------------------------------------------------------------+
|                                  BrowserCLI CLI                                   |
|   - WorkerHttpClient (Adaptive Backoff Retry, Auto-Cancellation on TaskStop)      |
|   - CLI Output Formatter (--json pure data stream vs formatted views)             |
+------------------------------------------+----------------------------------------+
                                           | HTTP /api/v1 & WebSocket Streams
                                           v
+-----------------------------------------------------------------------------------+
|                              Worker Runtime Layer                                 |
|   - apiV1 Router (Job Cancellation Signal Propagation, Frame Ambiguity Struct)   |
|   - WorkerActivityCoordinator (Read/Write Concurrency & Shared/Exclusive Locks)   |
|   - JobStore (Atomic State Transitions: running -> cancelled/done)                |
|   - ToolExecutionPipeline (AbortSignal Plumbing & Prerequisite Checking)         |
+------------------------------------------+----------------------------------------+
                                           |
    +--------------------------------------+------------------------------------+
    |                                      |                                    |
    v                                      v                                    v
+-----------------------+     +--------------------------+     +--------------------+
|  Debugger & Script    |     |  Network & WebSocket     |     |  Hooking Module    |
|  - ScriptManager      |     |  - NetworkModule         |     |  - HookCodeBuilder |
|    (Debugger.searchIn |     |    (4KB Truncation,      |     |    (Unified Fetch  |
|     Content & Lazy    |     |     --fullBody,          |     |     + XHR hook)    |
|     Disk Caching)     |     |     --saveTo streaming)  |     |  - CDP Fetch       |
|  - ContextSelector    |     |  - WsProtobufDecoder     |     |    Fallback Engine |
|    (Top-frame default |     |    (Zero-Schema Parser,  |     |                    |
|     & structured err) |     |     Embedded JSON extract|     |                    |
+-----------------------+     +--------------------------+     +--------------------+
```

---

## 4. Detailed Module Specifications

### Module 1: Worker Concurrent Lifecycle & Adaptive Scheduling

#### 1.1 Cancellation Cascade & Resource Release
- When `POST /api/v1/jobs/:id/cancel` is invoked, or an HTTP client connection terminates:
  1. The job's `AbortController` triggers `abort(new JobAbortError('JOB_CANCELLED'))`.
  2. `raceWithAbort` in `ToolExecutionPipeline` catches the abort signal, triggers cleanup hooks, and detaches pending CDP listener promises.
  3. `JobStore.cancel(jobId)` immediately moves the job to `cancelled` status and `WorkerActivityCoordinator` decrements active counters.

#### 1.2 Read/Write Separation in Activity Coordinator
- Categorise operations into:
  - **Exclusive (Write)**: `navigate`, `connectBrowser`, `disconnectBrowser`, breakpoint stepping, page reloads.
  - **Shared / Probe (Read)**: `evaluate_script`, `list_pages`, `list_network_requests`, `list_scripts`, `get_browser_status`, `get_script_source`.
- `WorkerActivityCoordinator` permits multiple concurrent Shared/Probe executions while blocking exclusive operations.

#### 1.3 Adaptive Backoff in `WorkerHttpClient`
- When `WorkerHttpClient.invoke()` receives `409 WORKER_BUSY` for a probe-type tool:
  - Back off with retries at `[200ms, 500ms, 1000ms]` (max 3 retries, total timeout 3s).
  - If still busy, return structured busy error with current running `jobId` and `operation`.

---

### Module 2: CDP Native Script Pre-filtering & Multi-Tier Lazy Caching

#### 2.1 Native Search via `Debugger.searchInContent`
- `ScriptManager.searchInScripts` / `search_in_sources`:
  - **Tier 1 (Cached)**: Search in-memory/disk cached files using local RegExp.
  - **Tier 2 (Uncached)**: Dispatch CDP `Debugger.searchInContent` for each uncached script. Chromium performs search in V8 memory without serialising source strings across the wire.
  - Returns matches formatted as: `{ scriptId, url, lineNumber, lineContent }`.

#### 2.2 Lazy Source Loading & Automatic Local Disk Caching
- When `get_script_source(scriptId, startLine, endLine)` is called:
  - Fetches the script source via CDP `Debugger.getScriptSource`.
  - Atomically caches the full content to `.cache/scripts/<sha256>.js`.
  - Serves requested line ranges directly from the cached file.
- `search_in_scripts` fallback:
  - When `CodeCollector` cache is empty, automatically falls back to live CDP search with `source: "cdp-live-fallback"` metadata.

---

### Module 3: Network Response Truncation, Streaming & WebSocket Protobuf Decoder

#### 3.1 Network Request Response Truncation & File Offload
- In `NetworkModule.getRequest`:
  - **Default Preview**: Truncate response text to `maxBodyLength` (default `4096` chars / 4KB).
  - Return metadata:
    ```typescript
    interface GetNetworkRequestData {
      reqid: number;
      url: string;
      statusCode: number;
      responseBody?: string;
      isTruncated: boolean;
      totalBodyLength: number;
      previewLength: number;
      savedPath?: string;
    }
    ```
  - **`fullBody: true`**: Skips truncation and returns the entire response body.
  - **`saveTo: string`**: Streams response bytes directly to the specified file path, returning `savedPath` and `bytesWritten` without filling memory or terminal buffers.

#### 3.2 WebSocket Zero-Schema Protobuf / JSON Decoder
- In `get_websocket_messages` / `get_websocket_message`:
  - Add parameter `decode?: 'auto' | 'protobuf' | 'json' | 'raw'` (default `'auto'`).
  - **Decoder Heuristics (`WsProtobufDecoder`)**:
    1. Check for binary framing containing Varint field tags (e.g. ByteDance gateway wrappers).
    2. Scan for embedded UTF-8 string slices matching JSON object/array boundaries (`{...}` / `[...]`).
    3. If valid JSON is parsed, structure it into `decodedJson` and mark `decodeType: 'protobuf-embedded-json'`.
  - Raise `maxPayloadSize` default to `65536` (64KB) with customizable upper limit.

---

### Module 4: Dual Protocol Network Hooking & Multi-Frame Error Diagnostics

#### 4.1 Unified Fetch + XHR Hooking
- In `HookCodeBuilder.ts` and `createHook('fetch')`:
  - Output script hooks **both** `window.fetch` and `window.XMLHttpRequest.prototype.open / send`.
  - Unifies argument extraction, header capture, and response monitoring across Axios, Fetch, and legacy AJAX libraries.
  - Support protocol-level interception via CDP `Fetch.enable` for environments where JS hooks are avoided or bypassed.

#### 4.2 Multi-Frame Evaluation Fallback & Structured Diagnostics
- In `src/tools/script/script.ts` (`evaluate_script`):
  - When `--frameId` is not provided, prioritize the **Top/Main Frame** execution context instead of throwing an ambiguity error.
  - When context selection fails or true ambiguity occurs, return a structured error response:
    ```typescript
    interface FrameAmbiguityErrorData {
      code: 'FRAME_AMBIGUITY';
      message: string;
      availableFrames: Array<{
        frameId: string;
        name: string;
        url: string;
        isMain: boolean;
      }>;
    }
    ```

---

### Module 5: CLI Contract & Output Standardization

1. **Direction Options**:
   - `get_websocket_messages`: Add `'both'` to `direction` enum (default `'both'`), merging sent and received messages in chronological sequence.
2. **Hook Definition Schema**:
   - Document and type all `create_hook` options: `action` (`log | block | modify | passthrough`), `capture` (`args, returnValue, stack, timing, thisContext`).
3. **`--json` Output Mode**:
   - `list_network_requests`, `list_pages`, `list_frames`, `list_scripts` support `--json` flag to emit raw, parseable JSON arrays without ANSI formatting or table decorations.

---

## 5. Verification & Testing Strategy

1. **Worker Lifecycle Unit & Integration Tests**:
   - Verify `apiV1` cancel endpoint terminates long-running asynchronous jobs.
   - Verify shared read operations succeed during concurrent probe calls and backoff on transient busy states.
2. **Script Search & Caching Benchmarks**:
   - Mock 50 script sources; verify `Debugger.searchInContent` executes in `< 50ms` and only matched scripts trigger disk writes.
3. **Network Truncation & Large Payload Tests**:
   - Request 5MB test payload; verify default response returns 4KB with `isTruncated: true` and `saveTo` correctly outputs file on disk.
4. **WebSocket Protobuf Decoder Tests**:
   - Test ByteDance binary gateway frame samples; verify embedded JSON is automatically extracted into `decodedJson`.
5. **Unified Hook & Frame Context Tests**:
   - Verify simultaneous interception of `fetch()` and `xhr.send()`.
   - Test `evaluate_script` on multi-iframe test pages to ensure top-frame fallback and structured diagnostics.

---

## 6. Implementation Rollout Plan

- **Phase 1 (P0 Stability)**: Worker cancellation cascade, Activity Coordinator read/write separation, and adaptive backoff retry.
- **Phase 2 (P1 Performance)**: `Debugger.searchInContent` lazy search and disk caching, network response body 4KB truncation, `fullBody`/`saveTo` options.
- **Phase 3 (P1 Reverse Capabilities)**: Unified Fetch+XHR Hook, WebSocket Protobuf auto-decoder, and CDP Fetch fallback.
- **Phase 4 (P2 Usability & Contracts)**: Multi-frame top fallback with structured error response, CLI `--json` format support, and parameter schema fixes.
