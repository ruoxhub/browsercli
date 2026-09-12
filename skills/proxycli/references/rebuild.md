# Environment Rebuilding & Evidence Reference

Evidence recording and offline bundle rebuilding for `proxycli`.

## Overview

Reconstruct offline Node.js execution bundles from reverse-engineered algorithms and persist verifiable evidence to task artifacts.

| Tool Name                    | Description                                         | Key Parameters                                                           |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| `record_reverse_evidence`    | Append structured evidence to task audit log        | `--taskId <str>`, `--targetUrl <str>`, `--goal <str>`, `--entry <arr>`   |
| `rebuild_bundle`             | Generate local Node.js environment emulation bundle | `[--targetUrl <str>]`, `[--targetFunctionNames <arr>]`, `[--goal <str>]` |
| `trace_signature_generation` | Trace request-to-code signature generation pipeline | `[--requestUrlPattern <str>]`, `[--headerKeyword <str>]`                 |

---

## Detailed Commands

### 1. record_reverse_evidence

Persist verifiable evidence (functions, encryption keys, sample inputs/outputs) to the task artifacts directory.

```bash
proxycli call record_reverse_evidence \
  --taskId "task_demo_01" \
  --taskSlug "demo-sign" \
  --targetUrl "https://example.com/api" \
  --goal "Extract sign algorithm" \
  --entry '[{"type":"function","name":"window.getSign","evidence":"md5(salt+timestamp)"}]'
```

### 2. rebuild_bundle

Generate an offline Node.js execution environment bundle with necessary polyfills and mocks (`window`, `document`, `navigator`).

```bash
# Auto-generate offline bundle structure from collected evidence
proxycli call rebuild_bundle \
  --targetUrl "https://example.com" \
  --goal "Offline sign calculation" \
  --autoGenerate true
```

### 3. trace_signature_generation

Correlate HTTP requests, active hooks, and stack frames to reconstruct the complete signature generation chain from user action to network dispatch.

```bash
proxycli call trace_signature_generation --requestUrlPattern "/api/trade" --headerKeyword "X-Signature"
```
