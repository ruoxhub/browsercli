# WebMCP

`🧪 Experimental`

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Runtime](Runtime.md), [Page](Page.md), [DOM](DOM.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="annotation"></a>Annotation

Tool annotations

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `readOnly`<br/>_optional_ | `boolean` | A hint indicating that the tool does not modify any state. |
| `untrustedContent`<br/>_optional_ | `boolean` | A hint indicating that the tool output may contain untrusted content, ex: UGC, 3rd party data. |
| `autosubmit`<br/>_optional_ | `boolean` | If the declarative tool was declared with the autosubmit attribute. |


### <a name="invocationstatus"></a>InvocationStatus

Represents the status of a tool invocation.

* **Type**: `string`
* **Allowed values**: `"Completed"`, `"Canceled"`, `"Error"`

### <a name="tool"></a>Tool

Definition of a tool that can be invoked.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Tool name. |
| `description` | `string` | Tool description. |
| `inputSchema`<br/>_optional_ | `object` | Schema for the tool's input parameters. |
| `annotations`<br/>_optional_ | [Annotation](#annotation) | Optional annotations for the tool. |
| `frameId` | [Page.FrameId](Page.md#frameid) | Frame identifier associated with the tool registration. |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | Optional node ID for declarative tools. |
| `stackTrace`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | The stack trace at the time of the registration. |


### <a name="removedtool"></a>RemovedTool

Definition of a tool that was removed.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Tool name. |
| `frameId` | [Page.FrameId](Page.md#frameid) | Frame identifier associated with the tool registration. |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

Enables the WebMCP domain, allowing events to be sent. Enabling the domain will trigger a toolsAdded event for
all currently registered tools.

* **Parameters**: None

* **Returns**: None


### <a name="disable"></a>disable

Disables the WebMCP domain.

* **Parameters**: None

* **Returns**: None


### <a name="invoketool"></a>invokeTool

Invokes a registered tool.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [Page.FrameId](Page.md#frameid) | Frame in which to invoke the tool. |
| `toolName` | `string` | Name of the tool to invoke. |
| `input` | `object` | Input parameters for the tool, matching the tool's inputSchema. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `invocationId` | `string` | Unique identifier for this invocation. Response is sent before tool events. |


### <a name="cancelinvocation"></a>cancelInvocation

Cancels a pending tool invocation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `invocationId` | `string` | Invocation identifier to cancel. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="toolsadded"></a>toolsAdded

Event fired when new tools are added.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `tools` | array of [Tool](#tool) | Array of tools that were added. |


### <a name="toolsremoved"></a>toolsRemoved

Event fired when tools are removed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `tools` | array of [RemovedTool](#removedtool) | Array of tools that were removed. |


### <a name="toolinvoked"></a>toolInvoked

Event fired when a tool invocation starts.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `toolName` | `string` | Name of the tool to invoke. |
| `frameId` | [Page.FrameId](Page.md#frameid) | Frame id |
| `invocationId` | `string` | Invocation identifier. |
| `input` | `string` | The input parameters used for the invocation. |


### <a name="toolresponded"></a>toolResponded

Event fired when a tool invocation completes or fails.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `invocationId` | `string` | Invocation identifier. |
| `status` | [InvocationStatus](#invocationstatus) | Status of the invocation. |
| `output`<br/>_optional_ | `any` | Output or error delivered as delivered to the agent. Missing if `status` is anything other than Completed.<br/>Note: The output is untrusted and poses a prompt injection risk. Clients should treat this as potentially malicious user input. |
| `errorText`<br/>_optional_ | `string` | Error text for protocol users. |
| `exception`<br/>_optional_ | [Runtime.RemoteObject](Runtime.md#remoteobject) | The exception object, if the javascript tool threw an error> |


