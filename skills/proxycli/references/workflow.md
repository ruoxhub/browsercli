# Workflow Helpers & Guidelines Reference

High-level reverse-engineering workflow helper for `proxycli`.

## Overview

Run an automated observe-and-collect workflow against a target page to bootstrap an investigation.

| Tool Name      | Description                                   | Key Parameters |
| -------------- | --------------------------------------------- | -------------- |
| `observe_flow` | Run automated capture workflow on target page | `--url <str>`  |

---

## Detailed Commands

### 1. observe_flow

Collect and analyze page scripts in one pass: identify crypto and obfuscation patterns and produce a risk summary. Requires `--url` or an already-selected page.

```bash
proxycli call observe_flow --url "https://example.com/login"
```
