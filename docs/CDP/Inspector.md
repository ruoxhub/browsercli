# Inspector

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

_None_

---

<a name="commands"></a>
## Commands

### <a name="disable"></a>disable

Disables inspector domain notifications.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables inspector domain notifications.

* **Parameters**: None

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="detached"></a>detached

Fired when remote debugging connection is about to be terminated. Contains detach reason.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `reason` | `string` | The reason why connection has been terminated. |


### <a name="targetcrashed"></a>targetCrashed

Fired when debugging target has crashed

* **Parameters**: None


### <a name="targetreloadedaftercrash"></a>targetReloadedAfterCrash

Fired when debugging target has reloaded after crash

* **Parameters**: None


### <a name="workerscriptloaded"></a>workerScriptLoaded `🧪 experimental`

Fired on worker targets when main worker script and any imported scripts have been evaluated.

* **Parameters**: None


