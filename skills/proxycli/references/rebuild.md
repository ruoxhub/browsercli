# Environment Rebuilding, Evidence & SourceMap Reference

Evidence recording, offline bundle rebuilding, environment diffing, and SourceMap recovery for `proxycli`.

## Overview

Reconstruct offline Node.js execution bundles from reverse-engineered algorithms, audit browser environment gaps, and restore original TypeScript/ES6 source trees using SourceMaps.

| Tool Name                    | Description                                            | Key Parameters                                                                |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `record_reverse_evidence`    | Append structured evidence to task audit log           | `--taskId <str>`, `--targetUrl <str>`, `--goal <str>`, `--entry <arr>`        |
| `rebuild_bundle`             | Generate local Node.js environment emulation bundle    | `[--targetUrl <str>]`, `[--targetFunctionNames <arr>]`, `[--goal <str>]`      |
| `export_rebuild_bundle`      | Export complete Node algorithm reconstruction package  | `--taskId <str>`, `--targetUrl <str>`, `--entryCode <str>`, `--envCode <str>` |
| `diff_env_requirements`      | Compare runtime errors with browser capabilities       | `--runtimeError <str>`, `[--observedCapabilities <arr>]`                      |
| `trace_signature_generation` | Trace request-to-code signature generation pipeline    | `[--requestUrlPattern <str>]`, `[--headerKeyword <str>]`                      |
| `sourcemap_discover`         | Find SourceMap URLs and references from loaded scripts | `[--scriptId <str>]`, `[--urlPattern <str>]`                                  |
| `sourcemap_parse`            | Parse SourceMap content into lookup handle             | `[--scriptId <str>]`, `[--mapUrl <str>]`, `[--mapContent <str>]`              |
| `sourcemap_lookup`           | Map coordinates between minified and original source   | `--mapId <str>`, `--direction <str>`, `--line <num>`, `--column <num>`        |
| `sourcemap_reconstruct_tree` | Reconstruct original source files to disk directory    | `--mapId <str>`, `[--outputDir <str>]`, `[--overwrite <bool>]`                |
| `sourcemap_diff`             | Diff source structures across two SourceMaps           | `--leftMapId <str>`, `--rightMapId <str>`                                     |

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

### 2. rebuild_bundle & export_rebuild_bundle

Generate an offline Node.js execution environment bundle with necessary polyfills and mocks (`window`, `document`, `navigator`).

```bash
# Auto-generate offline bundle structure from collected evidence
proxycli call rebuild_bundle \
  --targetUrl "https://example.com" \
  --goal "Offline sign calculation" \
  --autoGenerate true

# Export bundled solution
proxycli call export_rebuild_bundle \
  --taskId "task_demo_01" \
  --taskSlug "demo-sign" \
  --targetUrl "https://example.com" \
  --goal "Extract sign" \
  --entryCode "module.exports = function sign(data){...};" \
  --envCode "global.window = global;"
```

### 3. diff_env_requirements

When the extracted algorithm fails in Node.js with errors like `ReferenceError: document is not defined` or `TypeError: Cannot read properties of undefined`, diff with browser capabilities to suggest environment patches.

```bash
proxycli call diff_env_requirements --runtimeError "ReferenceError: navigator is not defined"
```

### 4. trace_signature_generation

Correlate HTTP requests, active hooks, and stack frames to reconstruct the complete signature generation chain from user action to network dispatch.

```bash
proxycli call trace_signature_generation --requestUrlPattern "/api/trade" --headerKeyword "X-Signature"
```

### 5. SourceMap Discovery & Tree Reconstruction

If target scripts contain `sourceMappingURL` comments, use these tools to recover the full original unminified source code.

```bash
# 1. Discover SourceMap handle
proxycli call sourcemap_discover --urlPattern "app.js"

# 2. Parse SourceMap (scriptId, mapUrl, or mapContent)
proxycli call sourcemap_parse --mapUrl "https://example.com/static/js/app.js.map"

# 3. Lookup source mapping coordinate (minified -> original)
proxycli call sourcemap_lookup --mapId "sm_01" --direction "generated_to_original" --line 1 --column 45892

# 4. Reconstruct entire original project source tree to local folder
proxycli call sourcemap_reconstruct_tree --mapId "sm_01" --outputDir "artifacts/sourcemap_reconstruction/" --overwrite true
```
