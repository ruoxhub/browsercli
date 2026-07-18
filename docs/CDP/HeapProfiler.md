# HeapProfiler

`🧪 Experimental`

* **Source**: JS Protocol (V8)
* **Dependencies**: [Runtime](Runtime.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="heapsnapshotobjectid"></a>HeapSnapshotObjectId

Heap snapshot object id.

* **Type**: `string`

### <a name="samplingheapprofilenode"></a>SamplingHeapProfileNode

Sampling Heap Profile node. Holds callsite information, allocation statistics and child nodes.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `callFrame` | [Runtime.CallFrame](Runtime.md#callframe) | Function location. |
| `selfSize` | `number` | Allocations size in bytes for the node excluding children. |
| `id` | `integer` | Node id. Ids are unique across all profiles collected between startSampling and stopSampling. |
| `children` | array of [SamplingHeapProfileNode](#samplingheapprofilenode) | Child nodes. |


### <a name="samplingheapprofilesample"></a>SamplingHeapProfileSample

A single sample from a sampling profile.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `size` | `number` | Allocation size in bytes attributed to the sample. |
| `nodeId` | `integer` | Id of the corresponding profile tree node. |
| `ordinal` | `number` | Time-ordered sample ordinal number. It is unique across all profiles retrieved<br/>between startSampling and stopSampling. |


### <a name="samplingheapprofile"></a>SamplingHeapProfile

Sampling profile.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `head` | [SamplingHeapProfileNode](#samplingheapprofilenode) |  |
| `samples` | array of [SamplingHeapProfileSample](#samplingheapprofilesample) |  |


---

<a name="commands"></a>
## Commands

### <a name="addinspectedheapobject"></a>addInspectedHeapObject

Enables console to refer to the node with given id via $x (see Command Line API for more details
$x functions).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `heapObjectId` | [HeapSnapshotObjectId](#heapsnapshotobjectid) | Heap snapshot object id to be accessible by means of $x command line API. |

* **Returns**: None


### <a name="collectgarbage"></a>collectGarbage

* **Parameters**: None

* **Returns**: None


### <a name="disable"></a>disable

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

* **Parameters**: None

* **Returns**: None


### <a name="getheapobjectid"></a>getHeapObjectId

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `objectId` | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | Identifier of the object to get heap object id for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `heapSnapshotObjectId` | [HeapSnapshotObjectId](#heapsnapshotobjectid) | Id of the heap snapshot object corresponding to the passed remote object id. |


### <a name="getobjectbyheapobjectid"></a>getObjectByHeapObjectId

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `objectId` | [HeapSnapshotObjectId](#heapsnapshotobjectid) |  |
| `objectGroup`<br/>_optional_ | `string` | Symbolic group name that can be used to release multiple objects. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | [Runtime.RemoteObject](Runtime.md#remoteobject) | Evaluation result. |


### <a name="getsamplingprofile"></a>getSamplingProfile

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `profile` | [SamplingHeapProfile](#samplingheapprofile) | Return the sampling profile being collected. |


### <a name="startsampling"></a>startSampling

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `samplingInterval`<br/>_optional_ | `number` | Average sample interval in bytes. Poisson distribution is used for the intervals. The<br/>default value is 32768 bytes. |
| `stackDepth`<br/>_optional_ | `number` | Maximum stack depth. The default value is 128. |
| `includeObjectsCollectedByMajorGC`<br/>_optional_ | `boolean` | By default, the sampling heap profiler reports only objects which are<br/>still alive when the profile is returned via getSamplingProfile or<br/>stopSampling, which is useful for determining what functions contribute<br/>the most to steady-state memory usage. This flag instructs the sampling<br/>heap profiler to also include information about objects discarded by<br/>major GC, which will show which functions cause large temporary memory<br/>usage or long GC pauses. |
| `includeObjectsCollectedByMinorGC`<br/>_optional_ | `boolean` | By default, the sampling heap profiler reports only objects which are<br/>still alive when the profile is returned via getSamplingProfile or<br/>stopSampling, which is useful for determining what functions contribute<br/>the most to steady-state memory usage. This flag instructs the sampling<br/>heap profiler to also include information about objects discarded by<br/>minor GC, which is useful when tuning a latency-sensitive application<br/>for minimal GC activity. |

* **Returns**: None


### <a name="starttrackingheapobjects"></a>startTrackingHeapObjects

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `trackAllocations`<br/>_optional_ | `boolean` |  |

* **Returns**: None


### <a name="stopsampling"></a>stopSampling

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `profile` | [SamplingHeapProfile](#samplingheapprofile) | Recorded sampling heap profile. |


### <a name="stoptrackingheapobjects"></a>stopTrackingHeapObjects

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `reportProgress`<br/>_optional_ | `boolean` | If true 'reportHeapSnapshotProgress' events will be generated while snapshot is being taken<br/>when the tracking is stopped. |
| `treatGlobalObjectsAsRoots`<br/>_optional_ | `boolean` | `⚠️ deprecated` Deprecated in favor of `exposeInternals`. |
| `captureNumericValue`<br/>_optional_ | `boolean` | If true, numerical values are included in the snapshot |
| `exposeInternals`<br/>_optional_ | `boolean` | `🧪 experimental` If true, exposes internals of the snapshot. |

* **Returns**: None


### <a name="takeheapsnapshot"></a>takeHeapSnapshot

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `reportProgress`<br/>_optional_ | `boolean` | If true 'reportHeapSnapshotProgress' events will be generated while snapshot is being taken. |
| `treatGlobalObjectsAsRoots`<br/>_optional_ | `boolean` | `⚠️ deprecated` If true, a raw snapshot without artificial roots will be generated.<br/>Deprecated in favor of `exposeInternals`. |
| `captureNumericValue`<br/>_optional_ | `boolean` | If true, numerical values are included in the snapshot |
| `exposeInternals`<br/>_optional_ | `boolean` | `🧪 experimental` If true, exposes internals of the snapshot. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="addheapsnapshotchunk"></a>addHeapSnapshotChunk

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `chunk` | `string` |  |


### <a name="heapstatsupdate"></a>heapStatsUpdate

If heap objects tracking has been started then backend may send update for one or more fragments

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `statsUpdate` | array of `integer` | An array of triplets. Each triplet describes a fragment. The first integer is the fragment<br/>index, the second integer is a total count of objects for the fragment, the third integer is<br/>a total size of the objects for the fragment. |


### <a name="lastseenobjectid"></a>lastSeenObjectId

If heap objects tracking has been started then backend regularly sends a current value for last
seen object id and corresponding timestamp. If the were changes in the heap since last event
then one or more heapStatsUpdate events will be sent before a new lastSeenObjectId event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `lastSeenObjectId` | `integer` |  |
| `timestamp` | `number` |  |


### <a name="reportheapsnapshotprogress"></a>reportHeapSnapshotProgress

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `done` | `integer` |  |
| `total` | `integer` |  |
| `finished`<br/>_optional_ | `boolean` |  |


### <a name="resetprofiles"></a>resetProfiles

* **Parameters**: None


