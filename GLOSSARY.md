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
