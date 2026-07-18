# DOMDebugger

DOM debugging allows setting breakpoints on particular DOM operations and events. JavaScript
execution will stop on these operations as if there was a regular breakpoint set.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [DOM](DOM.md), [Runtime](Runtime.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="dombreakpointtype"></a>DOMBreakpointType

DOM breakpoint type.

* **Type**: `string`
* **Allowed values**: `"subtree-modified"`, `"attribute-modified"`, `"node-removed"`

### <a name="cspviolationtype"></a>CSPViolationType `🧪 experimental`

CSP Violation type.

* **Type**: `string`
* **Allowed values**: `"trustedtype-sink-violation"`, `"trustedtype-policy-violation"`

### <a name="eventlistener"></a>EventListener

Object event listener.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | `string` | `EventListener`'s type. |
| `useCapture` | `boolean` | `EventListener`'s useCapture. |
| `passive` | `boolean` | `EventListener`'s passive flag. |
| `once` | `boolean` | `EventListener`'s once flag. |
| `scriptId` | [Runtime.ScriptId](Runtime.md#scriptid) | Script id of the handler code. |
| `lineNumber` | `integer` | Line number in the script (0-based). |
| `columnNumber` | `integer` | Column number in the script (0-based). |
| `handler`<br/>_optional_ | [Runtime.RemoteObject](Runtime.md#remoteobject) | Event handler function value. |
| `originalHandler`<br/>_optional_ | [Runtime.RemoteObject](Runtime.md#remoteobject) | Event original handler function value. |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | Node the listener is added to (if any). |


---

<a name="commands"></a>
## Commands

### <a name="geteventlisteners"></a>getEventListeners

Returns event listeners of the given object.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `objectId` | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | Identifier of the object to return listeners for. |
| `depth`<br/>_optional_ | `integer` | The maximum depth at which Node children should be retrieved, defaults to 1. Use -1 for the<br/>entire subtree or provide an integer larger than 0. |
| `pierce`<br/>_optional_ | `boolean` | Whether or not iframes and shadow roots should be traversed when returning the subtree<br/>(default is false). Reports listeners for all contexts if pierce is enabled. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `listeners` | array of [EventListener](#eventlistener) | Array of relevant listeners. |


### <a name="removedombreakpoint"></a>removeDOMBreakpoint

Removes DOM breakpoint that was set using `setDOMBreakpoint`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node to remove breakpoint from. |
| `type` | [DOMBreakpointType](#dombreakpointtype) | Type of the breakpoint to remove. |

* **Returns**: None


### <a name="removeeventlistenerbreakpoint"></a>removeEventListenerBreakpoint

Removes breakpoint on particular DOM event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventName` | `string` | Event name. |
| `targetName`<br/>_optional_ | `string` | `🧪 experimental` EventTarget interface name. |

* **Returns**: None


### <a name="removeinstrumentationbreakpoint"></a>removeInstrumentationBreakpoint `🧪 experimental` `⚠️ deprecated`

Removes breakpoint on particular native event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventName` | `string` | Instrumentation name to stop on. |

* **Returns**: None


### <a name="removexhrbreakpoint"></a>removeXHRBreakpoint

Removes breakpoint from XMLHttpRequest.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | Resource URL substring. |

* **Returns**: None


### <a name="setbreakoncspviolation"></a>setBreakOnCSPViolation `🧪 experimental`

Sets breakpoint on particular CSP violations.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `violationTypes` | array of [CSPViolationType](#cspviolationtype) | CSP Violations to stop upon. |

* **Returns**: None


### <a name="setdombreakpoint"></a>setDOMBreakpoint

Sets breakpoint on particular operation with DOM.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node to set breakpoint on. |
| `type` | [DOMBreakpointType](#dombreakpointtype) | Type of the operation to stop upon. |

* **Returns**: None


### <a name="seteventlistenerbreakpoint"></a>setEventListenerBreakpoint

Sets breakpoint on particular DOM event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventName` | `string` | DOM Event name to stop on (any DOM event will do). |
| `targetName`<br/>_optional_ | `string` | `🧪 experimental` EventTarget interface name to stop on. If equal to `"*"` or not provided, will stop on any<br/>EventTarget. |

* **Returns**: None


### <a name="setinstrumentationbreakpoint"></a>setInstrumentationBreakpoint `🧪 experimental` `⚠️ deprecated`

Sets breakpoint on particular native event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `eventName` | `string` | Instrumentation name to stop on. |

* **Returns**: None


### <a name="setxhrbreakpoint"></a>setXHRBreakpoint

Sets breakpoint on XMLHttpRequest.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `url` | `string` | Resource URL substring. All XHRs having this substring in the URL will get stopped upon. |

* **Returns**: None


---

<a name="events"></a>
## Events

_None_

