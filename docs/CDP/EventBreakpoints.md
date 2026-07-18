# EventBreakpoints

`🧪 Experimental`

EventBreakpoints permits setting JavaScript breakpoints on operations and events
occurring in native code invoked from JavaScript. Once breakpoint is hit, it is
reported through Debugger domain, similarly to regular breakpoints being hit.

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

_None_

---

<a name="commands"></a>
## Commands

### <a name="setinstrumentationbreakpoint"></a>setInstrumentationBreakpoint

Sets breakpoint on particular native event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventName` | `string` | Instrumentation name to stop on. |

* **Returns**: None


### <a name="removeinstrumentationbreakpoint"></a>removeInstrumentationBreakpoint

Removes breakpoint on particular native event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventName` | `string` | Instrumentation name to stop on. |

* **Returns**: None


### <a name="disable"></a>disable

Removes all breakpoints

* **Parameters**: None

* **Returns**: None


---

<a name="events"></a>
## Events

_None_

