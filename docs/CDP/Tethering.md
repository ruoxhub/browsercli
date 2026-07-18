# Tethering

`🧪 Experimental`

The Tethering domain defines methods and events for browser port binding.

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

### <a name="bind"></a>bind

Request browser port binding.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `port` | `integer` | Port number to bind. |

* **Returns**: None


### <a name="unbind"></a>unbind

Request browser port unbinding.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `port` | `integer` | Port number to unbind. |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="accepted"></a>accepted

Informs that port was successfully bound and got a specified connection id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `port` | `integer` | Port number that was successfully bound. |
| `connectionId` | `string` | Connection id to be used. |


