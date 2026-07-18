# Memory

`🧪 Experimental`

* **Source**: Browser Protocol (Chromium)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="pressurelevel"></a>PressureLevel

Memory pressure level.

* **Type**: `string`
* **Allowed values**: `"moderate"`, `"critical"`

### <a name="samplingprofilenode"></a>SamplingProfileNode

Heap profile sample.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `size` | `number` | Size of the sampled allocation. |
| `total` | `number` | Total bytes attributed to this sample. |
| `stack` | array of `string` | Execution stack at the point of allocation. |


### <a name="samplingprofile"></a>SamplingProfile

Array of heap profile samples.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `samples` | array of [SamplingProfileNode](#samplingprofilenode) |  |
| `modules` | array of [Module](#module) |  |


### <a name="module"></a>Module

Executable module information

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Name of the module. |
| `uuid` | `string` | UUID of the module. |
| `baseAddress` | `string` | Base address where the module is loaded into memory. Encoded as a decimal<br/>or hexadecimal (0x prefixed) string. |
| `size` | `number` | Size of the module in bytes. |


### <a name="domcounter"></a>DOMCounter

DOM object counter data.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Object name. Note: object names should be presumed volatile and clients should not expect<br/>the returned names to be consistent across runs. |
| `count` | `integer` | Object count. |


---

<a name="commands"></a>
## Commands

### <a name="getdomcounters"></a>getDOMCounters

Retruns current DOM object counters.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `documents` | `integer` |  |
| `nodes` | `integer` |  |
| `jsEventListeners` | `integer` |  |


### <a name="getdomcountersforleakdetection"></a>getDOMCountersForLeakDetection

Retruns DOM object counters after preparing renderer for leak detection.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `counters` | array of [DOMCounter](#domcounter) | DOM object counters. |


### <a name="prepareforleakdetection"></a>prepareForLeakDetection

Prepares for leak detection by terminating workers, stopping spellcheckers,
dropping non-essential internal caches, running garbage collections, etc.

* **Parameters**: None

* **Returns**: None


### <a name="forciblypurgejavascriptmemory"></a>forciblyPurgeJavaScriptMemory

Simulate OomIntervention by purging V8 memory.

* **Parameters**: None

* **Returns**: None


### <a name="setpressurenotificationssuppressed"></a>setPressureNotificationsSuppressed

Enable/disable suppressing memory pressure notifications in all processes.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `suppressed` | `boolean` | If true, memory pressure notifications will be suppressed. |

* **Returns**: None


### <a name="simulatepressurenotification"></a>simulatePressureNotification

Simulate a memory pressure notification in all processes.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `level` | [PressureLevel](#pressurelevel) | Memory pressure level of the notification. |

* **Returns**: None


### <a name="startsampling"></a>startSampling

Start collecting native memory profile.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `samplingInterval`<br/>_optional_ | `integer` | Average number of bytes between samples. |
| `suppressRandomness`<br/>_optional_ | `boolean` | Do not randomize intervals between samples. |

* **Returns**: None


### <a name="stopsampling"></a>stopSampling

Stop collecting native memory profile.

* **Parameters**: None

* **Returns**: None


### <a name="getalltimesamplingprofile"></a>getAllTimeSamplingProfile

Retrieve native memory allocations profile
collected since renderer process startup.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `profile` | [SamplingProfile](#samplingprofile) |  |


### <a name="getbrowsersamplingprofile"></a>getBrowserSamplingProfile

Retrieve native memory allocations profile
collected since browser process startup.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `profile` | [SamplingProfile](#samplingprofile) |  |


### <a name="getsamplingprofile"></a>getSamplingProfile

Retrieve native memory allocations profile collected since last
`startSampling` call.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `profile` | [SamplingProfile](#samplingprofile) |  |


---

<a name="events"></a>
## Events

_None_

