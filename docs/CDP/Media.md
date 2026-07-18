# Media

`🧪 Experimental`

This domain allows detailed inspection of media elements.

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

### <a name="playerid"></a>PlayerId

Players will get an ID that is unique within the agent context.

* **Type**: `string`

### <a name="timestamp"></a>Timestamp

* **Type**: `number`

### <a name="playermessage"></a>PlayerMessage

Have one type per entry in MediaLogRecord::Type
Corresponds to kMessage

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `level` | `string` | Keep in sync with MediaLogMessageLevel<br/>We are currently keeping the message level 'error' separate from the<br/>PlayerError type because right now they represent different things,<br/>this one being a DVLOG(ERROR) style log message that gets printed<br/>based on what log level is selected in the UI, and the other is a<br/>representation of a media::PipelineStatus object. Soon however we're<br/>going to be moving away from using PipelineStatus for errors and<br/>introducing a new error type which should hopefully let us integrate<br/>the error log level into the PlayerError type.<br/>Allowed values: `"error"`, `"warning"`, `"info"`, `"debug"` |
| `message` | `string` |  |


### <a name="playerproperty"></a>PlayerProperty

Corresponds to kMediaPropertyChange

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` |  |
| `value` | `string` |  |


### <a name="playerevent"></a>PlayerEvent

Corresponds to kMediaEventTriggered

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `timestamp` | [Timestamp](#timestamp) |  |
| `value` | `string` |  |


### <a name="playererrorsourcelocation"></a>PlayerErrorSourceLocation

Represents logged source line numbers reported in an error.
NOTE: file and line are from chromium c++ implementation code, not js.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `file` | `string` |  |
| `line` | `integer` |  |


### <a name="playererror"></a>PlayerError

Corresponds to kMediaError

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `errorType` | `string` |  |
| `code` | `integer` | Code is the numeric enum entry for a specific set of error codes, such<br/>as PipelineStatusCodes in media/base/pipeline_status.h |
| `stack` | array of [PlayerErrorSourceLocation](#playererrorsourcelocation) | A trace of where this error was caused / where it passed through. |
| `cause` | array of [PlayerError](#playererror) | Errors potentially have a root cause error, ie, a DecoderError might be<br/>caused by an WindowsError |
| `data` | `object` | Extra data attached to an error, such as an HRESULT, Video Codec, etc. |


### <a name="player"></a>Player

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `playerId` | [PlayerId](#playerid) |  |
| `domNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) |  |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

Enables the Media domain

* **Parameters**: None

* **Returns**: None


### <a name="disable"></a>disable

Disables the Media domain.

* **Parameters**: None

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="playerpropertieschanged"></a>playerPropertiesChanged

This can be called multiple times, and can be used to set / override /
remove player properties. A null propValue indicates removal.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `playerId` | [PlayerId](#playerid) |  |
| `properties` | array of [PlayerProperty](#playerproperty) |  |


### <a name="playereventsadded"></a>playerEventsAdded

Send events as a list, allowing them to be batched on the browser for less
congestion. If batched, events must ALWAYS be in chronological order.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `playerId` | [PlayerId](#playerid) |  |
| `events` | array of [PlayerEvent](#playerevent) |  |


### <a name="playermessageslogged"></a>playerMessagesLogged

Send a list of any messages that need to be delivered.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `playerId` | [PlayerId](#playerid) |  |
| `messages` | array of [PlayerMessage](#playermessage) |  |


### <a name="playererrorsraised"></a>playerErrorsRaised

Send a list of any errors that need to be delivered.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `playerId` | [PlayerId](#playerid) |  |
| `errors` | array of [PlayerError](#playererror) |  |


### <a name="playercreated"></a>playerCreated

Called whenever a player is created, or when a new agent joins and receives
a list of active players. If an agent is restored, it will receive one
event for each active player.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `player` | [Player](#player) |  |


