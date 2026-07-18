# BackgroundService

`🧪 Experimental`

Defines events for background web platform features.

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

### <a name="servicename"></a>ServiceName

The Background Service that will be associated with the commands/events.
Every Background Service operates independently, but they share the same
API.

* **Type**: `string`
* **Allowed values**: `"backgroundFetch"`, `"backgroundSync"`, `"pushMessaging"`, `"notifications"`, `"paymentHandler"`, `"periodicBackgroundSync"`

### <a name="eventmetadata"></a>EventMetadata

A key-value pair for additional event information to pass along.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `key` | `string` |  |
| `value` | `string` |  |


### <a name="backgroundserviceevent"></a>BackgroundServiceEvent

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `timestamp` | [Network.TimeSinceEpoch](Network.md#timesinceepoch) | Timestamp of the event (in seconds). |
| `origin` | `string` | The origin this event belongs to. |
| `serviceWorkerRegistrationId` | [ServiceWorker.RegistrationID](ServiceWorker.md#registrationid) | The Service Worker ID that initiated the event. |
| `service` | [ServiceName](#servicename) | The Background Service this event belongs to. |
| `eventName` | `string` | A description of the event. |
| `instanceId` | `string` | An identifier that groups related events together. |
| `eventMetadata` | array of [EventMetadata](#eventmetadata) | A list of event-specific information. |
| `storageKey` | `string` | Storage key this event belongs to. |


---

<a name="commands"></a>
## Commands

### <a name="startobserving"></a>startObserving

Enables event updates for the service.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `service` | [ServiceName](#servicename) |  |

* **Returns**: None


### <a name="stopobserving"></a>stopObserving

Disables event updates for the service.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `service` | [ServiceName](#servicename) |  |

* **Returns**: None


### <a name="setrecording"></a>setRecording

Set the recording state for the service.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `shouldRecord` | `boolean` |  |
| `service` | [ServiceName](#servicename) |  |

* **Returns**: None


### <a name="clearevents"></a>clearEvents

Clears all stored data for the service.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `service` | [ServiceName](#servicename) |  |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="recordingstatechanged"></a>recordingStateChanged

Called when the recording state for the service has been updated.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `isRecording` | `boolean` |  |
| `service` | [ServiceName](#servicename) |  |


### <a name="backgroundserviceeventreceived"></a>backgroundServiceEventReceived

Called with all existing backgroundServiceEvents when enabled, and all new
events afterwards if enabled and recording.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `backgroundServiceEvent` | [BackgroundServiceEvent](#backgroundserviceevent) |  |


