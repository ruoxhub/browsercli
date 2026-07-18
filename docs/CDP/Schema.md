# Schema

`⚠️ Deprecated`

This domain is deprecated.

* **Source**: JS Protocol (V8)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="domain"></a>Domain

Description of the protocol domain.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Domain name. |
| `version` | `string` | Domain version. |


---

<a name="commands"></a>
## Commands

### <a name="getdomains"></a>getDomains

Returns supported domains.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `domains` | array of [Domain](#domain) | List of supported domains. |


---

<a name="events"></a>
## Events

_None_

