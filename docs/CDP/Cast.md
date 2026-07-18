# Cast

`🧪 Experimental`

A domain for interacting with Cast, Presentation API, and Remote Playback API
functionalities.

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

### <a name="sink"></a>Sink

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |
| `id` | `string` |  |
| `session`<br/>_optional_ | `string` | Text describing the current session. Present only if there is an active<br/>session on the sink. |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

Starts observing for sinks that can be used for tab mirroring, and if set,
sinks compatible with |presentationUrl| as well. When sinks are found, a
|sinksUpdated| event is fired.
Also starts observing for issue messages. When an issue is added or removed,
an |issueUpdated| event is fired.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `presentationUrl`<br/>_optional_ | `string` |  |

* **Returns**: None


### <a name="disable"></a>disable

Stops observing for sinks and issues.

* **Parameters**: None

* **Returns**: None


### <a name="setsinktouse"></a>setSinkToUse

Sets a sink to be used when the web page requests the browser to choose a
sink via Presentation API, Remote Playback API, or Cast SDK.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sinkName` | `string` |  |

* **Returns**: None


### <a name="startdesktopmirroring"></a>startDesktopMirroring

Starts mirroring the desktop to the sink.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sinkName` | `string` |  |

* **Returns**: None


### <a name="starttabmirroring"></a>startTabMirroring

Starts mirroring the tab to the sink.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sinkName` | `string` |  |

* **Returns**: None


### <a name="stopcasting"></a>stopCasting

Stops the active Cast session on the sink.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sinkName` | `string` |  |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="sinksupdated"></a>sinksUpdated

This is fired whenever the list of available sinks changes. A sink is a
device or a software surface that you can cast to.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sinks` | array of [Sink](#sink) |  |


### <a name="issueupdated"></a>issueUpdated

This is fired whenever the outstanding issue/error message changes.
|issueMessage| is empty if there is no issue.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `issueMessage` | `string` |  |


