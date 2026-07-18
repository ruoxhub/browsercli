# ServiceWorker

`🧪 Experimental`

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Target](Target.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="registrationid"></a>RegistrationID

* **Type**: `string`

### <a name="serviceworkerregistration"></a>ServiceWorkerRegistration

ServiceWorker registration.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `registrationId` | [RegistrationID](#registrationid) |  |
| `scopeURL` | `string` |  |
| `isDeleted` | `boolean` |  |


### <a name="serviceworkerversionrunningstatus"></a>ServiceWorkerVersionRunningStatus

* **Type**: `string`
* **Allowed values**: `"stopped"`, `"starting"`, `"running"`, `"stopping"`

### <a name="serviceworkerversionstatus"></a>ServiceWorkerVersionStatus

* **Type**: `string`
* **Allowed values**: `"new"`, `"installing"`, `"installed"`, `"activating"`, `"activated"`, `"redundant"`

### <a name="serviceworkerversion"></a>ServiceWorkerVersion

ServiceWorker version.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `versionId` | `string` |  |
| `registrationId` | [RegistrationID](#registrationid) |  |
| `scriptURL` | `string` |  |
| `runningStatus` | [ServiceWorkerVersionRunningStatus](#serviceworkerversionrunningstatus) |  |
| `status` | [ServiceWorkerVersionStatus](#serviceworkerversionstatus) |  |
| `scriptLastModified`<br/>_optional_ | `number` | The Last-Modified header value of the main script. |
| `scriptResponseTime`<br/>_optional_ | `number` | The time at which the response headers of the main script were received from the server.<br/>For cached script it is the last time the cache entry was validated. |
| `controlledClients`<br/>_optional_ | array of [Target.TargetID](Target.md#targetid) |  |
| `targetId`<br/>_optional_ | [Target.TargetID](Target.md#targetid) |  |
| `routerRules`<br/>_optional_ | `string` |  |


### <a name="serviceworkererrormessage"></a>ServiceWorkerErrorMessage

ServiceWorker error message.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `errorMessage` | `string` |  |
| `registrationId` | [RegistrationID](#registrationid) |  |
| `versionId` | `string` |  |
| `sourceURL` | `string` |  |
| `lineNumber` | `integer` |  |
| `columnNumber` | `integer` |  |


---

<a name="commands"></a>
## Commands

### <a name="deliverpushmessage"></a>deliverPushMessage

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` |  |
| `registrationId` | [RegistrationID](#registrationid) |  |
| `data` | `string` |  |

* **Returns**: None


### <a name="disable"></a>disable

* **Parameters**: None

* **Returns**: None


### <a name="dispatchsyncevent"></a>dispatchSyncEvent

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` |  |
| `registrationId` | [RegistrationID](#registrationid) |  |
| `tag` | `string` |  |
| `lastChance` | `boolean` |  |

* **Returns**: None


### <a name="dispatchperiodicsyncevent"></a>dispatchPeriodicSyncEvent

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `origin` | `string` |  |
| `registrationId` | [RegistrationID](#registrationid) |  |
| `tag` | `string` |  |

* **Returns**: None


### <a name="enable"></a>enable

* **Parameters**: None

* **Returns**: None


### <a name="setforceupdateonpageload"></a>setForceUpdateOnPageLoad

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `forceUpdateOnPageLoad` | `boolean` |  |

* **Returns**: None


### <a name="skipwaiting"></a>skipWaiting

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scopeURL` | `string` |  |

* **Returns**: None


### <a name="startworker"></a>startWorker

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scopeURL` | `string` |  |

* **Returns**: None


### <a name="stopallworkers"></a>stopAllWorkers

* **Parameters**: None

* **Returns**: None


### <a name="stopworker"></a>stopWorker

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `versionId` | `string` |  |

* **Returns**: None


### <a name="unregister"></a>unregister

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scopeURL` | `string` |  |

* **Returns**: None


### <a name="updateregistration"></a>updateRegistration

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scopeURL` | `string` |  |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="workererrorreported"></a>workerErrorReported

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `errorMessage` | [ServiceWorkerErrorMessage](#serviceworkererrormessage) |  |


### <a name="workerregistrationupdated"></a>workerRegistrationUpdated

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `registrations` | array of [ServiceWorkerRegistration](#serviceworkerregistration) |  |


### <a name="workerversionupdated"></a>workerVersionUpdated

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `versions` | array of [ServiceWorkerVersion](#serviceworkerversion) |  |


