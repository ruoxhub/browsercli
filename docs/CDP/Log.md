# Log

Provides access to log entries.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Runtime](Runtime.md), [Network](Network.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="logentry"></a>LogEntry

Log entry.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `source` | `string` | Log entry source.<br/>Allowed values: `"xml"`, `"javascript"`, `"network"`, `"storage"`, `"appcache"`, `"rendering"`, `"security"`, `"deprecation"`, `"worker"`, `"violation"`, `"intervention"`, `"recommendation"`, `"other"` |
| `level` | `string` | Log entry severity.<br/>Allowed values: `"verbose"`, `"info"`, `"warning"`, `"error"` |
| `text` | `string` | Logged text. |
| `category`<br/>_optional_ | `string` | Allowed values: `"cors"` |
| `timestamp` | [Runtime.Timestamp](Runtime.md#timestamp) | Timestamp when this entry was added. |
| `url`<br/>_optional_ | `string` | URL of the resource if known. |
| `lineNumber`<br/>_optional_ | `integer` | Line number in the resource. |
| `stackTrace`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | JavaScript stack trace. |
| `networkRequestId`<br/>_optional_ | [Network.RequestId](Network.md#requestid) | Identifier of the network request associated with this entry. |
| `workerId`<br/>_optional_ | `string` | Identifier of the worker associated with this entry. |
| `args`<br/>_optional_ | array of [Runtime.RemoteObject](Runtime.md#remoteobject) | Call arguments. |


### <a name="violationsetting"></a>ViolationSetting

Violation configuration setting.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Violation type.<br/>Allowed values: `"longTask"`, `"longLayout"`, `"blockedEvent"`, `"blockedParser"`, `"discouragedAPIUse"`, `"handler"`, `"recurringHandler"` |
| `threshold` | `number` | Time threshold to trigger upon. |


---

<a name="commands"></a>
## Commands

### <a name="clear"></a>clear

Clears the log.

* **Parameters**: None

* **Returns**: None


### <a name="disable"></a>disable

Disables log domain, prevents further log entries from being reported to the client.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables log domain, sends the entries collected so far to the client by means of the
`entryAdded` notification.

* **Parameters**: None

* **Returns**: None


### <a name="startviolationsreport"></a>startViolationsReport

start violation reporting.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `config` | array of [ViolationSetting](#violationsetting) | Configuration for violations. |

* **Returns**: None


### <a name="stopviolationsreport"></a>stopViolationsReport

Stop violation reporting.

* **Parameters**: None

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="entryadded"></a>entryAdded

Issued when new message was logged.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `entry` | [LogEntry](#logentry) | The entry. |


