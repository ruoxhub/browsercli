# Console

`⚠️ Deprecated`

This domain is deprecated - use Runtime or Log instead.

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

### <a name="consolemessage"></a>ConsoleMessage

Console message.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `source` | `string` | Message source.<br/>Allowed values: `"xml"`, `"javascript"`, `"network"`, `"console-api"`, `"storage"`, `"appcache"`, `"rendering"`, `"security"`, `"other"`, `"deprecation"`, `"worker"` |
| `level` | `string` | Message severity.<br/>Allowed values: `"log"`, `"warning"`, `"error"`, `"debug"`, `"info"` |
| `text` | `string` | Message text. |
| `url`<br/>_optional_ | `string` | URL of the message origin. |
| `line`<br/>_optional_ | `integer` | Line number in the resource that generated this message (1-based). |
| `column`<br/>_optional_ | `integer` | Column number in the resource that generated this message (1-based). |


---

<a name="commands"></a>
## Commands

### <a name="clearmessages"></a>clearMessages

Does nothing.

* **Parameters**: None

* **Returns**: None


### <a name="disable"></a>disable

Disables console domain, prevents further console messages from being reported to the client.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables console domain, sends the messages collected so far to the client by means of the
`messageAdded` notification.

* **Parameters**: None

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="messageadded"></a>messageAdded

Issued when new console message is added.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `message` | [ConsoleMessage](#consolemessage) | Console message that has been added. |


