# IO

Input/Output operations for streams produced by DevTools.

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

### <a name="streamhandle"></a>StreamHandle

This is either obtained from another method or specified as `blob:<uuid>` where
`<uuid>` is an UUID of a Blob.

* **Type**: `string`

---

<a name="commands"></a>
## Commands

### <a name="close"></a>close

Close the stream, discard any temporary backing storage.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `handle` | [StreamHandle](#streamhandle) | Handle of the stream to close. |

* **Returns**: None


### <a name="read"></a>read

Read a chunk of the stream

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `handle` | [StreamHandle](#streamhandle) | Handle of the stream to read. |
| `offset`<br/>_optional_ | `integer` | Seek to the specified offset before reading (if not specified, proceed with offset<br/>following the last read). Some types of streams may only support sequential reads. |
| `size`<br/>_optional_ | `integer` | Maximum number of bytes to read (left upon the agent discretion if not specified). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `base64Encoded`<br/>_optional_ | `boolean` | Set if the data is base64-encoded |
| `data` | `string` | Data that were read. |
| `eof` | `boolean` | Set if the end-of-file condition occurred while reading. |


### <a name="resolveblob"></a>resolveBlob

Return UUID of Blob object specified by a remote object id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `objectId` | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | Object id of a Blob object wrapper. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `uuid` | `string` | UUID of the specified Blob. |


---

<a name="events"></a>
## Events

_None_

