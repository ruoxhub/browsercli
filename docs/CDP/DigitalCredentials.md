# DigitalCredentials

`🧪 Experimental`

This domain allows interacting with the Digital Credentials API for automation.

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

### <a name="virtualwalletaction"></a>VirtualWalletAction

The type of virtual wallet action.

* **Type**: `string`
* **Allowed values**: `"respond"`, `"decline"`, `"wait"`, `"clear"`

---

<a name="commands"></a>
## Commands

### <a name="setvirtualwalletbehavior"></a>setVirtualWalletBehavior

Sets the behavior of the virtual wallet for digital credential requests
issued from this frame.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `action` | [VirtualWalletAction](#virtualwalletaction) | The action of the virtual wallet. |
| `protocol`<br/>_optional_ | `string` | The protocol identifier (e.g. "openid4vp"). Required when \|action\| is<br/>"respond", forbidden otherwise. |
| `response`<br/>_optional_ | `object` | The response data object returned by the wallet.<br/>Required when \|action\| is "respond", forbidden otherwise. |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | The frame to scope the virtual wallet behavior to. |

* **Returns**: None


---

<a name="events"></a>
## Events

_None_

