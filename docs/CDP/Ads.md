# Ads

`🧪 Experimental`

A domain for ad-related metrics and data.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Network](Network.md), [Page](Page.md), [Runtime](Runtime.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="adframedata"></a>AdFrameData

Ad frame data.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [Page.FrameId](Page.md#frameid) | The DevTools frame token. |
| `initialOrigin`<br/>_optional_ | `string` | The initial origin of the frame. To minimize the payload size, this is<br/>only sent once per frame. |
| `networkBytes` | `number` | The network bytes of the frame. |
| `cpuTime` | `number` | The CPU time of the frame, in milliseconds. |


### <a name="admetrics"></a>AdMetrics

Ad metrics for a page.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `viewportAdDensityByArea` | `integer` | The viewport ad density by area, represented as a percentage (an integer<br/>between 0 and 100). |
| `averageViewportAdDensityByArea` | `number` | The time-weighted average of the viewport ad density by area, measured<br/>across the duration of the page. |
| `viewportAdCount` | `integer` | The number of ads currently visible within the viewport. |
| `averageViewportAdCount` | `number` | The time-weighted average of the viewport ad count, measured across the<br/>duration of the page. |
| `totalAdCpuTime` | `number` | The total ad CPU usage, in milliseconds. |
| `totalAdNetworkBytes` | `number` | The total ad network bytes. |
| `updateAdFrames` | array of [AdFrameData](#adframedata) | The list of ad frames that have been updated since the last event. |
| `removeAdFrames` | array of [Page.FrameId](Page.md#frameid) | The list of ad frame IDs that have been removed since the last event. |


---

<a name="commands"></a>
## Commands

### <a name="getadmetrics"></a>getAdMetrics

Retrieves ad metrics for the current page.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `metrics` | [AdMetrics](#admetrics) |  |


---

<a name="events"></a>
## Events

_None_

