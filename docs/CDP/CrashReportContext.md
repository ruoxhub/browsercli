# CrashReportContext

`🧪 Experimental`

This domain exposes the current state of the CrashReportContext API.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Page](Page.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="crashreportcontextentry"></a>CrashReportContextEntry

Key-value pair in CrashReportContext.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `key` | `string` |  |
| `value` | `string` |  |
| `frameId` | [Page.FrameId](Page.md#frameid) | The ID of the frame where the key-value pair was set. |


---

<a name="commands"></a>
## Commands

### <a name="getentries"></a>getEntries

Returns all entries in the CrashReportContext across all frames in the page.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `entries` | array of [CrashReportContextEntry](#crashreportcontextentry) |  |


---

<a name="events"></a>
## Events

_None_

