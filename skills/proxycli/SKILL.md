---
name: proxycli
description: Use when the user wants to control the browser, inspect HTTP/WebSocket traffic, trace signature generation, inject JavaScript hooks, capture or trace Wasm, debug with breakpoints, bypass anti-debugging, automate DOM interactions, extract and rebuild offline Node.js crypto algorithms, or operate the browser via proxycli CLI, even if they simply mention "browser reverse", "capture request", "hook crypto", "find sign", or "proxycli".
---

# ProxyCLI Skill

`proxycli` is the command-line interface for browser automation and client-side JavaScript/WebAssembly reverse-engineering tasks.

All tool executions follow the standard pattern:

```bash
proxycli call <tool_name> [arguments]
```

---

## 1. Quick Start & Session Diagnostics

Before launching an investigation, ensure the daemon session and browser are healthy:

```bash
# Check daemon session & environment status
proxycli status

# Inspect browser and page connectivity
proxycli call check_browser_health

# List open pages to locate your target
proxycli call list_pages

# Inspect storage and session state
proxycli call get_storage --type cookies

# Direct page JavaScript execution
proxycli call evaluate_script --function "() => window.__initialData"
```

### Interactive MITM Proxy Terminal (REPL)

For capturing and modifying non-browser traffic (scripts, curl, mobile apps, desktop clients):

```bash
# Start interactive MITM capture console (default port: 8888)
proxycli proxy

# Start with automatic Windows system proxy takeover
proxycli proxy --sysproxy

# Inspect proxy server status
proxycli proxy status
```

### Worker Job Recovery & Emergency Teardown

If a long-running tool call gets stuck:

```bash
# List active jobs
proxycli jobs list
proxycli jobs list --json

# Cancel a blocking job
proxycli jobs cancel <job-id>

# Force disconnect browser if the Worker lane is unresponsive
proxycli browser disconnect --force
```

---

## 2. Core Methodology & Four-Stage Workflow

Always adhere to the core philosophy: **Observe-first**, **Hook-preferred**, **Breakpoint-last**, and **Evidence-first**.

```text
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌───────────────────────┐
│ 1. Recon        │ ──> │ 2. Intercept     │ ──> │ 3. Analyze      │ ──> │ 4. Reconstruct        │
│ Network / Pages │     │ Non-blocking     │     │ AST / Crypto /  │     │ Offline Node bundle / │
│ Script collect  │     │ Dynamic hooks    │     │ Stack tracing   │     │ Env patch / Evidence  │
└─────────────────┘     └──────────────────┘     └─────────────────┘     └───────────────────────┘
```

1. **Reconnaissance**: Discover target pages, collect loaded scripts, and monitor network requests without modifying page state.
2. **Interception**: Prefer non-blocking hooks over breakpoints to capture dynamic runtime payloads, crypto arguments, and keys without pausing script execution.
3. **Analysis**: Correlate network request initiators back to JavaScript source lines; use AST deobfuscation to unravel minified control flows.
4. **Reconstruction**: Export self-contained offline Node.js execution bundles and verify parity with the browser.

---

## 3. Tool Reference Index (Progressive Disclosure)

Detailed parameters, signatures, and examples for each category are modularized under `references/`. Read the relevant reference document as needed:

| Category / Model       | Reference File                                       | Key Capabilities & Tools                                                                                                             |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Browser & Pages**    | [`references/browser.md`](./references/browser.md)   | Tab navigation, URL switching, iframe selection, health check (`list_pages`, `new_page`, `navigate_page`, `select_frame`)            |
| **Script & Source**    | [`references/script.md`](./references/script.md)     | Loaded scripts, source retrieval, keyword search, target snapshots (`list_scripts`, `get_script_source`, `collect_code`)             |
| **Code Analyzer**      | [`references/analyzer.md`](./references/analyzer.md) | CAPTCHA state inspection (`detect_captcha`)                                                                                          |
| **Dynamic Hooks**      | [`references/hook.md`](./references/hook.md)         | Non-blocking runtime hooks, crypto presets (CryptoJS/RSA/SM), auto-hook (`create_hook`, `inject_hook`, `get_hook_data`, `auto_hook`) |
| **Debugger**           | [`references/debugger.md`](./references/debugger.md) | Line & XHR breakpoints, stepping, scope evaluation (`set_breakpoint`, `break_on_xhr`, `inspect_locals`, `evaluate_script`)           |
| **Stealth**            | [`references/stealth.md`](./references/stealth.md)   | Anti-anti-debug, infinite debugger loop bypass, fingerprint stealth (`bypass_debugger`, `anti_anti_debug`, `inject_stealth`)         |
| **WebAssembly**        | [`references/wasm.md`](./references/wasm.md)         | Wasm capture, dump, boundary tracing, memory inspection (`collect_wasm`, `wasm_dump`, `wasm_vmp_trace`, `wasm_memory_inspect`)       |
| **DOM & Input**        | [`references/dom.md`](./references/dom.md)           | Selector queries, click/type/drag simulation, screenshots (`query_dom`, `click_at`, `type_text`, `take_screenshot`)                  |
| **Network & WS**       | [`references/network.md`](./references/network.md)   | Request sniffing, initiator stack trace, replay, cURL export, WebSocket frames (`list_network_requests`, `get_request_initiator`)    |
| **MITM Proxy**         | [`references/proxy.md`](./references/proxy.md)       | Non-browser traffic capture, rewrite rules, HAR export (`start_mitm_proxy`, `list_mitm_requests`, `mitm_add_rule`)                   |
| **Rebuild & Evidence** | [`references/rebuild.md`](./references/rebuild.md)   | Offline bundle building, evidence logging (`record_reverse_evidence`, `rebuild_bundle`, `trace_signature_generation`)                |
| **Workflow**           | [`references/workflow.md`](./references/workflow.md) | Automated observe-and-collect workflow on a target page (`observe_flow`)                                                             |
| **Session & Storage**  | [`references/session.md`](./references/session.md)   | Cookie/Storage snapshots, session persistence, video frame capture (`get_storage`, `save_session_state`, `restore_session_state`)    |
| **Full Model Index**   | [`references/model.md`](./references/model.md)       | Complete alphabetical tool-to-reference lookup dictionary                                                                            |

---

## 4. Common Reverse-Engineering Playbooks

### Scenario A: Trace Request Signature to Origin Function

1. Filter network traffic to identify the signed request:

   ```bash
   proxycli call list_network_requests --urlFilter "/api/v1/order"
   ```

2. Trace the initiator JavaScript call stack:

   ```bash
   proxycli call get_request_initiator --requestId <reqid>
   ```

3. Read the relevant source lines using the script ID and line numbers returned from the stack:

   ```bash
   proxycli call get_script_source --scriptId <scriptId> --filePath "artifacts/sources/target.js" --startLine 120 --endLine 180
   ```

4. Install a non-blocking hook on the signature generation function:

   ```bash
   proxycli call hook_function --target "window.calcSign" --hookId "sign_hook"
   ```

5. Trigger the action via DOM click and inspect captured arguments:

   ```bash
   proxycli call click --selector "button#submit"
   proxycli call get_hook_data --hookId "sign_hook"
   ```

### Scenario B: Bypass Infinite Debugger & Anti-Debug

When execution is locked by an anti-debug timer or infinite `debugger;` statement:

```bash
# 1. Neutralize debugger traps
proxycli call bypass_debugger

# 2. Prevent viewport resizing traps and timer skew
proxycli call anti_anti_debug
```

### Scenario C: Reverse-Engineer WebAssembly Encryption

1. Capture runtime Wasm compilation (supports `--captureBase64 <bool>` for inline bytecode):

   ```bash
   proxycli call collect_wasm --url "https://example.com/sec" --waitAfterLoadMs 3000
   ```

2. Dump binary to local file:

   ```bash
   proxycli call wasm_dump --moduleIndex 0 --outputPath "artifacts/wasm/core.wasm"
   ```

3. Trace JS↔Wasm boundary calls and inspect linear memory:

   ```bash
   proxycli call wasm_vmp_trace --maxEvents 100
   proxycli call wasm_memory_inspect --searchPattern "token=" --length 1024
   ```

### Scenario D: Non-Browser Traffic Interception & Rule Rewriting

When reverse-engineering desktop apps, mobile endpoints, or Node.js scripts outside the browser:

1. Start the MITM proxy on port 8888:

   ```bash
   proxycli call start_mitm_proxy --port 8888
   ```

2. Export and trust the root CA certificate:

   ```bash
   proxycli call export_mitm_ca --outputPath "artifacts/mitm_ca.crt" --format pem
   ```

3. Mock target responses or modify headers on the fly:

   ```bash
   proxycli call mitm_add_rule \
     --action '{"type":"map_local","urlRegex":"https://api\\.example\\.com/data","localPath":"artifacts/mock.json","statusCode":200}' \
     --id "rule_mock_data"
   ```

4. Filter and inspect captured requests:

   ```bash
   proxycli call list_mitm_requests --urlFilter "/data"
   proxycli call get_mitm_request --id 1
   ```

---

## 5. Offline Algorithm Rebuilding & Delivery

Once the algorithm is extracted, package and verify it locally:

1. **Record Evidence**:

   ```bash
   proxycli call record_reverse_evidence --taskId "task_01" --taskSlug "api-sign" --targetUrl "https://example.com" --goal "Extract sign" --entry '[{"name":"sign","key":"..."}]'
   ```

2. **Generate Node.js Scaffold**:

   ```bash
   proxycli call rebuild_bundle --targetUrl "https://example.com" --goal "Offline sign" --autoGenerate true
   ```

3. **Audit Environment Mismatches**:
   If the generated bundle throws missing-object errors in Node.js, diff the runtime log against browser capabilities:

   ```bash
   node skills/web-reverse-env/scripts/diff-env-requirements.js --error "ReferenceError: window is not defined"
   ```

   Add minimal mocks based on the output until local output matches browser output exactly.
