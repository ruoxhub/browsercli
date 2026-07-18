# WebAudio

`🧪 Experimental`

This domain allows inspection of Web Audio API.
https://webaudio.github.io/web-audio-api/

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

### <a name="graphobjectid"></a>GraphObjectId

An unique ID for a graph object (AudioContext, AudioNode, AudioParam) in Web Audio API

* **Type**: `string`

### <a name="contexttype"></a>ContextType

Enum of BaseAudioContext types

* **Type**: `string`
* **Allowed values**: `"realtime"`, `"offline"`

### <a name="contextstate"></a>ContextState

Enum of AudioContextState from the spec

* **Type**: `string`
* **Allowed values**: `"suspended"`, `"running"`, `"closed"`, `"interrupted"`

### <a name="nodetype"></a>NodeType

Enum of AudioNode types

* **Type**: `string`

### <a name="channelcountmode"></a>ChannelCountMode

Enum of AudioNode::ChannelCountMode from the spec

* **Type**: `string`
* **Allowed values**: `"clamped-max"`, `"explicit"`, `"max"`

### <a name="channelinterpretation"></a>ChannelInterpretation

Enum of AudioNode::ChannelInterpretation from the spec

* **Type**: `string`
* **Allowed values**: `"discrete"`, `"speakers"`

### <a name="paramtype"></a>ParamType

Enum of AudioParam types

* **Type**: `string`

### <a name="automationrate"></a>AutomationRate

Enum of AudioParam::AutomationRate from the spec

* **Type**: `string`
* **Allowed values**: `"a-rate"`, `"k-rate"`

### <a name="contextrealtimedata"></a>ContextRealtimeData

Fields in AudioContext that change in real-time.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `currentTime` | `number` | The current context time in second in BaseAudioContext. |
| `renderCapacity` | `number` | The time spent on rendering graph divided by render quantum duration,<br/>and multiplied by 100. 100 means the audio renderer reached the full<br/>capacity and glitch may occur. |
| `callbackIntervalMean` | `number` | A running mean of callback interval. |
| `callbackIntervalVariance` | `number` | A running variance of callback interval. |


### <a name="baseaudiocontext"></a>BaseAudioContext

Protocol object for BaseAudioContext

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `contextId` | [GraphObjectId](#graphobjectid) |  |
| `contextType` | [ContextType](#contexttype) |  |
| `contextState` | [ContextState](#contextstate) |  |
| `realtimeData`<br/>_optional_ | [ContextRealtimeData](#contextrealtimedata) |  |
| `callbackBufferSize` | `number` | Platform-dependent callback buffer size. |
| `maxOutputChannelCount` | `number` | Number of output channels supported by audio hardware in use. |
| `sampleRate` | `number` | Context sample rate. |


### <a name="audiolistener"></a>AudioListener

Protocol object for AudioListener

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `listenerId` | [GraphObjectId](#graphobjectid) |  |
| `contextId` | [GraphObjectId](#graphobjectid) |  |


### <a name="audionode"></a>AudioNode

Protocol object for AudioNode

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [GraphObjectId](#graphobjectid) |  |
| `contextId` | [GraphObjectId](#graphobjectid) |  |
| `nodeType` | [NodeType](#nodetype) |  |
| `numberOfInputs` | `number` |  |
| `numberOfOutputs` | `number` |  |
| `channelCount` | `number` |  |
| `channelCountMode` | [ChannelCountMode](#channelcountmode) |  |
| `channelInterpretation` | [ChannelInterpretation](#channelinterpretation) |  |


### <a name="audioparam"></a>AudioParam

Protocol object for AudioParam

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `paramId` | [GraphObjectId](#graphobjectid) |  |
| `nodeId` | [GraphObjectId](#graphobjectid) |  |
| `contextId` | [GraphObjectId](#graphobjectid) |  |
| `paramType` | [ParamType](#paramtype) |  |
| `rate` | [AutomationRate](#automationrate) |  |
| `defaultValue` | `number` |  |
| `minValue` | `number` |  |
| `maxValue` | `number` |  |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

Enables the WebAudio domain and starts sending context lifetime events.

* **Parameters**: None

* **Returns**: None


### <a name="disable"></a>disable

Disables the WebAudio domain.

* **Parameters**: None

* **Returns**: None


### <a name="getrealtimedata"></a>getRealtimeData

Fetch the realtime data from the registered contexts.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `contextId` | [GraphObjectId](#graphobjectid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `realtimeData` | [ContextRealtimeData](#contextrealtimedata) |  |


---

<a name="events"></a>
## Events

### <a name="contextcreated"></a>contextCreated

Notifies that a new BaseAudioContext has been created.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `context` | [BaseAudioContext](#baseaudiocontext) |  |


### <a name="contextwillbedestroyed"></a>contextWillBeDestroyed

Notifies that an existing BaseAudioContext will be destroyed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `contextId` | [GraphObjectId](#graphobjectid) |  |


### <a name="contextchanged"></a>contextChanged

Notifies that existing BaseAudioContext has changed some properties (id stays the same)..

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `context` | [BaseAudioContext](#baseaudiocontext) |  |


### <a name="audiolistenercreated"></a>audioListenerCreated

Notifies that the construction of an AudioListener has finished.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `listener` | [AudioListener](#audiolistener) |  |


### <a name="audiolistenerwillbedestroyed"></a>audioListenerWillBeDestroyed

Notifies that a new AudioListener has been created.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `contextId` | [GraphObjectId](#graphobjectid) |  |
| `listenerId` | [GraphObjectId](#graphobjectid) |  |


### <a name="audionodecreated"></a>audioNodeCreated

Notifies that a new AudioNode has been created.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `node` | [AudioNode](#audionode) |  |


### <a name="audionodewillbedestroyed"></a>audioNodeWillBeDestroyed

Notifies that an existing AudioNode has been destroyed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `contextId` | [GraphObjectId](#graphobjectid) |  |
| `nodeId` | [GraphObjectId](#graphobjectid) |  |


### <a name="audioparamcreated"></a>audioParamCreated

Notifies that a new AudioParam has been created.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `param` | [AudioParam](#audioparam) |  |


### <a name="audioparamwillbedestroyed"></a>audioParamWillBeDestroyed

Notifies that an existing AudioParam has been destroyed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `contextId` | [GraphObjectId](#graphobjectid) |  |
| `nodeId` | [GraphObjectId](#graphobjectid) |  |
| `paramId` | [GraphObjectId](#graphobjectid) |  |


### <a name="nodesconnected"></a>nodesConnected

Notifies that two AudioNodes are connected.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `contextId` | [GraphObjectId](#graphobjectid) |  |
| `sourceId` | [GraphObjectId](#graphobjectid) |  |
| `destinationId` | [GraphObjectId](#graphobjectid) |  |
| `sourceOutputIndex`<br/>_optional_ | `number` |  |
| `destinationInputIndex`<br/>_optional_ | `number` |  |


### <a name="nodesdisconnected"></a>nodesDisconnected

Notifies that AudioNodes are disconnected. The destination can be null, and it means all the outgoing connections from the source are disconnected.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `contextId` | [GraphObjectId](#graphobjectid) |  |
| `sourceId` | [GraphObjectId](#graphobjectid) |  |
| `destinationId` | [GraphObjectId](#graphobjectid) |  |
| `sourceOutputIndex`<br/>_optional_ | `number` |  |
| `destinationInputIndex`<br/>_optional_ | `number` |  |


### <a name="nodeparamconnected"></a>nodeParamConnected

Notifies that an AudioNode is connected to an AudioParam.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `contextId` | [GraphObjectId](#graphobjectid) |  |
| `sourceId` | [GraphObjectId](#graphobjectid) |  |
| `destinationId` | [GraphObjectId](#graphobjectid) |  |
| `sourceOutputIndex`<br/>_optional_ | `number` |  |


### <a name="nodeparamdisconnected"></a>nodeParamDisconnected

Notifies that an AudioNode is disconnected to an AudioParam.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `contextId` | [GraphObjectId](#graphobjectid) |  |
| `sourceId` | [GraphObjectId](#graphobjectid) |  |
| `destinationId` | [GraphObjectId](#graphobjectid) |  |
| `sourceOutputIndex`<br/>_optional_ | `number` |  |


