# SmartCardEmulation

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

### <a name="resultcode"></a>ResultCode

Indicates the PC/SC error code.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__ErrorCodes.html
Microsoft: https://learn.microsoft.com/en-us/windows/win32/secauthn/authentication-return-values

* **Type**: `string`
* **Allowed values**: `"success"`, `"removed-card"`, `"reset-card"`, `"unpowered-card"`, `"unresponsive-card"`, `"unsupported-card"`, `"reader-unavailable"`, `"sharing-violation"`, `"not-transacted"`, `"no-smartcard"`, `"proto-mismatch"`, `"system-cancelled"`, `"not-ready"`, `"cancelled"`, `"insufficient-buffer"`, `"invalid-handle"`, `"invalid-parameter"`, `"invalid-value"`, `"no-memory"`, `"timeout"`, `"unknown-reader"`, `"unsupported-feature"`, `"no-readers-available"`, `"service-stopped"`, `"no-service"`, `"comm-error"`, `"internal-error"`, `"server-too-busy"`, `"unexpected"`, `"shutdown"`, `"unknown-card"`, `"unknown"`

### <a name="sharemode"></a>ShareMode

Maps to the |SCARD_SHARE_*| values.

* **Type**: `string`
* **Allowed values**: `"shared"`, `"exclusive"`, `"direct"`

### <a name="disposition"></a>Disposition

Indicates what the reader should do with the card.

* **Type**: `string`
* **Allowed values**: `"leave-card"`, `"reset-card"`, `"unpower-card"`, `"eject-card"`

### <a name="connectionstate"></a>ConnectionState

Maps to |SCARD_*| connection state values.

* **Type**: `string`
* **Allowed values**: `"absent"`, `"present"`, `"swallowed"`, `"powered"`, `"negotiable"`, `"specific"`

### <a name="readerstateflags"></a>ReaderStateFlags

Maps to the |SCARD_STATE_*| flags.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `unaware`<br/>_optional_ | `boolean` |  |
| `ignore`<br/>_optional_ | `boolean` |  |
| `changed`<br/>_optional_ | `boolean` |  |
| `unknown`<br/>_optional_ | `boolean` |  |
| `unavailable`<br/>_optional_ | `boolean` |  |
| `empty`<br/>_optional_ | `boolean` |  |
| `present`<br/>_optional_ | `boolean` |  |
| `exclusive`<br/>_optional_ | `boolean` |  |
| `inuse`<br/>_optional_ | `boolean` |  |
| `mute`<br/>_optional_ | `boolean` |  |
| `unpowered`<br/>_optional_ | `boolean` |  |


### <a name="protocolset"></a>ProtocolSet

Maps to the |SCARD_PROTOCOL_*| flags.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `t0`<br/>_optional_ | `boolean` |  |
| `t1`<br/>_optional_ | `boolean` |  |
| `raw`<br/>_optional_ | `boolean` |  |


### <a name="protocol"></a>Protocol

Maps to the |SCARD_PROTOCOL_*| values.

* **Type**: `string`
* **Allowed values**: `"t0"`, `"t1"`, `"raw"`

### <a name="readerstatein"></a>ReaderStateIn

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `reader` | `string` |  |
| `currentState` | [ReaderStateFlags](#readerstateflags) |  |
| `currentInsertionCount` | `integer` |  |


### <a name="readerstateout"></a>ReaderStateOut

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `reader` | `string` |  |
| `eventState` | [ReaderStateFlags](#readerstateflags) |  |
| `eventCount` | `integer` |  |
| `atr` | `string` |  |


---

<a name="commands"></a>
## Commands

### <a name="enable"></a>enable

Enables the |SmartCardEmulation| domain.

* **Parameters**: None

* **Returns**: None


### <a name="disable"></a>disable

Disables the |SmartCardEmulation| domain.

* **Parameters**: None

* **Returns**: None


### <a name="reportestablishcontextresult"></a>reportEstablishContextResult

Reports the successful result of a |SCardEstablishContext| call.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaa1b8970169fd4883a6dc4a8f43f19b67
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardestablishcontext

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `contextId` | `integer` |  |

* **Returns**: None


### <a name="reportreleasecontextresult"></a>reportReleaseContextResult

Reports the successful result of a |SCardReleaseContext| call.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga6aabcba7744c5c9419fdd6404f73a934
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardreleasecontext

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |

* **Returns**: None


### <a name="reportlistreadersresult"></a>reportListReadersResult

Reports the successful result of a |SCardListReaders| call.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga93b07815789b3cf2629d439ecf20f0d9
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardlistreadersa

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `readers` | array of `string` |  |

* **Returns**: None


### <a name="reportgetstatuschangeresult"></a>reportGetStatusChangeResult

Reports the successful result of a |SCardGetStatusChange| call.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga33247d5d1257d59e55647c3bb717db24
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetstatuschangea

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `readerStates` | array of [ReaderStateOut](#readerstateout) |  |

* **Returns**: None


### <a name="reportbegintransactionresult"></a>reportBeginTransactionResult

Reports the result of a |SCardBeginTransaction| call.
On success, this creates a new transaction object.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaddb835dce01a0da1d6ca02d33ee7d861
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardbegintransaction

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `handle` | `integer` |  |

* **Returns**: None


### <a name="reportplainresult"></a>reportPlainResult

Reports the successful result of a call that returns only a result code.
Used for: |SCardCancel|, |SCardDisconnect|, |SCardSetAttrib|, |SCardEndTransaction|.

This maps to:
1. SCardCancel
   PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacbbc0c6d6c0cbbeb4f4debf6fbeeee6
   Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcancel

2. SCardDisconnect
   PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4be198045c73ec0deb79e66c0ca1738a
   Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scarddisconnect

3. SCardSetAttrib
   PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga060f0038a4ddfd5dd2b8fadf3c3a2e4f
   Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardsetattrib

4. SCardEndTransaction
   PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae8742473b404363e5c587f570d7e2f3b
   Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardendtransaction

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |

* **Returns**: None


### <a name="reportconnectresult"></a>reportConnectResult

Reports the successful result of a |SCardConnect| call.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4e515829752e0a8dbc4d630696a8d6a5
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardconnecta

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `handle` | `integer` |  |
| `activeProtocol`<br/>_optional_ | [Protocol](#protocol) |  |

* **Returns**: None


### <a name="reportdataresult"></a>reportDataResult

Reports the successful result of a call that sends back data on success.
Used for |SCardTransmit|, |SCardControl|, and |SCardGetAttrib|.

This maps to:
1. SCardTransmit
   PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga9a2d77242a271310269065e64633ab99
   Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardtransmit

2. SCardControl
   PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gac3454d4657110fd7f753b2d3d8f4e32f
   Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcontrol

3. SCardGetAttrib
   PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacfec51917255b7a25b94c5104961602
   Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetattrib

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `data` | `string` |  |

* **Returns**: None


### <a name="reportstatusresult"></a>reportStatusResult

Reports the successful result of a |SCardStatus| call.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae49c3c894ad7ac12a5b896bde70d0382
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardstatusa

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `readerName` | `string` |  |
| `state` | [ConnectionState](#connectionstate) |  |
| `atr` | `string` |  |
| `protocol`<br/>_optional_ | [Protocol](#protocol) |  |

* **Returns**: None


### <a name="reporterror"></a>reportError

Reports an error result for the given request.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `resultCode` | [ResultCode](#resultcode) |  |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="establishcontextrequested"></a>establishContextRequested

Fired when |SCardEstablishContext| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaa1b8970169fd4883a6dc4a8f43f19b67
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardestablishcontext

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |


### <a name="releasecontextrequested"></a>releaseContextRequested

Fired when |SCardReleaseContext| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga6aabcba7744c5c9419fdd6404f73a934
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardreleasecontext

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `contextId` | `integer` |  |


### <a name="listreadersrequested"></a>listReadersRequested

Fired when |SCardListReaders| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga93b07815789b3cf2629d439ecf20f0d9
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardlistreadersa

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `contextId` | `integer` |  |


### <a name="getstatuschangerequested"></a>getStatusChangeRequested

Fired when |SCardGetStatusChange| is called. Timeout is specified in milliseconds.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga33247d5d1257d59e55647c3bb717db24
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetstatuschangea

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `contextId` | `integer` |  |
| `readerStates` | array of [ReaderStateIn](#readerstatein) |  |
| `timeout`<br/>_optional_ | `integer` | in milliseconds, if absent, it means "infinite" |


### <a name="cancelrequested"></a>cancelRequested

Fired when |SCardCancel| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacbbc0c6d6c0cbbeb4f4debf6fbeeee6
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcancel

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `contextId` | `integer` |  |


### <a name="connectrequested"></a>connectRequested

Fired when |SCardConnect| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4e515829752e0a8dbc4d630696a8d6a5
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardconnecta

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `contextId` | `integer` |  |
| `reader` | `string` |  |
| `shareMode` | [ShareMode](#sharemode) |  |
| `preferredProtocols` | [ProtocolSet](#protocolset) |  |


### <a name="disconnectrequested"></a>disconnectRequested

Fired when |SCardDisconnect| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga4be198045c73ec0deb79e66c0ca1738a
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scarddisconnect

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `handle` | `integer` |  |
| `disposition` | [Disposition](#disposition) |  |


### <a name="transmitrequested"></a>transmitRequested

Fired when |SCardTransmit| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga9a2d77242a271310269065e64633ab99
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardtransmit

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `handle` | `integer` |  |
| `data` | `string` |  |
| `protocol`<br/>_optional_ | [Protocol](#protocol) |  |


### <a name="controlrequested"></a>controlRequested

Fired when |SCardControl| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gac3454d4657110fd7f753b2d3d8f4e32f
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardcontrol

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `handle` | `integer` |  |
| `controlCode` | `integer` |  |
| `data` | `string` |  |


### <a name="getattribrequested"></a>getAttribRequested

Fired when |SCardGetAttrib| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaacfec51917255b7a25b94c5104961602
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardgetattrib

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `handle` | `integer` |  |
| `attribId` | `integer` |  |


### <a name="setattribrequested"></a>setAttribRequested

Fired when |SCardSetAttrib| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#ga060f0038a4ddfd5dd2b8fadf3c3a2e4f
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardsetattrib

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `handle` | `integer` |  |
| `attribId` | `integer` |  |
| `data` | `string` |  |


### <a name="statusrequested"></a>statusRequested

Fired when |SCardStatus| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae49c3c894ad7ac12a5b896bde70d0382
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardstatusa

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `handle` | `integer` |  |


### <a name="begintransactionrequested"></a>beginTransactionRequested

Fired when |SCardBeginTransaction| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gaddb835dce01a0da1d6ca02d33ee7d861
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardbegintransaction

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `handle` | `integer` |  |


### <a name="endtransactionrequested"></a>endTransactionRequested

Fired when |SCardEndTransaction| is called.

This maps to:
PC/SC Lite: https://pcsclite.apdu.fr/api/group__API.html#gae8742473b404363e5c587f570d7e2f3b
Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winscard/nf-winscard-scardendtransaction

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `requestId` | `string` |  |
| `handle` | `integer` |  |
| `disposition` | [Disposition](#disposition) |  |


