# Tracing

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [IO](IO.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="memorydumpconfig"></a>MemoryDumpConfig `🧪 experimental`

Configuration for memory dump. Used only when "memory-infra" category is enabled.

* **Type**: `object`

### <a name="traceconfig"></a>TraceConfig

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `recordMode`<br/>_optional_ | `string` | `🧪 experimental` Controls how the trace buffer stores data. The default is `recordUntilFull`.<br/>Allowed values: `"recordUntilFull"`, `"recordContinuously"`, `"recordAsMuchAsPossible"`, `"echoToConsole"` |
| `traceBufferSizeInKb`<br/>_optional_ | `number` | `🧪 experimental` Size of the trace buffer in kilobytes. If not specified or zero is passed, a default value<br/>of 200 MB would be used. |
| `enableSampling`<br/>_optional_ | `boolean` | `🧪 experimental` Turns on JavaScript stack sampling. |
| `enableSystrace`<br/>_optional_ | `boolean` | `🧪 experimental` Turns on system tracing. |
| `enableArgumentFilter`<br/>_optional_ | `boolean` | `🧪 experimental` Turns on argument filter. |
| `includedCategories`<br/>_optional_ | array of `string` | Included category filters. |
| `excludedCategories`<br/>_optional_ | array of `string` | Excluded category filters. |
| `syntheticDelays`<br/>_optional_ | array of `string` | `🧪 experimental` Configuration to synthesize the delays in tracing. |
| `memoryDumpConfig`<br/>_optional_ | [MemoryDumpConfig](#memorydumpconfig) | `🧪 experimental` Configuration for memory dump triggers. Used only when "memory-infra" category is enabled. |


### <a name="streamformat"></a>StreamFormat `🧪 experimental`

Data format of a trace. Can be either the legacy JSON format or the
protocol buffer format. Note that the JSON format will be deprecated soon.

* **Type**: `string`
* **Allowed values**: `"json"`, `"proto"`

### <a name="streamcompression"></a>StreamCompression `🧪 experimental`

Compression type to use for traces returned via streams.

* **Type**: `string`
* **Allowed values**: `"none"`, `"gzip"`

### <a name="memorydumplevelofdetail"></a>MemoryDumpLevelOfDetail `🧪 experimental`

Details exposed when memory request explicitly declared.
Keep consistent with memory_dump_request_args.h and
memory_instrumentation.mojom

* **Type**: `string`
* **Allowed values**: `"background"`, `"light"`, `"detailed"`

### <a name="tracingbackend"></a>TracingBackend `🧪 experimental`

Backend type to use for tracing. `chrome` uses the Chrome-integrated
tracing service and is supported on all platforms. `system` is only
supported on Chrome OS and uses the Perfetto system tracing service.
`auto` chooses `system` when the perfettoConfig provided to Tracing.start
specifies at least one non-Chrome data source; otherwise uses `chrome`.

* **Type**: `string`
* **Allowed values**: `"auto"`, `"chrome"`, `"system"`

---

<a name="commands"></a>
## Commands

### <a name="end"></a>end

Stop trace events collection.

* **Parameters**: None

* **Returns**: None


### <a name="getcategories"></a>getCategories `🧪 experimental`

Gets supported tracing categories.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `categories` | array of `string` | A list of supported tracing categories. |


### <a name="gettrackeventdescriptor"></a>getTrackEventDescriptor `🧪 experimental`

Return a descriptor for all available tracing categories.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `descriptor` | `string` | Base64-encoded serialized perfetto.protos.TrackEventDescriptor protobuf message. (Encoded as a base64 string when passed over JSON) |


### <a name="recordclocksyncmarker"></a>recordClockSyncMarker `🧪 experimental`

Record a clock sync marker in the trace.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `syncId` | `string` | The ID of this clock sync marker |

* **Returns**: None


### <a name="requestmemorydump"></a>requestMemoryDump `🧪 experimental`

Request a global memory dump.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `deterministic`<br/>_optional_ | `boolean` | Enables more deterministic results by forcing garbage collection |
| `levelOfDetail`<br/>_optional_ | [MemoryDumpLevelOfDetail](#memorydumplevelofdetail) | Specifies level of details in memory dump. Defaults to "detailed". |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `dumpGuid` | `string` | GUID of the resulting global memory dump. |
| `success` | `boolean` | True iff the global memory dump succeeded. |


### <a name="start"></a>start

Start trace events collection.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `categories`<br/>_optional_ | `string` | `🧪 experimental` `⚠️ deprecated` Category/tag filter |
| `options`<br/>_optional_ | `string` | `🧪 experimental` `⚠️ deprecated` Tracing options |
| `bufferUsageReportingInterval`<br/>_optional_ | `number` | `🧪 experimental` If set, the agent will issue bufferUsage events at this interval, specified in milliseconds |
| `transferMode`<br/>_optional_ | `string` | Whether to report trace events as series of dataCollected events or to save trace to a<br/>stream (defaults to `ReportEvents`).<br/>Allowed values: `"ReportEvents"`, `"ReturnAsStream"` |
| `streamFormat`<br/>_optional_ | [StreamFormat](#streamformat) | Trace data format to use. This only applies when using `ReturnAsStream`<br/>transfer mode (defaults to `json`). |
| `streamCompression`<br/>_optional_ | [StreamCompression](#streamcompression) | `🧪 experimental` Compression format to use. This only applies when using `ReturnAsStream`<br/>transfer mode (defaults to `none`) |
| `traceConfig`<br/>_optional_ | [TraceConfig](#traceconfig) |  |
| `perfettoConfig`<br/>_optional_ | `string` | `🧪 experimental` Base64-encoded serialized perfetto.protos.TraceConfig protobuf message<br/>When specified, the parameters `categories`, `options`, `traceConfig`<br/>are ignored. (Encoded as a base64 string when passed over JSON) |
| `tracingBackend`<br/>_optional_ | [TracingBackend](#tracingbackend) | `🧪 experimental` Backend type (defaults to `auto`) |
| `screenshotMaxSize`<br/>_optional_ | `integer` | `🧪 experimental` Maximum width and height (in pixels) of each captured screenshot.<br/>Only used when the `disabled-by-default-devtools.screenshot` category is<br/>enabled. Defaults to 500. The combined memory footprint of screenshots<br/>(`screenshotMaxSize` * `screenshotMaxSize` * 4 * `screenshotMaxCount`)<br/>is clamped to the existing per-session budget. |
| `screenshotMaxCount`<br/>_optional_ | `integer` | `🧪 experimental` Maximum number of screenshots captured during a single tracing session.<br/>Only used when the `disabled-by-default-devtools.screenshot` category is<br/>enabled. Defaults to 450. Clamped together with `screenshotMaxSize` to<br/>stay within the per-session screenshot memory budget. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="bufferusage"></a>bufferUsage `🧪 experimental`

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `percentFull`<br/>_optional_ | `number` | A number in range [0..1] that indicates the used size of event buffer as a fraction of its<br/>total size. |
| `eventCount`<br/>_optional_ | `number` | An approximate number of events in the trace log. |
| `value`<br/>_optional_ | `number` | A number in range [0..1] that indicates the used size of event buffer as a fraction of its<br/>total size. |


### <a name="datacollected"></a>dataCollected `🧪 experimental`

Contains a bucket of collected trace events. When tracing is stopped collected events will be
sent as a sequence of dataCollected events followed by tracingComplete event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `value` | array of `object` |  |


### <a name="tracingcomplete"></a>tracingComplete

Signals that tracing is stopped and there is no trace buffers pending flush, all data were
delivered via dataCollected events.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `dataLossOccurred` | `boolean` | Indicates whether some trace data is known to have been lost, e.g. because the trace ring<br/>buffer wrapped around. |
| `stream`<br/>_optional_ | [IO.StreamHandle](IO.md#streamhandle) | A handle of the stream that holds resulting trace data. |
| `traceFormat`<br/>_optional_ | [StreamFormat](#streamformat) | Trace data format of returned stream. |
| `streamCompression`<br/>_optional_ | [StreamCompression](#streamcompression) | Compression format of returned stream. |


