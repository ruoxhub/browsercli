# Profiler

* **Source**: JS Protocol (V8)
* **Dependencies**: [Runtime](Runtime.md), [Debugger](Debugger.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="profilenode"></a>ProfileNode

Profile node. Holds callsite information, execution statistics and child nodes.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `integer` | Unique id of the node. |
| `callFrame` | [Runtime.CallFrame](Runtime.md#callframe) | Function location. |
| `hitCount`<br/>_optional_ | `integer` | Number of samples where this node was on top of the call stack. |
| `children`<br/>_optional_ | array of `integer` | Child node ids. |
| `deoptReason`<br/>_optional_ | `string` | The reason of being not optimized. The function may be deoptimized or marked as don't<br/>optimize. |
| `positionTicks`<br/>_optional_ | array of [PositionTickInfo](#positiontickinfo) | An array of source position ticks. |


### <a name="profile"></a>Profile

Profile.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `nodes` | array of [ProfileNode](#profilenode) | The list of profile nodes. First item is the root node. |
| `startTime` | `number` | Profiling start timestamp in microseconds. |
| `endTime` | `number` | Profiling end timestamp in microseconds. |
| `samples`<br/>_optional_ | array of `integer` | Ids of samples top nodes. |
| `timeDeltas`<br/>_optional_ | array of `integer` | Time intervals between adjacent samples in microseconds. The first delta is relative to the<br/>profile startTime. |


### <a name="positiontickinfo"></a>PositionTickInfo

Specifies a number of samples attributed to a certain source position.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `line` | `integer` | Source line number (1-based). |
| `ticks` | `integer` | Number of samples attributed to the source line. |


### <a name="coveragerange"></a>CoverageRange

Coverage data for a source range.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `startOffset` | `integer` | JavaScript script source offset for the range start. |
| `endOffset` | `integer` | JavaScript script source offset for the range end. |
| `count` | `integer` | Collected execution count of the source range. |


### <a name="functioncoverage"></a>FunctionCoverage

Coverage data for a JavaScript function.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `functionName` | `string` | JavaScript function name. |
| `ranges` | array of [CoverageRange](#coveragerange) | Source ranges inside the function with coverage data. |
| `isBlockCoverage` | `boolean` | Whether coverage data for this function has block granularity. |


### <a name="scriptcoverage"></a>ScriptCoverage

Coverage data for a JavaScript script.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | JavaScript script id. |
| `url` | `string` | JavaScript script name or url. |
| `functions` | array of [FunctionCoverage](#functioncoverage) | Functions contained in the script that has coverage data. |


---

<a name="commands"></a>
## Commands

### <a name="disable"></a>disable

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

* **Parameters**: None

* **Returns**: None


### <a name="getbesteffortcoverage"></a>getBestEffortCoverage

Collect coverage data for the current isolate. The coverage data may be incomplete due to
garbage collection.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | array of [ScriptCoverage](#scriptcoverage) | Coverage data for the current isolate. |


### <a name="setsamplinginterval"></a>setSamplingInterval

Changes CPU profiler sampling interval. Must be called before CPU profiles recording started.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `interval` | `integer` | New sampling interval in microseconds. |

* **Returns**: None


### <a name="start"></a>start

* **Parameters**: None

* **Returns**: None


### <a name="startprecisecoverage"></a>startPreciseCoverage

Enable precise code coverage. Coverage data for JavaScript executed before enabling precise code
coverage may be incomplete. Enabling prevents running optimized code and resets execution
counters.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `callCount`<br/>_optional_ | `boolean` | Collect accurate call counts beyond simple 'covered' or 'not covered'. |
| `detailed`<br/>_optional_ | `boolean` | Collect block-based coverage. |
| `allowTriggeredUpdates`<br/>_optional_ | `boolean` | Allow the backend to send updates on its own initiative |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `timestamp` | `number` | Monotonically increasing time (in seconds) when the coverage update was taken in the backend. |


### <a name="stop"></a>stop

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `profile` | [Profile](#profile) | Recorded profile. |


### <a name="stopprecisecoverage"></a>stopPreciseCoverage

Disable precise code coverage. Disabling releases unnecessary execution count records and allows
executing optimized code.

* **Parameters**: None

* **Returns**: None


### <a name="takeprecisecoverage"></a>takePreciseCoverage

Collect coverage data for the current isolate, and resets execution counters. Precise code
coverage needs to have started.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | array of [ScriptCoverage](#scriptcoverage) | Coverage data for the current isolate. |
| `timestamp` | `number` | Monotonically increasing time (in seconds) when the coverage update was taken in the backend. |


---

<a name="events"></a>
## Events

### <a name="consoleprofilefinished"></a>consoleProfileFinished

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` |  |
| `location` | [Debugger.Location](Debugger.md#location) | Location of console.profileEnd(). |
| `profile` | [Profile](#profile) |  |
| `title`<br/>_optional_ | `string` | Profile title passed as an argument to console.profile(). |


### <a name="consoleprofilestarted"></a>consoleProfileStarted

Sent when new profile recording is started using console.profile() call.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | `string` |  |
| `location` | [Debugger.Location](Debugger.md#location) | Location of console.profile(). |
| `title`<br/>_optional_ | `string` | Profile title passed as an argument to console.profile(). |


### <a name="precisecoveragedeltaupdate"></a>preciseCoverageDeltaUpdate `🧪 experimental`

Reports coverage delta since the last poll (either from an event like this, or from
`takePreciseCoverage` for the current isolate. May only be sent if precise code
coverage has been started. This event can be trigged by the embedder to, for example,
trigger collection of coverage data immediately at a certain point in time.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `timestamp` | `number` | Monotonically increasing time (in seconds) when the coverage update was taken in the backend. |
| `occasion` | `string` | Identifier for distinguishing coverage events. |
| `result` | array of [ScriptCoverage](#scriptcoverage) | Coverage data for the current isolate. |


