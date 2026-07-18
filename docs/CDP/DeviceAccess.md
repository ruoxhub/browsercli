# DeviceAccess

`🧪 Experimental`

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

### <a name="requestid"></a>RequestId

Device request id.

* **Type**: `string`

### <a name="deviceid"></a>DeviceId

A device id.

* **Type**: `string`

### <a name="promptdevice"></a>PromptDevice

Device information displayed in a user prompt to select a device.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | [DeviceId](#deviceid) |  |
| `name` | `string` | Display name as it appears in a device request user prompt. |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

Enable events in this domain.

* **Parameters**: None

* **Returns**: None


### <a name="disable"></a>disable

Disable events in this domain.

* **Parameters**: None

* **Returns**: None


### <a name="selectprompt"></a>selectPrompt

Select a device in response to a DeviceAccess.deviceRequestPrompted event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | [RequestId](#requestid) |  |
| `deviceId` | [DeviceId](#deviceid) |  |

* **Returns**: None


### <a name="cancelprompt"></a>cancelPrompt

Cancel a prompt in response to a DeviceAccess.deviceRequestPrompted event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | [RequestId](#requestid) |  |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="devicerequestprompted"></a>deviceRequestPrompted

A device request opened a user prompt to select a device. Respond with the
selectPrompt or cancelPrompt command.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | [RequestId](#requestid) |  |
| `devices` | array of [PromptDevice](#promptdevice) |  |


