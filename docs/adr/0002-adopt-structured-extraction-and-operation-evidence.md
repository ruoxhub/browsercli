# Adopt Structured Extraction and Operation Evidence

To resolve the dual pain points of massive token consumption when analyzing web tabular data and ambiguous cause-and-effect correlation between user/agent interactions and outbound encrypted traffic, we decided to activate `ToolCategory.DATA` with isolated-world structured table extraction and introduce opt-in operation evidence tracing. Tabular geometry, nested header hierarchies, and rowspan/colspan merging are computed inside a lightweight CDP isolated-world script utilizing native browser layout primitives and exported directly to CSV or JSON by Node.js, while operation-network-console causal linking is implemented as an explicit opt-in diagnostic session (`start_operation_trace`/`stop_operation_trace`) rather than an eager continuous observer, strictly preserving our zero-unsolicited-injection stealth posture and minimal CDP footprint. In addition, an atomic composite input tool (`perform_action_and_wait`) in `ToolCategory.INPUT` collapses the common interact-and-wait loop into a single RPC without bloating into an open-ended script engine.

## Consequences

- Large table extraction across complex layouts, ARIA grids, and out-of-process frames returns deterministic, token-efficient CSV or structured JSON deliverables without requiring LLMs to parse voluminous raw DOM snapshots.
- Operation evidence can pinpoint the exact network requests and console errors triggered by a specific button click or form submission within a bounded causal window, dramatically accelerating API signature localization during reverse engineering.
- The stealth profile of browser-cli remains intact because no persistent input or MutationObserver probes are injected on the default navigation and browsing path.
- Agent turn latencies decrease on interactive workflows by combining single actions with post-action wait criteria in `perform_action_and_wait`.
