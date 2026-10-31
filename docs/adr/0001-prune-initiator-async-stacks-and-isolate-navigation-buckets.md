# Prune Initiator Async Stacks and Isolate Navigation Buckets

CDP network and WebSocket event streams attach up to 32 levels of asynchronous parent call frames to request initiators, causing memory to balloon by hundreds of megabytes during sustained traffic capture, while navigations without network requests (such as back/forward cache restores or blank targets) previously caused the preceding navigation's requests to be erroneously claimed by the new bucket. We decided to unconditionally delete `initiator.stack.parent` at collector ingestion time and track the most recently claimed navigation request per page with a WeakMap, ensuring empty buckets for navigations without requests while dropping over 80% of retained memory with zero tool-level data loss.

## Consequences

- Long-running network monitoring sessions and reverse engineering pipelines maintain a flat, predictable heap profile because only synchronous call frames (`callFrames`) are preserved.
- Navigations that commit without an HTTP document request (e.g., `about:blank`, history traversal from cache) cleanly start an empty navigation bucket instead of leaking prior page traffic into the current active view.
- Tools requesting initiator traces (`get_request_initiator`, WebSocket inspect) continue to receive exact trigger frames without regression, as no downstream consumers inspect `stack.parent`.
