# PerformanceTimeline

`🧪 Experimental`

Reporting of performance timeline events, as specified in
https://w3c.github.io/performance-timeline/#dom-performanceobserver.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [DOM](DOM.md), [Network](Network.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="largestcontentfulpaint"></a>LargestContentfulPaint

See https://github.com/WICG/LargestContentfulPaint and largest_contentful_paint.idl

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `renderTime` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) |  |
| `loadTime` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) |  |
| `size` | `number` | The number of pixels being painted. |
| `elementId`<br/>_optional_ | `string` | The id attribute of the element, if available. |
| `url`<br/>_optional_ | `string` | The URL of the image (may be trimmed). |
| `nodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) |  |


### <a name="layoutshiftattribution"></a>LayoutShiftAttribution

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `previousRect` | [DOM.Rect](DOM.md#rect) |  |
| `currentRect` | [DOM.Rect](DOM.md#rect) |  |
| `nodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) |  |


### <a name="layoutshift"></a>LayoutShift

See https://wicg.github.io/layout-instability/#sec-layout-shift and layout_shift.idl

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `value` | `number` | Score increment produced by this event. |
| `hadRecentInput` | `boolean` |  |
| `lastInputTime` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) |  |
| `sources` | array of [LayoutShiftAttribution](#layoutshiftattribution) |  |


### <a name="timelineevent"></a>TimelineEvent

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [Page.FrameId](Page.md#frameid) | Identifies the frame that this event is related to. Empty for non-frame targets. |
| `type` | `string` | The event type, as specified in https://w3c.github.io/performance-timeline/#dom-performanceentry-entrytype<br/>This determines which of the optional "details" fields is present. |
| `name` | `string` | Name may be empty depending on the type. |
| `time` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | Time in seconds since Epoch, monotonically increasing within document lifetime. |
| `duration`<br/>_optional_ | `number` | Event duration, if applicable. |
| `lcpDetails`<br/>_optional_ | [LargestContentfulPaint](#largestcontentfulpaint) |  |
| `layoutShiftDetails`<br/>_optional_ | [LayoutShift](#layoutshift) |  |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

Previously buffered events would be reported before method returns.
See also: timelineEventAdded

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventTypes` | array of `string` | The types of event to report, as specified in<br/>https://w3c.github.io/performance-timeline/#dom-performanceentry-entrytype<br/>The specified filter overrides any previous filters, passing empty<br/>filter disables recording.<br/>Note that not all types exposed to the web platform are currently supported. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="timelineeventadded"></a>timelineEventAdded

Sent when a performance timeline event is added. See reportPerformanceTimeline method.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `event` | [TimelineEvent](#timelineevent) |  |


