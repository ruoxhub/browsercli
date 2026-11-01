# DevToolsActivePort Discovery and Auto-Connect Probe

When Chromium instances enable remote debugging via `chrome://inspect/#remote-debugging` (including Chromium derivatives such as `ego lite`), the browser deliberately closes HTTP `/json/*` discovery endpoints for security, causing `http://127.0.0.1:9222/json/version` requests to return HTTP 404. Previous connection implementations relied on unverified fallback to stale `DevToolsActivePort` files across a narrow set of hardcoded paths, replacing requested live ports with defunct legacy ports (such as `53687`) and locking the worker session upon failure. We decided to model remote debugging discovery after `chrome-devtools-mcp`, introducing an `--auto-connect` capability, adding `--user-data-dir` configuration support, extending discovery path candidates to modern Chromium variants (e.g. `Citro Labs/ego lite`), requiring strict TCP liveness probes (`checkPort`) before accepting any `Active Port Record`, enforcing port equality during fallback synthesis, and providing bounded connection timeouts with mutual-exclusion recovery.

## Consequences

- Invocations with `--auto-connect` or direct `browsercli browser connect` automatically detect active running Chromium and Chromium-derivative instances without manual endpoint or port entry.
- Passing `--user-data-dir` restricts discovery to the targeted profile directory, reading its `DevToolsActivePort` directly and resolving custom browser paths without guessing.
- Any candidate `DevToolsActivePort` file containing an unreachable TCP port is rejected immediately, preventing stale port records from hijacking active debugging sessions.
- When an explicit port is targeted (e.g. `--browser-url http://127.0.0.1:9222`) and the endpoint returns HTTP 404, the connection synthesizes a WebSocket endpoint using an `Active Port Record` whose listening port matches the target port exactly.
- Connection failures fail fast with bounded probe timeouts and strictly release worker locks, eliminating cascading `[WORKER_BUSY]` errors.
