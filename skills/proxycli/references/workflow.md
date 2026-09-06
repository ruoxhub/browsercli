# Workflow Helpers & Guidelines Reference

Reverse-engineering process recommendation, stage criteria, and parameter workflow guidance for `proxycli`.

## Overview

High-level navigation aids and decision engines to guide complex multi-step reverse engineering investigations.

| Tool Name                      | Description                                            | Key Parameters                                                              |
| ------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `recommend_next_step`          | Suggest next analysis step based on current task state | `[--taskId <str>]`, `[--currentStage <str>]`, `[--hasTargetRequest <bool>]` |
| `explain_reverse_stage`        | Explain stage goals, entry/exit criteria, and pitfalls | `--stage <str>`, `[--includeDocs <bool>]`                                   |
| `list_parameter_workflows`     | List preconfigured parameter reverse workflows         | None                                                                        |
| `get_parameter_workflow`       | Get detailed execution steps for a specific workflow   | `--id <str>`                                                                |
| `recommend_parameter_workflow` | Recommend matching workflow for parameter description  | `--query <str>`                                                             |
| `observe_flow`                 | Run automated capture workflow on target page          | `--url <str>`                                                               |

---

## Detailed Commands

### 1. recommend_next_step

Consult the built-in reverse-engineering advisor when unsure how to proceed from observation to extraction.

```bash
proxycli call recommend_next_step \
  --taskId "task_01" \
  --currentStage "Capture" \
  --hasTargetRequest true \
  --hookRecordCount 15
```

### 2. explain_reverse_stage

Review the entry criteria, exit criteria, and anti-patterns for each reverse-engineering stage (`reconnaissance`, `interception`, `analysis`, `reconstruction`).

```bash
proxycli call explain_reverse_stage --stage "analysis" --includeDocs true
```

### 3. Parameter Reverse Workflows

Lookup proven step-by-step playbooks for standard parameter patterns (e.g. `_signature`, `token`, `encSecKey`, `captchaToken`).

```bash
# List all pre-configured parameter workflows
proxycli call list_parameter_workflows

# Recommend a workflow for a specific header/query parameter
proxycli call recommend_parameter_workflow --query "x-s-common"

# Read detailed steps for a specific workflow ID
proxycli call get_parameter_workflow --id "wf_header_token"
```
