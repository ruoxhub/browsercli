# Browser-CLI Core Domain

Browser-CLI provides browser automation, dynamic reverse engineering, network inspection, and debugging capabilities over the Chrome DevTools Protocol and Patchright.

## Language

**Navigation Bucket**:
A discrete, chronological container of network requests and traffic events recorded during a single page navigation lifecycle.
_Avoid_: Request group, page history segment, navigation log, request pool

**Request Initiator**:
The origin declaration and immediate call stack describing why and where the browser dispatched a network request or opened a connection.
_Avoid_: Caller stack, request origin, trigger source, stack trace parent

**Operation Evidence**:
The aggregated causal record linking a specific user or agent input action (such as click, press, or submit) with network requests, console messages, and local DOM state mutations triggered within its immediate observation window.
_Avoid_: Action trace, click-request mapping, interaction log, event linkage

**Structured Extraction**:
The passive extraction capability that traverses Document Object Model or ARIA grid hierarchies, normalizes two-dimensional cell spans (rowspan/colspan) and nested header paths into canonical rows and columns, and optionally serializes them directly to CSV or JSON.
_Avoid_: Table scraper, DOM table dumper, grid parser

**Browser Connection Target**:
The resolved remote endpoint (`browserUrl` or `wsEndpoint`) or local binary selection (`channel` or `executablePath`) directing how Browser-CLI attaches to or launches a browser instance.
_Avoid_: Browser endpoint, connection URI, attach target, launch mode target

**Connection Fallback**:
The resolution cascade that sources browser connection options across CLI flags, environment variables, user configuration (`~/.browsercli/config.json`), and system defaults in strict precedence order.
_Avoid_: Config cascade, default connection lookup, fallback resolver

**Active Port Record**:
A validated, TCP-reachable browser debugging descriptor parsed directly from a user data directory's `DevToolsActivePort` file, specifying the active listening port and DevTools WebSocket path.
_Avoid_: Debug port file entry, port record, DevTools port snapshot, active port entry

**Auto-Connect Probe**:
The automatic discovery mechanism that locates and attaches to an active, running Chromium instance via its `Active Port Record` (specifically for `chrome://inspect/#remote-debugging` mode where HTTP discovery endpoints return 404), bypassing explicit host and port specification.
_Avoid_: Automatic debugger scan, background browser hook, port sniffer, auto-attacher

**Tool**:
A single capability exposed to callers through the daemon's `tool.invoke` IPC request, defined via `defineTool()` with a name, description, Zod schema, category annotation, and handler. Tools are invoked as `browsercli call <tool_name>`; they are not CLI subcommands and carry no shell-level flag surface of their own.
_Avoid_: Command, CLI command, endpoint, API route

**Daemon Session**:
A detached worker process bound to one workspace directory and identified by a workspace hash in the session registry. A session owns exactly one IPC socket, may host zero or more browser connections, and is discovered, spawned, and managed on demand by the `browsercli` client through the standard lifecycle commands (`start`, `stop`, `status`).
_Avoid_: Workspace, server instance, background job, worker thread

**Lifecycle Commands**:
The triad of CLI commands (`start`, `stop`, `status`) modeled after `chrome-devtools` for managing daemon sessions and inspecting browser connections.
_Avoid_: Session commands, daemon controls, process managers
